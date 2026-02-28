const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
  // Try cookie first, then Authorization header
  const token = req.cookies?.session
    || (req.headers.authorization?.startsWith('Bearer ') && req.headers.authorization.slice(7));

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      learnwordsUserId: decoded.learnwordsUserId,
      categorySlugs: decoded.categorySlugs || [],
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = { requireAuth };
