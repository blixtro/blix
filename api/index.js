// ============================================
// استيراد الحزم المطلوبة
// ============================================
const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
require('dotenv').config();

// ============================================
// إعدادات التطبيق
// ============================================
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ============================================
// إعداد Supabase Client
// ============================================
const supabaseUrl = process.env.SUPABASE_URL || 'https://sqwrumirftrrsvntbgmp.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxd3J1bWlyZnRycnN2bnRiZ21wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxODQ5NDcsImV4cCI6MjA5NDc2MDk0N30.kRjBMtLHqw89ynGgW2Y34Hgt1sXzN7EOH97__iZvT4k';

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
});

// ============================================
// إعداد Gemini AI
// ============================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// ============================================
// إعداد Facebook
// ============================================
const FACEBOOK_VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN || 'blixtro@2026';
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

// ============================================
// دوال مساعدة
// ============================================

/**
 * جلب جميع البيانات من جدول blixtro
 */
async function fetchBlixtroData() {
    try {
        const { data, error } = await supabase
            .from('blixtro')
            .select('*')
            .order('id', { ascending: true });

        if (error) {
            console.error('❌ خطأ في جلب بيانات Supabase:', error);
            throw error;
        }

        console.log('✅ تم جلب البيانات من Supabase:', data?.length, 'صف');
        return data || [];
    } catch (error) {
        console.error('❌ فشل جلب البيانات من Supabase:', error.message);
        return [];
    }
}

/**
 * تنسيق بيانات المنتجات لصيغة نصية واضحة
 */
function formatProductsData(products) {
    if (!products || products.length === 0) {
        return 'لا توجد منتجات متاحة حالياً.';
    }

    let formattedText = '📦 **قائمة المنتجات المتاحة:**\n\n';
    
    products.forEach((product, index) => {
        const availability = product.available ? '✅ متوفر' : '❌ غير متوفر';
        const price = product.price ? `${product.price} جنيه` : 'غير محدد';
        const stock = product.stock !== null ? `${product.stock} قطعة` : 'غير محدد';
        const shipping = product.shipping ? `${product.shipping} جنيه` : 'غير محدد';
        
        formattedText += `${index + 1}. **${product.name || 'منتج بدون اسم'}**\n`;
        formattedText += `   💰 السعر: ${price}\n`;
        formattedText += `   📦 المخزون: ${stock}\n`;
        formattedText += `   🚚 الشحن: ${shipping}\n`;
        formattedText += `   ${availability}\n`;
        if (product.about) {
            formattedText += `   📝 وصف: ${product.about}\n`;
        }
        formattedText += '\n';
    });

    return formattedText;
}

/**
 * بناء الـ Prompt المخصص لـ Gemini
 */
function buildGeminiPrompt(userMessage, productsData) {
    // استخراج نمط الـ AI من أول منتج (أو يمكنك تخصيصه)
    const aiMode = productsData[0]?.ai_mode || 'مهذب ومحترف';
    const storeDescription = productsData[0]?.about || 'متجر الكتروني متخصص';

    const productsText = formatProductsData(productsData);

    const prompt = `
أنت مساعد مبيعات ذكي لمتجر إلكتروني. معلومات المتجر: ${storeDescription}

**أسلوب الرد المطلوب:** ${aiMode}

**بيانات المنتجات المتاحة:**
${productsText}

**رسالة العميل:** ${userMessage}

**تعليمات الرد:**
1. قم بالرد على استفسار العميل بناءً على البيانات المتاحة أعلاه فقط.
2. إذا سأل عن منتج غير موجود، أخبره بلطف أنه غير متوفر حالياً.
3. ركز على المنتجات المتوفرة (✅ متوفر) وتجاهل غير المتوفرة ما لم يسأل عنها تحديداً.
4. كن دقيقاً في الأسعار والمخزون وأسعار الشحن كما هي مذكورة أعلاه.
5. استخدم أسلوب ${aiMode} في الرد.
6. قدم اقتراحات بديلة إذا كان المنتج المطلوب غير متوفر.
7. أضف إيموجي مناسب للرد ليكون ودوداً.
8. لا تذكر أنك AI أو نموذج لغوي.
9. رد باللغة العربية الفصحى أو العامية المهذبة حسب رسالة العميل.
10. حافظ على الإيجاز والتركيز على مساعدة العميل في قرار الشراء.

**الرد المطلوب:**`;

    return prompt;
}

