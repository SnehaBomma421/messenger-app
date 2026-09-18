require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { requireAuth, socketAuth, JWT_SECRET } = require('./middleware/auth');
const User = require('./models/User');
const Message = require('./models/Message');
const Room = require('./models/Room');

// ── App Setup ─────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── MongoDB ───────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/messengerapp';
const PORT = process.env.PORT || 3000;

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 8000
    });

    console.log('✅ MongoDB connected');
    await seedRooms();
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
}
async function seedRooms() {
  if (await Room.countDocuments() === 0) {
    await Room.insertMany([
      { name: 'general', displayName: 'General', description: 'The main hangout 🏠', createdBy: 'system' },
      { name: 'random', displayName: 'Random', description: 'Anything goes 🎲', createdBy: 'system' },
      { name: 'gaming', displayName: 'Gaming', description: 'Talk games 🎮', createdBy: 'system' },
    ]);
    console.log('🌱 Seeded default rooms');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), username: user.username, displayName: user.displayName },
    JWT_SECRET,
    { expiresIn: '14d' }
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// REST API — Auth
// ═════════════════════════════════════════════════════════════════════════════

// Register
app.post('/api/auth/register', async (req, res) => {
  const { username, displayName, password } = req.body;
  if (!username || !displayName || !password)
    return res.status(400).json({ error: 'username, displayName and password are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username: username.toLowerCase(), displayName, passwordHash });
    const token = signToken(user);
    res.status(201).json({ token, user: user.toPublic() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Username already taken' });
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid username or password' });
    const token = signToken(user);
    res.json({ token, user: user.toPublic() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get my profile
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.toPublic());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// REST API — Users
// ═════════════════════════════════════════════════════════════════════════════

// Search users by username prefix
app.get('/api/users/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 1) return res.json([]);
  try {
    const users = await User.find({
      username: { $regex: `^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' },
      _id: { $ne: req.user.userId },
    }).limit(10).select('-passwordHash -friendRequests');

    // Attach friendship status
    const me = await User.findById(req.user.userId).select('friends friendRequests');
    const friendIds = me.friends.map(String);
    const sentReqs = me.friendRequests.filter(r => r.status === 'pending').map(r => String(r.from));
    // Check if target sent us a request
    const results = users.map(u => ({
      ...u.toPublic(),
      isFriend: friendIds.includes(String(u._id)),
      requestSent: sentReqs.includes(String(u._id)),
    }));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// REST API — Friends
// ═════════════════════════════════════════════════════════════════════════════

// Get friends list (with pending requests)
app.get('/api/friends', requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.user.userId)
      .populate('friends', '-passwordHash -friendRequests')
      .populate('friendRequests.from', '-passwordHash -friendRequests');

    const friends = me.friends.map(f => ({
      ...f.toPublic(),
      online: onlineUsers.has(String(f._id)),
    }));
    const requests = me.friendRequests
      .filter(r => r.status === 'pending')
      .map(r => ({ _id: r._id, from: r.from.toPublic(), createdAt: r.createdAt }));

    res.json({ friends, requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send friend request
app.post('/api/friends/request', requireAuth, async (req, res) => {
  const { targetId } = req.body;
  if (!targetId) return res.status(400).json({ error: 'targetId is required' });
  if (targetId === req.user.userId) return res.status(400).json({ error: 'Cannot add yourself' });

  try {
    const [me, target] = await Promise.all([
      User.findById(req.user.userId),
      User.findById(targetId),
    ]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (me.friends.map(String).includes(targetId)) return res.status(409).json({ error: 'Already friends' });

    const alreadySent = target.friendRequests.some(r => String(r.from) === req.user.userId && r.status === 'pending');
    if (alreadySent) return res.status(409).json({ error: 'Friend request already sent' });

    target.friendRequests.push({ from: req.user.userId, status: 'pending' });
    await target.save();

    // Notify target via socket
    const senderProfile = me.toPublic();
    emitToUser(targetId, 'friend_request_received', { from: senderProfile });

    res.json({ message: 'Friend request sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept / decline friend request
app.post('/api/friends/respond', requireAuth, async (req, res) => {
  const { requestId, action } = req.body; // action: 'accept' | 'decline'
  if (!requestId || !action) return res.status(400).json({ error: 'requestId and action required' });

  try {
    const me = await User.findById(req.user.userId);
    const reqDoc = me.friendRequests.id(requestId);
    if (!reqDoc) return res.status(404).json({ error: 'Request not found' });

    const fromId = String(reqDoc.from);
    reqDoc.status = action === 'accept' ? 'accepted' : 'declined';

    if (action === 'accept') {
      if (!me.friends.map(String).includes(fromId)) me.friends.push(reqDoc.from);
      const them = await User.findById(fromId);
      if (them && !them.friends.map(String).includes(req.user.userId)) {
        them.friends.push(req.user.userId);
        await them.save();
      }
      emitToUser(fromId, 'friend_accepted', { by: me.toPublic() });
    }

    await me.save();

    const populated = await User.findById(fromId).select('-passwordHash -friendRequests');
    res.json({ message: `Request ${action}ed`, friend: action === 'accept' ? { ...populated.toPublic(), online: onlineUsers.has(fromId) } : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Remove friend
app.delete('/api/friends/:friendId', requireAuth, async (req, res) => {
  const { friendId } = req.params;
  try {
    await Promise.all([
      User.findByIdAndUpdate(req.user.userId, { $pull: { friends: friendId } }),
      User.findByIdAndUpdate(friendId, { $pull: { friends: req.user.userId } }),
    ]);
    res.json({ message: 'Friend removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// REST API — DMs
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/dm/:userId', requireAuth, async (req, res) => {
  const { userId } = req.params;
  const myId = req.user.userId;
  try {
    const messages = await Message.find({
      type: 'dm',
      $or: [
        { senderId: myId, recipientId: userId },
        { senderId: userId, recipientId: myId },
      ],
    }).sort({ createdAt: -1 }).limit(60).lean();
    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// REST API — Rooms (existing)
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/rooms', async (req, res) => {
  try { res.json(await Room.find().sort({ createdAt: 1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rooms', requireAuth, async (req, res) => {
  const { displayName, description } = req.body;
  if (!displayName) return res.status(400).json({ error: 'displayName required' });
  const name = displayName.trim().toLowerCase().replace(/\s+/g, '-');
  try {
    const existing = await Room.findOne({ name });
    if (existing) return res.status(409).json({ error: 'Room already exists', room: existing });
    const room = await Room.create({ name, displayName: displayName.trim(), description, createdBy: req.user.username });
    res.status(201).json(room);
    io.emit('room_created', room);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/messages/:room', async (req, res) => {
  try {
    const msgs = await Message.find({ type: 'room', room: req.params.room.toLowerCase() })
      .sort({ createdAt: -1 }).limit(60).lean();
    res.json(msgs.reverse());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ═════════════════════════════════════════════════════════════════════════════
// Socket.io
// ═════════════════════════════════════════════════════════════════════════════

// Online presence: userId -> Set of socketIds
const onlineUsers = new Map();

// Helper: emit to all sockets of a user
function emitToUser(userId, event, data) {
  const userIdStr = String(userId);
  io.to(`user_${userIdStr}`).emit(event, data);
}

// Helper: get all friends of a user (returns array of userId strings)
async function getFriendIds(userId) {
  try {
    const user = await User.findById(userId).select('friends');
    return user ? user.friends.map(String) : [];
  } catch { return []; }
}

// Socket auth middleware
io.use(socketAuth);

io.on('connection', async (socket) => {
  const { userId, username, displayName } = socket;
  console.log(`🔌 ${username} connected (${socket.id})`);

  // Track online presence
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);

  // Join personal room for DM delivery
  socket.join(`user_${userId}`);

  // Notify friends this user is online
  const friendIds = await getFriendIds(userId);
  friendIds.forEach(fId => emitToUser(fId, 'friend_online', { userId }));

  // ── DM ────────────────────────────────────────────────────────────────────
  socket.on('send_dm', async ({ recipientId, text }) => {
    if (!text?.trim() || !recipientId) return;
    try {
      const msg = await Message.create({
        type: 'dm',
        senderName: displayName || username,
        senderId: userId,
        recipientId,
        text: text.trim(),
      });
      const msgObj = msg.toObject();
      // Deliver to both users' personal rooms
      emitToUser(userId, 'receive_dm', msgObj);
      emitToUser(recipientId, 'receive_dm', msgObj);
    } catch (err) {
      console.error('DM save error:', err.message);
    }
  });

  socket.on('typing_dm', ({ recipientId }) => {
    emitToUser(recipientId, 'friend_typing', { userId, username: displayName || username });
  });

  socket.on('stop_typing_dm', ({ recipientId }) => {
    emitToUser(recipientId, 'friend_stop_typing', { userId });
  });

  // ── Group Rooms ───────────────────────────────────────────────────────────
  socket.on('join_room', async ({ room }) => {
    const prev = socket.currentRoom;
    if (prev && prev !== room) {
      socket.leave(prev);
      if (roomUsers[prev]) {
        roomUsers[prev].delete(socket.id);
        io.to(prev).emit('online_users', [...roomUsers[prev].values()]);
      }
    }
    socket.join(room);
    socket.currentRoom = room;
    if (!roomUsers[room]) roomUsers[room] = new Map();
    roomUsers[room].set(socket.id, displayName || username);
    io.to(room).emit('online_users', [...roomUsers[room].values()]);
    socket.to(room).emit('user_joined', { username: displayName || username });

    try {
      const history = await Message.find({ type: 'room', room: room.toLowerCase() })
        .sort({ createdAt: -1 }).limit(60).lean();
      socket.emit('message_history', history.reverse());
    } catch { socket.emit('message_history', []); }
  });

  socket.on('send_message', async ({ room, text }) => {
    if (!text?.trim()) return;
    try {
      const msg = await Message.create({
        type: 'room',
        senderName: displayName || username,
        senderId: userId,
        room: room.toLowerCase(),
        text: text.trim(),
      });
      await Room.updateOne({ name: room.toLowerCase() }, { $inc: { messageCount: 1 } });
      io.to(room).emit('receive_message', msg.toObject());
    } catch (err) {
      console.error('Room msg error:', err.message);
    }
  });

  socket.on('typing', ({ room }) => socket.to(room).emit('user_typing', { username: displayName || username }));
  socket.on('stop_typing', ({ room }) => socket.to(room).emit('user_stop_typing', { username: displayName || username }));

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', async () => {
    console.log(`🔌 ${username} disconnected`);
    const socks = onlineUsers.get(userId);
    if (socks) {
      socks.delete(socket.id);
      if (socks.size === 0) {
        onlineUsers.delete(userId);
        const fIds = await getFriendIds(userId);
        fIds.forEach(fId => emitToUser(fId, 'friend_offline', { userId }));
      }
    }
    const room = socket.currentRoom;
    if (room && roomUsers[room]) {
      roomUsers[room].delete(socket.id);
      io.to(room).emit('online_users', [...roomUsers[room].values()]);
      io.to(room).emit('user_left', { username: displayName || username });
    }
  });
});

const roomUsers = {}; // room -> Map<socketId, displayName>

// ── Start ─────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Friends Messenger v2 → http://localhost:${PORT}`);
  });
});