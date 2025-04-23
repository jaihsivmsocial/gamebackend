const mongoose = require("mongoose")

const TransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["bet_place", "bet_win", "bet_refund", "deposit", "withdrawal", "platform_fee"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    bet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bet",
    },
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BetQuestion",
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
)

module.exports = mongoose.models.Transaction || mongoose.model("Transaction", TransactionSchema)
