const Player = require("../../model/battingModel/playerModel");

// Create a new player
exports.createPlayer = async (req, res) => {
  try {
    const { CameraHolderName } = req.body;
    const player = new Player({ 
      CameraHolderName,
      CameraHoldStartTime: CameraHolderName !== "None" ? new Date() : null,
      Kills: 0
    });
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
    const { CameraHolderName, incrementKills } = req.body;

    // Get the current player data
    const currentPlayer = await Player.findById(id);
    if (!currentPlayer) {
      return res.status(404).json({ message: "Player not found" });
    }

    const updateData = {};
    
    // Handle camera holder name changes
    if (CameraHolderName !== undefined) {
      updateData.CameraHolderName = CameraHolderName;
      
      // If player starts holding the camera (from None to a name)
      if (currentPlayer.CameraHolderName === "None" && CameraHolderName !== "None") {
        updateData.CameraHoldStartTime = new Date();
        console.log(`Player ${CameraHolderName} started holding camera at ${updateData.CameraHoldStartTime}`);
      } 
      // If player stops holding the camera (from a name to None)
      else if (currentPlayer.CameraHolderName !== "None" && CameraHolderName === "None") {
        // Calculate hold duration if there was a start time
        if (currentPlayer.CameraHoldStartTime) {
          const endTime = new Date();
          const holdDuration = Math.floor((endTime - currentPlayer.CameraHoldStartTime) / 1000); // in seconds
          
          updateData.LastHoldDuration = holdDuration;
          updateData.TotalHoldTime = (currentPlayer.TotalHoldTime || 0) + holdDuration;
          updateData.CameraHoldStartTime = null;
          
          console.log(`Player ${currentPlayer.CameraHolderName} stopped holding camera. Duration: ${holdDuration}s`);
        }
      }
    }
    
    // Handle kill increments
    if (incrementKills && currentPlayer.CameraHolderName !== "None") {
      updateData.Kills = (currentPlayer.Kills || 0) + 1;
      console.log(`Player ${currentPlayer.CameraHolderName} got a kill. Total: ${updateData.Kills}`);
    }

    // Update the player with all changes
    const player = await Player.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    res.json(player);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add a kill to the current camera holder
exports.addKillToHolder = async (req, res) => {
  try {
    // Find the current camera holder
    const currentHolder = await Player.findOne({ 
      CameraHolderName: { $ne: "None" } 
    });

    if (!currentHolder) {
      return res.status(404).json({ message: "No active camera holder found" });
    }

    // Increment kills
    currentHolder.Kills += 1;
    await currentHolder.save();

    res.json({ 
      message: `Kill added to ${currentHolder.CameraHolderName}`,
      player: currentHolder 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Reset camera holder (when player dies)
exports.resetCameraHolder = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find the player by ID
    const player = await Player.findById(id);
    
    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }
    
    // Reset all stats to zero
    player.CameraHolderName = "None";
    player.CameraHoldStartTime = null;
    player.Kills = 0;
    player.LastHoldDuration = 0;
    player.TotalHoldTime = 0;
    
    await player.save();

    res.json({ 
      message: `Player stats reset to zero`,
      player: player
    });
  } catch (err) {
    console.error("Error resetting player:", err);
    res.status(500).json({ error: err.message });
  }
};