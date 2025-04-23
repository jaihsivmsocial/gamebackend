const Player = require("../../model/battingModel/playerModel");

// Create a new player
exports.createPlayer = async (req, res) => {
  try {
    const { CameraHolderName } = req.body;
    const player = new Player({ CameraHolderName });
    await player.save();
    res.status(201).json(player);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// Get all players
exports.getPlayers = async (req, res) => {
  try {
    const players = await Player.find();
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update a player by ID
exports.updatePlayer = async (req, res) => {
  try {
    const { id } = req.params;
    const { CameraHolderName } = req.body;

    const player = await Player.findByIdAndUpdate(
      id,
      { CameraHolderName },
      { new: true }
    );

    if (!player) return res.status(404).json({ message: "Player not found" });

    res.json(player);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
