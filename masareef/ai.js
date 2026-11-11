const { GoogleGenerativeAI } = require('@google/generative-ai');

const AVAILABLE_MODELS = [
    {
        id: 'auto',
        name: 'تلقائي ذكي (Auto Failover)',
        description: 'يختار أفضل موديل وينتقل تلقائياً للبديل عند الضغط'
    },
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'الجيل الأحدث - فائق السرعة لإدارة المصاريف والمحادثة'
    },
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description: 'تحليل مالي عميق وتخطيط ميزانية متقدم'
    },
    {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        description: 'أداء مستقر وسريع كبديل فوري'
    },
    {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        description: 'الموديل الكلاسيكي المتوافق'
    }
];

const MODEL_PRIORITY = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-pro',
    'gemini-1.5-flash'
];

// قاعدة بيانات أسعار طرطوس التقريبية (بالليرة السورية) التي يتم تحديثها واعتماد أسعار المستخدم الفعلية عليها
const DEFAULT_TARTUS_PRICE_BOOK = [
    { id: 'bread', name: 'ربطة خبز', unit: 'ربطة', price: 4000, category: 'Food', essential: true, userVerified: false },
    { id: 'tomato', name: 'بندورة طازجة', unit: '1 كغ', price: 8500, category: 'Food', essential: true, userVerified: false },
    { id: 'cucumber', name: 'خيار بلدي', unit: '1 كغ', price: 7500, category: 'Food', essential: true, userVerified: false },
    { id: 'potato', name: 'بطاطا', unit: '1 كغ', price: 9000, category: 'Food', essential: true, userVerified: false },
    { id: 'yogurt', name: 'لبن رائب', unit: '1 كغ', price: 11000, category: 'Food', essential: true, userVerified: false },
    { id: 'cheese', name: 'جبنة بيضاء بلدية', unit: '500 غ', price: 28000, category: 'Food', essential: false, userVerified: false },
    { id: 'eggs', name: 'طبق بيض (10 بيضات)', unit: '10 حبات', price: 18000, category: 'Food', essential: true, userVerified: false },
    { id: 'sugar', name: 'سكر أبيض', unit: '1 كغ', price: 18000, category: 'Food', essential: false, userVerified: false },
    { id: 'rice', name: 'رز قصير/مصري', unit: '1 كغ', price: 21000, category: 'Food', essential: false, userVerified: false },
    { id: 'oil', name: 'زيت نباتي للطبخ', unit: '1 ليتر', price: 37000, category: 'Food', essential: false, userVerified: false },
    { id: 'chicken', name: 'فروج منظف', unit: '1 كغ', price: 45000, category: 'Food', essential: false, userVerified: false },
    { id: 'chickpeas', name: 'حمص حب / بقوليات', unit: '1 كغ', price: 25000, category: 'Food', essential: false, userVerified: false },
    { id: 'yerba', name: 'متة / شاي للبيت', unit: 'علبة', price: 16000, category: 'Food', essential: false, userVerified: false },
    { id: 'fuel', name: 'بنزين / مواصلات يومية', unit: 'مشوار/ليتر', price: 15000, category: 'Transport', essential: true, userVerified: false }
];

let cachedClient = null;
let cachedApiKey = null;

function getClient(customApiKey) {
    const apiKey = customApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
        return null;
    }
    if (!cachedClient || cachedApiKey !== apiKey) {
        cachedClient = new GoogleGenerativeAI(apiKey);
        cachedApiKey = apiKey;
    }
    return cachedClient;
}

function buildModelChain(preferredModel = 'auto', autoFallback = true) {
    const validSpecific = MODEL_PRIORITY.includes(preferredModel) ? preferredModel : null;
    if (!validSpecific) {
        return [...MODEL_PRIORITY];
    }
    if (!autoFallback) {
        return [validSpecific];
    }
    return [validSpecific, ...MODEL_PRIORITY.filter(m => m !== validSpecific)];
}

