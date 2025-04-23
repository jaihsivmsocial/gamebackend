const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema(
  {
    CameraHolderName: {
      type: String,
      required: true,
      trim: true,
    }
  },
  {
    timestamps: true 
  }
);

const Player = mongoose.model("Player", playerSchema);

module.exports = Player;
