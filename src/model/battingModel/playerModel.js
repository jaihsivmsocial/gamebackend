const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema(
  {
    CameraHolderName: {
      type: String,
      required: true,
      trim: true,
    },
    CameraHoldStartTime: {
      type: Date,
      default: null
    },
    Kills: {
      type: Number,
      default: 0
    },
    LastHoldDuration: {
      type: Number, 
      default: 0
    },
    TotalHoldTime: {
      type: Number, 
      default: 0
    }
  
  },
  {
    timestamps: true 
  }
);

const Player = mongoose.model("Player", playerSchema);

module.exports = Player;