async function generateWithFallback(prompt, options = {}) {
    const { preferredModel = 'auto', autoFallback = true, apiKey = null, jsonMode = false } = options;
    const client = getClient(apiKey);

    if (!client) {
        return {
            ok: false,
            reason: 'NO_API_KEY',
            modelUsed: 'local-smart-engine',
            fallbackUsed: true
        };
    }

    const chain = buildModelChain(preferredModel, autoFallback);
    const errors = [];

    for (let i = 0; i < chain.length; i++) {
        const modelName = chain[i];
        try {
            const generationConfig = jsonMode
                ? { responseMimeType: 'application/json', temperature: 0.3 }
                : { temperature: 0.4 };
            const model = client.getGenerativeModel({
                model: modelName,
                generationConfig
            });
            const result = await model.generateContent(prompt);
            const text = result.response.text();
            return {
                ok: true,
                text,
                modelUsed: modelName,
                fallbackUsed: i > 0,
                attemptedModels: chain.slice(0, i + 1)
            };
        } catch (err) {
            console.warn(`[Ryn AI] Model ${modelName} failed (${err.message}). Trying next fallback...`);
            errors.push({ model: modelName, error: err.message });
        }
    }

    return {
        ok: false,
        reason: 'ALL_MODELS_FAILED',
        errors,
        modelUsed: 'local-smart-engine',
        fallbackUsed: true
    };
}

function inferCategory(text) {
    const t = (text || '').toLowerCase();
    if (/كهرباء|ماء|مياه|غاز|إنترنت|انترنت|نت|فواتير|فاتورة|إيجار|ايجار|أمبير|امبير|bill|electric|water|internet|rent/.test(t)) return 'Utilities';
    if (/وقود|بنزين|مازوت|سيارة|تكسي|تاكسي|مواصلات|باص|سرفيس|transport|fuel|gas|car|taxi/.test(t)) return 'Transport';
    if (/طعام|أكل|اكل|سوبرماركت|خضار|فواكه|لحم|فروج|خبز|لبن|جبنة|بيض|زيت|سكر|رز|متة|مطعم|قهوة|سوق|بقالة|مقاضي|food|grocery|market/.test(t)) return 'Food';
    if (/دواء|طبيب|مشفى|مستشفى|صيدلية|علاج|صحة|health|doctor|medicine|pharmacy/.test(t)) return 'Health';
    if (/مدرسة|جامعة|كتب|قرطاسية|دورة|تعليم|education|school|course|book/.test(t)) return 'Education';
    if (/ملابس|تسوق|هدية|ترفيه|ألعاب|سينما|shopping|entertainment|clothes|gift/.test(t)) return 'Shopping';
    return 'Other';
}