/**
 * إرسال رسالة إلى Facebook Messenger
 */
async function sendFacebookMessage(senderId, messageText) {
    try {
        if (!FACEBOOK_PAGE_ACCESS_TOKEN) {
            console.error('❌ لم يتم تعيين FACEBOOK_PAGE_ACCESS_TOKEN');
            return false;
        }

        const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${FACEBOOK_PAGE_ACCESS_TOKEN}`;
        
        const messageData = {
            recipient: { id: senderId },
            message: { text: messageText },
            messaging_type: 'RESPONSE'
        };

        const response = await axios.post(url, messageData);
        
        console.log('✅ تم إرسال الرسالة إلى:', senderId);
        console.log('📤 محتوى الرسالة:', messageText.substring(0, 100) + '...');
        
        return true;
    } catch (error) {
        console.error('❌ خطأ في إرسال رسالة فيسبوك:', error.response?.data || error.message);
        return false;
    }
}

/**
 * إرسال إشعار "جاري الكتابة..." للمستخدم
 */
async function sendTypingIndicator(senderId, action = 'typing_on') {
    try {
        if (!FACEBOOK_PAGE_ACCESS_TOKEN) return;

        const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${FACEBOOK_PAGE_ACCESS_TOKEN}`;
        
        await axios.post(url, {
            recipient: { id: senderId },
            sender_action: action
        });
    } catch (error) {
        console.error('❌ خطأ في إرسال مؤشر الكتابة:', error.message);
    }
}

/**
 * معالجة الرسالة الواردة باستخدام Gemini AI
 */
async function processMessageWithAI(userMessage, productsData) {
    try {
        const prompt = buildGeminiPrompt(userMessage, productsData);
        
        console.log('🤖 جاري إرسال الطلب إلى Gemini...');
        console.log('📝 طول الـ Prompt:', prompt.length, 'حرف');
        
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();
        
        console.log('✅ تم استلام رد من Gemini:', text.substring(0, 100) + '...');
        
        return text;
    } catch (error) {
        console.error('❌ خطأ في Gemini API:', error.message);
        
        // رد احتياطي في حالة فشل Gemini
        return `عذراً، أواجه مشكلة تقنية حالياً. يمكنني مساعدتك في:\n\n` +
               formatProductsData(productsData).substring(0, 500) +
               `\n\nيرجى المحاولة مرة أخرى بعد قليل.`;
    }
}

// ============================================
// Webhook Verification (GET)
// ============================================
app.get('/webhook', (req, res) => {
    console.log('🔍 طلب تحقق GET من فيسبوك');
    
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // هنجيب التوكن من البيئة المحيطة بالسيرفر (Vercel Env)
    const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN || 'blixtro@2026';

    console.log('📥 mode:', mode);
    console.log('📥 token:', token);
    console.log('📥 challenge:', challenge);

    if (mode === 'subscribe' && token === verifyToken) {
        console.log('✅ تم التحقق بنجاح!');
        // Vercel بيحب الـ send المباشر مع الـ challenge كـ text
        return res.status(200).send(challenge);
    } else {
        console.log('❌ فشل التحقق - Token غير متطابق');
        return res.status(403).send('Verification failed');
    }
});

