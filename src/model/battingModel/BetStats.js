const mongoose = require("mongoose")

const BetStatsSchema = new mongoose.Schema({
  totalBetsAmount: {
    type: Number,
    default: 0,
  },
  biggestWinThisWeek: {
    type: Number,
    default: 0,
  },
  totalPlayers: {
    type: Number,
    default: 0,
  },
  activePlayers: {
    type: Number,
    default: 0,
  },
  weekStartDate: {
    type: Date,
    required: true,
  },
  weekEndDate: {
    type: Date,
    required: true,
  },
  streamId: {
    type: String,
    required: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
})

module.exports = mongoose.models.BetStats || mongoose.model("BetStats", BetStatsSchema)
