
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    senderInfo: {
      anonymousId: { type: String },
      username: { type: String, required: true },
      profilePicture: { type: String },
      isAnonymous: { type: Boolean, default: false },
    },
    streamId: { type: String, required: true, index: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    replyTo: {
      messageId: { type: String },
      username: { type: String },
      content: { type: String },
    },
  },
  { timestamps: true }
);

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;
