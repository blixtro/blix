const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Supabase ────────────────────────────────────────────────────────────────
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
);

// ─── Groq ─────────────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Facebook ────────────────────────────────────────────────────────────────
const VERIFY_TOKEN      = process.env.FACEBOOK_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

// ─── Supabase: جلب المنتجات ──────────────────────────────────────────────────
async function fetchProducts() {
    const { data, error } = await supabase
        .from('blixtro')
        .select('*')
        .order('id', { ascending: true });

    if (error) {
        console.error('❌ Supabase error:', error.message);
        return [];
    }

    console.log(`✅ Supabase: ${data.length} منتج`);
    return data || [];
}

// ─── تنسيق المنتجات لـ Gemini ────────────────────────────────────────────────
function formatProducts(products) {
    if (!products.length) return 'لا توجد منتجات متاحة حالياً.';

    return products.map((p, i) => {
        const available = p.available ? '✅ متوفر' : '❌ غير متوفر';
        const price     = p.price    ? `${p.price} جنيه`    : 'غير محدد';
        const stock     = p.stock != null ? `${p.stock} قطعة` : 'غير محدد';
        const shipping  = p.shipping ? `${p.shipping} جنيه`  : 'غير محدد';
        const about     = p.about    ? `\n   📝 ${p.about}`  : '';

        return (
            `${i + 1}. ${p.name || 'منتج'}\n` +
            `   💰 السعر: ${price}\n` +
            `   📦 المخزون: ${stock}\n` +
            `   🚚 الشحن: ${shipping}\n` +
            `   ${available}${about}`
        );
    }).join('\n\n');
}

// ─── Gemini: توليد الرد ──────────────────────────────────────────────────────
async function getAIReply(userMessage, products) {
    const aiMode     = products[0]?.ai_mode || 'مهذب ومحترف';
    const storeInfo  = products[0]?.about   || 'متجر إلكتروني';
    const catalogue  = formatProducts(products);

    const prompt =
        `أنت مساعد مبيعات لمتجر: ${storeInfo}\n` +
        `أسلوبك: ${aiMode}\n\n` +
        `قائمة المنتجات:\n${catalogue}\n\n` +
        `رسالة العميل: ${userMessage}\n\n` +
        `تعليمات:\n` +
        `- رد بناءً على المنتجات المذكورة فقط\n` +
        `- اذكر الأسعار والمخزون بدقة\n` +
        `- ركز على المنتجات المتوفرة\n` +
        `- لا تذكر أنك AI\n` +
        `- رد بنفس لغة العميل (عربي أو إنجليزي)\n` +
        `- كن مختصراً وودوداً`;

    try {
        const result = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500,
        });
        const reply = result.choices[0]?.message?.content || '';
        console.log('✅ Groq رد:', reply.substring(0, 80) + '...');
        return reply;
    } catch (err) {
        console.error('❌ Groq error:', err.message);
        return 'عذراً، واجهت مشكلة تقنية. يرجى المحاولة مرة أخرى.';
    }
}

