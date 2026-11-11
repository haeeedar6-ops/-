const jwt = require('jsonwebtoken');

// مفتاح احتياطي للتطوير المحلي فقط في حال نسيان ضبط JWT_SECRET في .env
const getJwtSecret = () => {
    return process.env.JWT_SECRET || 'hydr-family-expense-default-local-secret-2026';
};

/**
 * دالة التحقق من التوكن لحماية مسارات المصاريف والذكاء الاصطناعي
 */
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(403).json({ error: 'مرفوض: لا يوجد توكن مصادقة صالح' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, getJwtSecret());
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'غير مصرح: التوكن غير صالح أو منتهي الصلاحية' });
    }
};

module.exports = { verifyToken, getJwtSecret };
