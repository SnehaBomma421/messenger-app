const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    // 'dm' = direct message, 'room' = group room
    type: { type: String, enum: ['dm', 'room'], default: 'room', required: true },

    // Sender info (always present)
    senderName: { type: String, required: true, trim: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // DM fields
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Group room field
    room: { type: String, trim: true, lowercase: true },

    text: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

// Fast lookup: all DMs between two users
messageSchema.index({ type: 1, senderId: 1, recipientId: 1, createdAt: -1 });
// Fast lookup: all messages in a room
messageSchema.index({ type: 1, room: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