// ─── Facebook: إرسال رسالة ───────────────────────────────────────────────────
async function sendMessage(recipientId, text) {
    if (!PAGE_ACCESS_TOKEN) {
        console.error('❌ FACEBOOK_PAGE_ACCESS_TOKEN غير موجود');
        return;
    }

    const MAX = 2000;
    const parts = [];

    // تقسيم الرسائل الطويلة
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= MAX) { parts.push(remaining); break; }
        let cut = remaining.lastIndexOf('\n', MAX);
        if (cut < MAX / 2) cut = remaining.lastIndexOf(' ', MAX);
        if (cut < MAX / 2) cut = MAX;
        parts.push(remaining.slice(0, cut + 1).trim());
        remaining = remaining.slice(cut + 1).trim();
    }

    for (const part of parts) {
        try {
            await axios.post(
                `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
                { recipient: { id: recipientId }, message: { text: part }, messaging_type: 'RESPONSE' }
            );
            console.log(`📤 أُرسل إلى ${recipientId}: ${part.substring(0, 60)}...`);
        } catch (err) {
            console.error('❌ Facebook send error:', err.response?.data || err.message);
        }

        if (parts.length > 1) await new Promise(r => setTimeout(r, 400));
    }
}

// ─── Facebook: typing indicator ──────────────────────────────────────────────
async function setTyping(recipientId, on = true) {
    if (!PAGE_ACCESS_TOKEN) return;
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: recipientId }, sender_action: on ? 'typing_on' : 'typing_off' }
        );
    } catch (_) { /* typing errors are non-fatal */ }
}

// ─── GET /webhook  (Facebook verification) ───────────────────────────────────
app.get('/webhook', (req, res) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Facebook webhook verified');
        return res.status(200).send(challenge);
    }

    console.warn('❌ Webhook verification failed');
    res.status(403).send('Forbidden');
});

// ─── POST /webhook  (incoming messages) ──────────────────────────────────────
app.post('/webhook', (req, res) => {
    // يجب الرد بـ 200 فوراً قبل أي عملية
    res.status(200).send('EVENT_RECEIVED');

    const body = req.body;
    if (body?.object !== 'page' && body?.object !== 'instagram') return;

    const events = body?.entry?.[0]?.messaging ?? [];

    for (const event of events) {
        // تجاهل الرسائل الصادرة من البوت نفسه
        if (event.message?.is_echo) continue;

        const senderId = event.sender?.id;
        if (!senderId) continue;

        const text =
            event.message?.text    ||
            event.postback?.payload ||
            null;

        if (!text) {
            sendMessage(senderId, 'عذراً، أفهم الرسائل النصية فقط حالياً. كيف أساعدك؟');
            continue;
        }

        console.log(`\n💬 من ${senderId}: ${text}`);

        // معالجة غير متزامنة (لا تؤثر على الـ 200 OK)
        handleMessage(senderId, text);
    }
});

async function handleMessage(senderId, text) {
    try {
        await setTyping(senderId, true);

        const products = await fetchProducts();

        if (!products.length) {
            await sendMessage(senderId, 'عذراً، لا توجد منتجات متاحة حالياً. يرجى المحاولة لاحقاً.');
            await setTyping(senderId, false);
            return;
        }

        const reply = await getAIReply(text, products);
        await sendMessage(senderId, reply);
        await setTyping(senderId, false);

        console.log('✅ تمت معالجة الرسالة بنجاح');
    } catch (err) {
        console.error('❌ handleMessage error:', err.message);
        await sendMessage(senderId, 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.');
        await setTyping(senderId, false);
    }
}

// ─── GET /health ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        time: new Date().toISOString(),
        gemini:   !!process.env.GEMINI_API_KEY,
        supabase: !!process.env.SUPABASE_URL,
        facebook: !!PAGE_ACCESS_TOKEN,
    });
});

// ─── GET /test-db ─────────────────────────────────────────────────────────────
app.get('/test-db', async (_req, res) => {
    const data = await fetchProducts();
    res.json({ count: data.length, sample: data.slice(0, 3) });
});

// ─── تشغيل السيرفر (محلي أو Railway/Render) ─────────────────────────────────
if (process.env.NODE_ENV !== 'production_vercel') {
    app.listen(PORT, async () => {
        console.log('🚀 ==========================================');
        console.log(`✅ السيرفر شغال على: http://localhost:${PORT}`);
        console.log(`📡 Webhook:     http://localhost:${PORT}/webhook`);
        console.log(`🔑 Verify Token: ${VERIFY_TOKEN}`);
        console.log('🚀 ==========================================\n');

        // اختبار الاتصالات
        const products = await fetchProducts();
        console.log(`📦 Supabase: ${products.length} منتج`);

        try {
            await groq.chat.completions.create({
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'user', content: 'مرحبا' }],
                max_tokens: 10,
            });
            console.log('🤖 Groq AI: متصل');
        } catch (e) {
            console.log('❌ Groq AI:', e.message);
        }

        if (PAGE_ACCESS_TOKEN) {
            try {
                const r = await axios.get(`https://graph.facebook.com/v19.0/me?access_token=${PAGE_ACCESS_TOKEN}`);
                console.log('📘 Facebook Page:', r.data.name);
            } catch (e) {
                console.log('❌ Facebook:', e.response?.data?.error?.message || e.message);
            }
        }
    });
}

// ─── تصدير للـ Vercel ─────────────────────────────────────────────────────────
module.exports = app;
