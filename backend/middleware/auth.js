const jwt = require('jsonwebtoken');
const env = require('../config/env');

const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    // ⚠️ ต้องระบุ algorithms เสมอ — ไม่ระบุ = ยอมให้ผู้ส่ง token เลือก alg เองผ่าน header
    // (jwt.sign ทั้งระบบใช้ default HS256 อยู่แล้ว ค่านี้จึงตรงกันสองฝั่ง token เดิมไม่พัง)
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token.' });
  }
};

// requireRole('ADMIN', 'PLANNER') — ใช้ต่อจาก verifyToken เสมอ
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: `ต้องมีสิทธิ์: ${roles.join(' หรือ ')}` });
  }
  next();
};

module.exports = { verifyToken, requireRole };