function localConversationalEngine(userMessage, context = {}) {
    const msg = (userMessage || '').trim();
    const expenses = Array.isArray(context.expenses) ? context.expenses : [];
    const budget = Number(context.budget) || 3500000;
    const priceBook = Array.isArray(context.priceBook) ? context.priceBook : DEFAULT_TARTUS_PRICE_BOOK;
    const actions = [];
    let replyAr = '';
    let replyEn = '';

    const normalizedDigits = msg.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

    // 1. فحص أمر "تم الشراء" أو "اشتريت كذا بسعر كذا اعتمد السعر"
    if (/(?:تم شراء|تم الشراء|اشتريت|جبنا|اخذت|أخذت|اعتمد السعر|اعتمد سعر|سعره بطرطوس)/i.test(normalizedDigits)) {
        const amountMatch = normalizedDigits.match(/(\d+(?:\.\d+)?)/);
        if (amountMatch) {
            let amount = Number(amountMatch[1]);
            if (/ألف|الف/.test(normalizedDigits) && amount < 1000) amount *= 1000;
            if (/مليون/.test(normalizedDigits) && amount < 1000) amount *= 1000000;

            let itemName = normalizedDigits
                .replace(/(?:تم شراء|تم الشراء|اشتريت|جبنا|اخذت|أخذت|اعتمد السعر|اعتمد سعر|سعره بطرطوس|بسعر|بقيمة|بمبلغ|بـ|ليرة|سورية|ألف|الف|اليوم)/gi, ' ')
                .replace(amountMatch[0], ' ')
                .replace(/[،,.:؛!؟?\-+]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (!itemName || itemName.length < 2) itemName = 'مشتريات بقالة يومية';
            const category = inferCategory(itemName);

            actions.push({
                type: 'purchase_and_learn_price',
                itemName,
                actualPrice: amount,
                category
            });

            replyAr = `✅ تم تسجيل شراء "${itemName}" بسعر ${amount.toLocaleString()} ل.س، واعتمدت هذا السعر الفعلي في ذاكرة أسعار طرطوس لدي ليُستخدم في حسابات الأيام القادمة!`;
            replyEn = `✅ Recorded purchase of "${itemName}" at ${amount.toLocaleString()} SYP and locked in this actual price in my Tartus price memory for future daily plans!`;
            return { text: replyAr, translation: replyEn, actions };
        }
    }

    // 2. فحص السؤال عن أسعار طرطوس
    if (/(?:سعر|أسعار|اسعار|بكم|قديش|طرطوس)/i.test(normalizedDigits) && !/(?:أضف|اضف|عدّل|عدل|احذف)/i.test(normalizedDigits)) {
        const matchedItem = priceBook.find(p => normalizedDigits.includes(p.name.split(' ')[0]) || normalizedDigits.includes(p.name));
        if (matchedItem) {
            const statusText = matchedItem.userVerified ? 'معتمد من مشترياتك الفعلية ✅' : 'سعر تقريبي في أسواق طرطوس 📍';
            replyAr = `سعر "${matchedItem.name}" (${matchedItem.unit}) في طرطوس حالياً هو حوالي ${Number(matchedItem.price).toLocaleString()} ل.س (${statusText}). عندما تشتريه أخبرني بالسعر الفعلي وسأعتمده فوراً!`;
            replyEn = `The price of "${matchedItem.name}" (${matchedItem.unit}) in Tartus is around ${Number(matchedItem.price).toLocaleString()} SYP (${statusText}). Tell me the actual price when you buy it and I'll lock it in!`;
            return { text: replyAr, translation: replyEn, actions };
        }
    }

    // 3. فحص أمر تقسيم أو تعديل الميزانية الشهرية
    const budgetMatch = normalizedDigits.match(/(?:ميزانيتنا|الميزانية|ميزانية|ميزانيتي|راتبي|مبلغ|قسّم|قسم|budget)\s*(?:الشهرية|الشهري)?\s*(?:إلى|الى|بـ|ب|هي|=|:|خليها|اجعلها|تكون|خلي)?\s*(\d+(?:\.\d+)?)/i);
    if (budgetMatch) {
        let newBudget = Number(budgetMatch[1]);
        if (/مليون/.test(normalizedDigits) && newBudget < 1000) newBudget *= 1000000;
        if (/ألف|الف/.test(normalizedDigits) && newBudget < 10000) newBudget *= 1000;
        if (newBudget > 0) {
            actions.push({ type: 'set_budget', budget: newBudget });
            const dailyFood = Math.round((newBudget * 0.45) / 30);
            replyAr = `🎯 تم اعتماد الميزانية الشهرية (${newBudget.toLocaleString()} ل.س) وتقسيمها ذكياً على الفئات! حصّة البقالة والطعام اليومية هي ${dailyFood.toLocaleString()} ل.س يومياً، وجهزت لك قائمة مشتريات اليوم بالأسعار.`;
            replyEn = `🎯 Monthly budget set to ${newBudget.toLocaleString()} SYP and split across categories! Your daily grocery allowance is ${dailyFood.toLocaleString()} SYP/day.`;
            return { text: replyAr, translation: replyEn, actions };
        }
    }

    // 4. فحص أمر الحذف من خلال الحوار
    if (/(?:احذف|امسح|شيل|الغ|إلغاء|حذف|delete|remove)/i.test(normalizedDigits)) {
        let target = null;
        if (/(?:آخر|اخر|last|latest)/i.test(normalizedDigits) && expenses.length > 0) {
            target = expenses[expenses.length - 1];
        } else {
            target = expenses.find(e => e.name && normalizedDigits.includes(e.name));
        }
        if (target) {
            actions.push({ type: 'delete_expense', id: target.id, matchName: target.name });
            replyAr = `🗑️ تم حذف مصروف "${target.name}" (${Number(target.amount).toLocaleString()} ل.س) من السجل.`;
            replyEn = `🗑️ Deleted expense "${target.name}" (${Number(target.amount).toLocaleString()} SYP).`;
            return { text: replyAr, translation: replyEn, actions };
        }
    }

    // 5. فحص أمر التعديل من خلال الحوار
    if (/(?:عدل|عدّل|غير|غيّر|حدث|حدّث|خلي|اجعل|update|edit|change|modify)/i.test(normalizedDigits)) {
        const numMatches = [...normalizedDigits.matchAll(/(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
        let newAmount = numMatches.length > 0 ? numMatches[numMatches.length - 1] : null;
        if (newAmount && /ألف|الف/.test(normalizedDigits) && newAmount < 1000) newAmount *= 1000;
        let target = expenses.find(e => e.name && normalizedDigits.includes(e.name));
        if (target && newAmount && newAmount > 0) {
            actions.push({
                type: 'update_expense',
                id: target.id,
                matchName: target.name,
                updates: { amount: newAmount }
            });
            replyAr = `✏️ تم تعديل مصروف "${target.name}" ليصبح ${newAmount.toLocaleString()} ل.س.`;
            replyEn = `✏️ Updated expense "${target.name}" to ${newAmount.toLocaleString()} SYP.`;
            return { text: replyAr, translation: replyEn, actions };
        }
    }

    // 6. فحص أمر الإضافة من خلال الحوار
    if (/(?:أضف|اضف|سجل|ضفلي|ضف|دفعت|صرفنا|صرفت|مصروف|فاتورة|add|spent|paid)/i.test(normalizedDigits)) {
        const amountMatch = normalizedDigits.match(/(\d+(?:\.\d+)?)/);
        if (amountMatch) {
            let amount = Number(amountMatch[1]);
            if (/ألف|الف/.test(normalizedDigits) && amount < 1000) amount *= 1000;
            let name = normalizedDigits
                .replace(/(?:أضف|اضف|سجل|ضفلي|ضف|دفعت|صرفنا|صرفت|مصروف جديد|مصروف|بمبلغ|بقيمة|بسعر|ليرة|سورية|ألف|الف|اليوم|add|spent|paid)/gi, ' ')
                .replace(amountMatch[0], ' ')
                .replace(/[،,.:؛!؟?\-+]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (!name || name.length < 2) name = 'مصروف عائلي';
            const category = inferCategory(name + ' ' + normalizedDigits);
            if (amount > 0) {
                actions.push({
                    type: 'purchase_and_learn_price',
                    itemName: name,
                    actualPrice: amount,
                    category
                });
                replyAr = `✅ تم تسجيل مصروف "${name}" بقيمة ${amount.toLocaleString()} ل.س واعتماد سعره في ذاكرة طرطوس.`;
                replyEn = `✅ Logged "${name}" for ${amount.toLocaleString()} SYP and updated Tartus price memory.`;
                return { text: replyAr, translation: replyEn, actions };
            }
        }
    }

    // 7. فحص أمر حفظ ملاحظة في الذاكرة
    if (/(?:تذكر|احفظ في الذاكرة|ملاحظة للذاكرة|لا تنس|remember|memorize)/i.test(normalizedDigits)) {
        const fact = normalizedDigits.replace(/^(?:تذكر أن|تذكر ان|تذكر|احفظ في الذاكرة|ملاحظة للذاكرة|لا تنس أن|remember that|remember)/i, '').trim();
        if (fact) {
            actions.push({ type: 'add_memory', fact });
            replyAr = `🧠 حفظت ذلك في ذاكرتي الدائمة وعلى ملف الجهاز: "${fact}".`;
            replyEn = `🧠 Saved to persistent memory and device file: "${fact}".`;
            return { text: replyAr, translation: replyEn, actions };
        }
    }

    const total = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const dailyAllowance = Math.round((budget * 0.45) / 30);
    replyAr = `أهلاً حيدر! ميزانية البقالة اليومية المخصصة لك هي ${dailyAllowance.toLocaleString()} ل.س (من أصل ميزانية شهرية ${budget.toLocaleString()} ل.س، صُرف منها ${total.toLocaleString()} ل.س). يمكنك سؤالي عن أسعار طرطوس، أو قول "اشتريت سكر بـ 19000" لأعتمد السعر الفعلي وأسجله فوراً!`;
    replyEn = `Hello Haidar! Your daily grocery allowance is ${dailyAllowance.toLocaleString()} SYP (out of a ${budget.toLocaleString()} SYP monthly budget). Ask me about Tartus prices or tell me what you bought and at what price so I can adopt it!`;

    return { text: replyAr, translation: replyEn, actions };
}

async function chatRyn(payload) {
    const userMessage = typeof payload === 'string' ? payload : (payload?.message || '');
    const expenses = payload?.expenses || [];
    const budget = Number(payload?.budget) || 3500000;
    const priceBook = payload?.priceBook || DEFAULT_TARTUS_PRICE_BOOK;
    const memory = payload?.memory || [];
    const history = (payload?.history || []).slice(-8);
    const preferredModel = payload?.model || process.env.DEFAULT_AI_MODEL || 'auto';
    const autoFallback = payload?.autoFallback !== false;
    const apiKey = payload?.apiKey || null;

    const systemPrompt = `
أنت "Ryn"، المساعد المالي الذكي ومدير مقاضي العائلة في مدينة طرطوس، سوريا، للمستخدم "حيدر".
مهامك الأساسية:
1. تقسيم الميزانية الشهرية على الفئات واقتراح ما يشتريه المستخدم كل يوم من البقالة والخضار ضمن المخصص اليومي.
2. معرفة الأسعار التقريبية في طرطوس - سوريا بالليرة السورية، وعندما يخبرك المستخدم أنه اشترى غرضاً بسعر معين، تعتمد السعر الفعلي الذي اشترى به كسعر أساسي في ذاكرة الأسعار (purchase_and_learn_price).
3. إضافة أو تعديل أو حذف المصاريف وتحديث الميزانية والذاكرة من خلال الحوار.

البيانات الحالية:
- الميزانية الشهرية: ${budget} ل.س
- أسعار طرطوس الحالية (المعتمدة والتقريبية): ${JSON.stringify(priceBook)}
- قائمة المصاريف الحالية: ${JSON.stringify(expenses)}
- ذاكرة العائلة: ${JSON.stringify(memory)}
- آخر المحادثات: ${JSON.stringify(history)}

رسالة المستخدم: "${userMessage}"

أعد كائن JSON صالحاً فقط يحتوي على:
{
  "text": "ردك الذكي بالعربية (اذكر الأسعار بالليرة السورية في طرطوس بوضوح)",
  "translation": "English translation of your reply",
  "actions": [
    // عند شراء غرض أو اعتماد سعر جديد: { "type": "purchase_and_learn_price", "itemName": "اسم الغرض", "actualPrice": 18000, "category": "Food" }
    // عند تحديث سعر غرض في طرطوس بدون شرائه: { "type": "update_price_book", "itemName": "اسم الغرض", "newPrice": 18000 }
    // عند إضافة مصروف عام: { "type": "add_expense", "expense": { "name": "الاسم", "amount": 15000, "category": "Food|Utilities|Transport|Health|Education|Shopping|Other" } }
    // عند تعديل مصروف: { "type": "update_expense", "id": 123, "matchName": "الاسم", "updates": { "amount": 20000 } }
    // عند حذف مصروف: { "type": "delete_expense", "id": 123, "matchName": "الاسم" }
    // عند تحديد الميزانية الشهرية: { "type": "set_budget", "budget": 4000000 }
    // عند حفظ معلومة بالذاكرة: { "type": "add_memory", "fact": "المعلومة" }
  ]
}
`;

    const aiResult = await generateWithFallback(systemPrompt, {
        preferredModel,
        autoFallback,
        apiKey,
        jsonMode: true
    });

    if (aiResult.ok && aiResult.text) {
        try {
            const cleaned = aiResult.text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            return {
                text: parsed.text || aiResult.text,
                translation: parsed.translation || '',
                actions: Array.isArray(parsed.actions) ? parsed.actions : [],
                modelUsed: aiResult.modelUsed,
                fallbackUsed: aiResult.fallbackUsed,
                attemptedModels: aiResult.attemptedModels
            };
        } catch (_) {
            const localCheck = localConversationalEngine(userMessage, { expenses, budget, priceBook });
            return {
                text: aiResult.text,
                translation: localCheck.translation,
                actions: localCheck.actions,
                modelUsed: aiResult.modelUsed,
                fallbackUsed: aiResult.fallbackUsed
            };
        }
    }

    const fallbackResponse = localConversationalEngine(userMessage, { expenses, budget, priceBook });
    return {
        ...fallbackResponse,
        modelUsed: aiResult.modelUsed || 'local-smart-engine',
        fallbackUsed: true
    };
}

async function analyzeExpenses(expenses, options = {}) {
    const preferredModel = options.model || process.env.DEFAULT_AI_MODEL || 'auto';
    const autoFallback = options.autoFallback !== false;
    const budget = Number(options.budget) || 3500000;
    const memory = options.memory || [];

    const total = (expenses || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const byCat = {};
    (expenses || []).forEach(e => {
        const c = e.category || 'Other';
        byCat[c] = (byCat[c] || 0) + (Number(e.amount) || 0);
    });

    const prompt = `
حلل مصاريف عائلة حيدر في طرطوس - سوريا وقدم خطة توفير ذكية بالعربية مع ترجمتها للإنجليزية.
الميزانية الشهرية: ${budget} ل.س
إجمالي الإنفاق: ${total} ل.س
المصاريف: ${JSON.stringify(expenses)}
الذاكرة: ${JSON.stringify(memory)}

أعد النتيجة بصيغة JSON فقط:
{
  "insight": "التحليل المالي بالعربية مع نصيحة لمشتريات البقالة اليومية في طرطوس",
  "insightEn": "English translation of the financial analysis",
  "healthScore": 85
}
`;

    const aiResult = await generateWithFallback(prompt, {
        preferredModel,
        autoFallback,
        apiKey: options.apiKey || null,
        jsonMode: true
    });

    if (aiResult.ok && aiResult.text) {
        try {
            const cleaned = aiResult.text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            return {
                insight: parsed.insight || aiResult.text,
                insightEn: parsed.insightEn || '',
                healthScore: parsed.healthScore ?? 85,
                modelUsed: aiResult.modelUsed,
                fallbackUsed: aiResult.fallbackUsed
            };
        } catch (_) {
            return {
                insight: aiResult.text,
                insightEn: '',
                healthScore: 85,
                modelUsed: aiResult.modelUsed,
                fallbackUsed: aiResult.fallbackUsed
            };
        }
    }

    const sortedCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const topCat = sortedCats[0] ? `${sortedCats[0][0]} (${sortedCats[0][1].toLocaleString()} ل.س)` : 'لا يوجد';
    const ratio = budget > 0 ? Math.round((total / budget) * 100) : 0;
    const dailyFoodBudget = Math.round((budget * 0.45) / 30);

    return {
        insight: `📊 تحليل ميزانية طرطوس الذكي:\n• إجمالي الإنفاق: ${total.toLocaleString()} ل.س من أصل ${budget.toLocaleString()} ل.س (${ratio}%).\n• مخصص البقالة اليومي المقترح: ${dailyFoodBudget.toLocaleString()} ل.س يومياً.\n• الفئة الأعلى استهلاكاً: ${topCat}.\n• نصيحة Ryn: اعتمد الأسعار الفعلية بعد كل عملية شراء ليقوم النظام بضبط سلة مشتريات الغد تلقائياً!`,
        insightEn: `📊 Smart Tartus Budget Analysis:\n• Total Spent: ${total.toLocaleString()} SYP of ${budget.toLocaleString()} SYP (${ratio}%).\n• Recommended Daily Grocery Limit: ${dailyFoodBudget.toLocaleString()} SYP/day.\n• Top Category: ${topCat}.`,
        healthScore: Math.max(15, Math.min(100, 100 - Math.max(0, ratio - 50))),
        modelUsed: 'local-smart-engine',
        fallbackUsed: true
    };
}

function getAIStatus() {
    const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here');
    return {
        configuredOnServer: hasKey,
        defaultModel: process.env.DEFAULT_AI_MODEL || 'auto',
        availableModels: AVAILABLE_MODELS
    };
}

module.exports = {
    chatRyn,
    analyzeExpenses,
    getAIStatus,
    AVAILABLE_MODELS,
    DEFAULT_TARTUS_PRICE_BOOK
};
