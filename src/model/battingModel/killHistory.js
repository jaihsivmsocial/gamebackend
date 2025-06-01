const mongoose = require("mongoose");

const killHistorySchema = new mongoose.Schema(
  {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
    },
    playerName: {
      type: String,
      required: true,

    },
    CameraHolderName: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    streamId: {
      type: String,
      default: "default-stream"
    },

       Kills: {
      type: Number,
      default: 0,
    },

  },
  {
    timestamps: true,
  }
);



const KillHistory = mongoose.model("KillHistory", killHistorySchema);

module.exports = KillHistory;