const mongoose = require("mongoose")

const UserSchema = new mongoose.Schema(
  {
    walletBalance: {
      type: Number,
      default: 300, 
    },
    totalBets: {
      type: Number,
      default: 0,
    },
    totalWins: {
      type: Number,
      default: 0,
    },
    biggestWin: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
)

module.exports = mongoose.models.User || mongoose.model("Userwallet", UserSchema)