// ============================================
// Webhook لاستقبال الرسائل (POST)
// ============================================
app.post('/webhook', async (req, res) => {
    console.log('\n📨 ====== رسالة جديدة من ماسنجر ======');
    console.log('🕐 الوقت:', new Date().toLocaleString('ar-EG'));
    
    // الرد السريع على فيسبوك (200 OK) خلال 20 ثانية
    res.status(200).send('EVENT_RECEIVED');

    try {
        const body = req.body;
        
        // التحقق من هيكل البيانات
        if (!body.entry || !body.entry[0] || !body.entry[0].messaging) {
            console.log('⚠️ هيكل البيانات غير صحيح');
            return;
        }

        const messagingEvents = body.entry[0].messaging;

        for (const event of messagingEvents) {
            // تجاهل الرسائل المرسلة من البوت نفسه
            if (event.message?.is_echo) {
                console.log('↩️ تجاهل رسالة echo من البوت');
                continue;
            }

            const senderId = event.sender?.id;
            
            // استخراج النص من الرسالة
            let messageText = '';
            if (event.message?.text) {
                messageText = event.message.text;
            } else if (event.postback?.payload) {
                messageText = event.postback.payload;
            } else {
                console.log('⚠️ نوع رسالة غير مدعوم');
                await sendFacebookMessage(senderId, 'عذراً، أستطيع فهم الرسائل النصية فقط حالياً. كيف يمكنني مساعدتك؟');
                continue;
            }

            if (!senderId || !messageText) {
                console.log('⚠️ بيانات المرسل أو الرسالة غير مكتملة');
                continue;
            }

            console.log('👤 sender_id:', senderId);
            console.log('💬 message:', messageText);

            // الخطوة 1: إرسال مؤشر الكتابة
            await sendTypingIndicator(senderId, 'typing_on');

            // الخطوة 2: جلب بيانات المنتجات من Supabase
            console.log('🔍 جاري جلب بيانات المنتجات...');
            const productsData = await fetchBlixtroData();

            if (!productsData || productsData.length === 0) {
                console.log('⚠️ لا توجد منتجات في قاعدة البيانات');
                await sendFacebookMessage(
                    senderId,
                    'عذراً، لا توجد منتجات متاحة حالياً في المتجر. يرجى المحاولة لاحقاً.'
                );
                await sendTypingIndicator(senderId, 'typing_off');
                continue;
            }

            // الخطوة 3: معالجة الرسالة باستخدام Gemini AI
            console.log('🤖 جاري معالجة الرسالة بالذكاء الاصطناعي...');
            const aiResponse = await processMessageWithAI(messageText, productsData);

            // الخطوة 4: إرسال الرد إلى المستخدم
            console.log('📤 جاري إرسال الرد...');
            
            // تقسيم الرسائل الطويلة إذا لزم الأمر (فيسبوك يسمح بـ 2000 حرف)
            const MAX_LENGTH = 2000;
            if (aiResponse.length > MAX_LENGTH) {
                const parts = [];
                let remaining = aiResponse;
                
                while (remaining.length > 0) {
                    if (remaining.length <= MAX_LENGTH) {
                        parts.push(remaining);
                        break;
                    }
                    
                    let splitIndex = remaining.lastIndexOf('\n', MAX_LENGTH);
                    if (splitIndex === -1 || splitIndex < MAX_LENGTH / 2) {
                        splitIndex = remaining.lastIndexOf('.', MAX_LENGTH);
                    }
                    if (splitIndex === -1 || splitIndex < MAX_LENGTH / 2) {
                        splitIndex = MAX_LENGTH;
                    }
                    
                    parts.push(remaining.substring(0, splitIndex + 1));
                    remaining = remaining.substring(splitIndex + 1);
                }
                
                for (const part of parts) {
                    await sendFacebookMessage(senderId, part.trim());
                    // انتظار قصير بين الرسائل
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } else {
                await sendFacebookMessage(senderId, aiResponse);
            }

            // إيقاف مؤشر الكتابة
            await sendTypingIndicator(senderId, 'typing_off');
            
            console.log('✅ تمت معالجة الرسالة بنجاح');
        }
    } catch (error) {
        console.error('❌ خطأ في معالجة الـ Webhook:', error);
        
        // محاولة إرسال رسالة خطأ للمستخدم إذا أمكن
        if (event?.sender?.id) {
            await sendFacebookMessage(
                event.sender.id,
                'عذراً، حدث خطأ غير متوقع. فريقنا يعمل على حله. يرجى المحاولة لاحقاً.'
            );
        }
    }
    
    console.log('====== نهاية معالجة الرسالة ======\n');
});

// ============================================
// Health Check Endpoint
// ============================================
app.get('/health', (req, res) => {
    res.json({
        status: 'active',
        timestamp: new Date().toISOString(),
        services: {
            supabase: !!supabaseUrl,
            gemini: !!process.env.GEMINI_API_KEY,
            facebook: !!FACEBOOK_PAGE_ACCESS_TOKEN
        }
    });
});

// ============================================
// اختبار الاتصال بـ Supabase
// ============================================
app.get('/test-db', async (req, res) => {
    try {
        const data = await fetchBlixtroData();
        res.json({
            success: true,
            count: data.length,
            products: data.slice(0, 5) // عرض أول 5 منتجات فقط للاختبار
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// تشغيل السيرفر
// ============================================
app.listen(PORT, () => {
    console.log('🚀 ==========================================');
    console.log('🤖 Blixtro Messenger Bot Server');
    console.log('🚀 ==========================================');
    console.log(`✅ السيرفر يعمل على المنفذ: ${PORT}`);
    console.log(`📡 Webhook URL: http://localhost:${PORT}/webhook`);
    console.log(`🔑 Verify Token: ${FACEBOOK_VERIFY_TOKEN}`);
    console.log(`📊 Supabase: ${supabaseUrl ? 'متصل' : 'غير متصل'}`);
    console.log(`🤖 Gemini AI: ${process.env.GEMINI_API_KEY ? 'متصل' : 'غير متصل'}`);
    console.log(`📘 Facebook: ${FACEBOOK_PAGE_ACCESS_TOKEN ? 'متصل' : 'غير متصل'}`);
    console.log('🚀 ==========================================\n');
    
    // اختبار الاتصال عند بدء التشغيل
    testConnections();
});

// ============================================
// اختبار جميع الاتصالات عند بدء التشغيل
// ============================================
async function testConnections() {
    console.log('🔍 جاري اختبار الاتصالات...\n');
    
    // اختبار Supabase
    try {
        const data = await fetchBlixtroData();
        console.log('✅ Supabase: متصل -', data.length, 'منتج في الجدول');
    } catch (error) {
        console.log('❌ Supabase: فشل الاتصال -', error.message);
    }
    
    // اختبار Gemini
    try {
        const testResult = await model.generateContent('قل مرحباً');
        console.log('✅ Gemini AI: متصل وجاهز');
    } catch (error) {
        console.log('❌ Gemini AI: فشل الاتصال -', error.message);
    }
    
    // اختبار Facebook
    if (FACEBOOK_PAGE_ACCESS_TOKEN) {
        try {
            const url = `https://graph.facebook.com/v18.0/me?access_token=${FACEBOOK_PAGE_ACCESS_TOKEN}`;
            const response = await axios.get(url);
            console.log('✅ Facebook: متصل - الصفحة:', response.data.name);
        } catch (error) {
            console.log('❌ Facebook: فشل الاتصال -', error.response?.data?.error?.message || error.message);
        }
    } else {
        console.log('⚠️ Facebook: لم يتم تعيين PAGE_ACCESS_TOKEN');
    }
    
    console.log('\n✨ الاختبارات اكتملت!\n');
}

// ============================================
// معالجة الأخطاء العامة
// ============================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ خطأ غير معالج:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ استثناء غير معالج:', error);
});
