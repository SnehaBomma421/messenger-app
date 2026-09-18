const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

/**
 * Express middleware — verifies Bearer JWT from Authorization header.
 * Attaches decoded { userId, username } to req.user.
 */
function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { userId, username }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Socket.io middleware — verifies token from handshake.auth.token.
 * Attaches userId and username to socket.
 */
function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    socket.username = decoded.username;
    socket.displayName = decoded.displayName;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
}

module.exports = { requireAuth, socketAuth, JWT_SECRET };
