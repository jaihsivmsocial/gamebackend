const mongoose = require("mongoose")

const messageSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true },
    senderInfo: {
      anonymousId: { type: String },
      username: { type: String, required: true },
      profilePicture: { type: String },
      isAnonymous: { type: Boolean, default: false },
    },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true },
)

const Message = mongoose.model("Message", messageSchema)
module.exports = Message

