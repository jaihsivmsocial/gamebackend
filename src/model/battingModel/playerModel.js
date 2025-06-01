const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema(
  {
    CameraHolderName: {
      type: String,
      required: true,
      trim: true,
    },
    playerName: {
      type: String,
      required: true,
    },
    CameraHoldStartTime: {
      type: Date,
      default: null,
    },
    Kills: {
      type: Number,
      default: 0,
    },
       KillsForCal: {
      type: Number,
      default: 0,
    },
    LastHoldDuration: {
      type: Number,
      default: 0,
    },
      killTimestamps: {
    type: [Date],
    default: []
      },
    TotalHoldTime: {
      type: Number,
      default: 0,
    },
    
    
  },
  {
    timestamps: true,
  }
);

const Player = mongoose.model("Player", playerSchema);

module.exports = Player;
