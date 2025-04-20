const mongoose = require("mongoose")

const BetQuestionSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
    },
    subject: {
      type: String,
      required: true, // e.g., "James5423"
    },
    condition: {
      type: String,
      required: true, // e.g., "survive for 5 minutes"
    },
    startTime: {
      type: Date,
      default: Date.now,
    },
    endTime: {
      type: Date,
      required: true,
    },
    resolved: {
      type: Boolean,
      default: false,
    },
    outcome: {
      type: String,
      enum: ["Yes", "No", null],
      default: null,
    },
    totalBetAmount: {
      type: Number,
      default: 0,
    },
    yesBetAmount: {
      type: Number,
      default: 0,
    },
    noBetAmount: {
      type: Number,
      default: 0,
    },
    yesPercentage: {
      type: Number,
      default: 50,
    },
    noPercentage: {
      type: Number,
      default: 50,
    },
    yesUserCount: {
      type: Number,
      default: 0,
    },
    noUserCount: {
      type: Number,
      default: 0,
    },
    totalPlayers: {
      type: Number,
      default: 0,
    },
    active: {
      type: Boolean,
      default: true,
    },
    streamId: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
)

module.exports = mongoose.models.BetQuestion || mongoose.model("BetQuestion", BetQuestionSchema)
