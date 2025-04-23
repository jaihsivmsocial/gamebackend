const mongoose = require("mongoose")

const BetSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BetQuestion",
      required: true,
    },
    choice: {
      type: String,
      enum: ["Yes", "No"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    matchedAmount: {
      type: Number,
      default: 0,
    },
    potentialPayout: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["pending", "matched", "partially_matched", "unmatched", "won", "lost", "refunded"],
      default: "pending",
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    processed: {
      type: Boolean,
      default: false,
    },
    streamId: {
      type: String,
      default: "default-stream", 
    },
  },
  { timestamps: true },
)

module.exports = mongoose.models.Bet || mongoose.model("Bet", BetSchema)
