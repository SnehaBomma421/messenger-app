const mongoose = require('mongoose');

const AVATAR_COLORS = [
  '#007BA7','#C04C8E','#E0702F','#2E9E60','#8B5CF6',
  '#D97706','#DC2626','#0891B2','#059669','#7C3AED',
  '#B45309','#BE185D','#0284C7','#16A34A','#9333EA',
];

function pickColor(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const friendRequestSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String, required: true, unique: true,
      lowercase: true, trim: true, minlength: 2, maxlength: 24,
      match: /^[a-zA-Z0-9._-]+$/,
    },
    displayName: { type: String, required: true, trim: true, maxlength: 32 },
    passwordHash: { type: String, required: true },
    avatarColor: { type: String, default: '#007BA7' },
    bio: { type: String, default: '', maxlength: 160, trim: true },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    friendRequests: [friendRequestSchema],
  },
  { timestamps: true }
);

// Auto-assign avatar color before saving
userSchema.pre('save', function (next) {
  if (this.isNew) {
    this.avatarColor = pickColor(this.username);
  }
  next();
});

// Public profile (no passwordHash)
userSchema.methods.toPublic = function () {
  return {
    _id: this._id,
    username: this.username,
    displayName: this.displayName,
    avatarColor: this.avatarColor,
    bio: this.bio,
    createdAt: this.createdAt,
  };
};

userSchema.index({ username: 'text' });

module.exports = mongoose.model('User', userSchema);
