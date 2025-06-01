const Player = require("../../model/battingModel/playerModel");
const KillHistory = require("../../model/battingModel/killHistory"); // Corrected import path

// Create a new player
exports.createPlayer = async (req, res) => {
  try {
    const { CameraHolderName, playerName } = req.body;
    const player = new Player({ 
      CameraHolderName,
      playerName: playerName || CameraHolderName,
      CameraHoldStartTime: CameraHolderName !== "None" ? new Date() : null,
      Kills: 0,
      KillsForCal: 0, // Initialize KillsForCal
      killTimestamps: [] 
    });
    await player.save();
    console.log("✅ Player created successfully:", player);
    res.status(201).json(player);
  } catch (err) {
    console.error("❌ Error creating player:", err);
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

// Update a player by ID - DUAL KILL HISTORY STORAGE
exports.updatePlayer = async (req, res) => {
  try {
    const { id } = req.params;
    const { CameraHolderName, incrementKills, streamId } = req.body;

    console.log("\n🔄 updatePlayer called:");
    console.log("   ID:", id);
    console.log("   CameraHolderName:", CameraHolderName);
    console.log("   incrementKills:", incrementKills);
    console.log("   streamId:", streamId);

    // Get the current player data
    const currentPlayer = await Player.findById(id);
    if (!currentPlayer) {
      console.log("❌ Player not found with ID:", id);
      return res.status(404).json({ message: "Player not found" });
    }

    console.log("✅ Current player found:", {
      id: currentPlayer._id,
      CameraHolderName: currentPlayer.CameraHolderName,
      playerName: currentPlayer.playerName,
      Kills: currentPlayer.Kills,
      KillsForCal: currentPlayer.KillsForCal,
      killTimestampsCount: currentPlayer.killTimestamps ? currentPlayer.killTimestamps.length : 0
    });

    const updateData = {};
    
    // Handle camera holder name changes
    if (CameraHolderName !== undefined) {
      updateData.CameraHolderName = CameraHolderName;
      
      if (currentPlayer.CameraHolderName === "None" && CameraHolderName !== "None") {
        updateData.CameraHoldStartTime = new Date();
        console.log(`Player ${CameraHolderName} started holding camera at ${updateData.CameraHoldStartTime}`);
      } 
      else if (currentPlayer.CameraHolderName !== "None" && CameraHolderName === "None") {
        if (currentPlayer.CameraHoldStartTime) {
          const endTime = new Date();
          const holdDuration = Math.floor((endTime - currentPlayer.CameraHoldStartTime) / 1000);
          
          updateData.LastHoldDuration = holdDuration;
          updateData.TotalHoldTime = (currentPlayer.TotalHoldTime || 0) + holdDuration;
          updateData.CameraHoldStartTime = null;
          
          console.log(`Player ${currentPlayer.CameraHolderName} stopped holding camera. Duration: ${holdDuration}s`);
        }
        // When player stops holding camera, reset KillsForCal, but keep Kills (total lifetime kills)
        updateData.KillsForCal = 0; 
        console.log(`   KillsForCal reset to 0 for ${currentPlayer.CameraHolderName}`);
      }
    }
    
    // CRITICAL: Handle kill increments with DUAL storage
    if (incrementKills && currentPlayer.CameraHolderName !== "None") {
      console.log("\n🎯 PROCESSING KILL INCREMENT (DUAL STORAGE)");
      console.log("   Current player Kills:", currentPlayer.Kills);
      console.log("   Current player KillsForCal:", currentPlayer.KillsForCal);
      
      // Increment both Kills (lifetime) and KillsForCal (current session/camera hold)
      updateData.Kills = (currentPlayer.Kills || 0) + 1;
      updateData.KillsForCal = (currentPlayer.KillsForCal || 0) + 1;

      const killTimestamp = new Date();
      
      // 1. Store in Player model's killTimestamps array
      updateData.killTimestamps = [...(currentPlayer.killTimestamps || []), killTimestamp];
      console.log("   Updated killTimestamps array in Player model");
      
      console.log("   New Kills (lifetime):", updateData.Kills);
      console.log("   New KillsForCal (session):", updateData.KillsForCal);
      console.log("   Kill timestamp:", killTimestamp);
      
      // 2. Store in separate KillHistory collection
      console.log("\n💾 SAVING TO KILLHISTORY COLLECTION");
      
      try {
        // Prepare kill history data
        const killHistoryData = {
          playerId: currentPlayer._id,
          playerName: currentPlayer.playerName || currentPlayer.CameraHolderName,
          CameraHolderName: currentPlayer.CameraHolderName,
          timestamp: killTimestamp,
          // IMPORTANT FIX: Store the new total Kills count for this specific kill event
          Kills: updateData.Kills, 
          streamId: streamId || "default-stream"
        };  
        
        console.log("   Kill history data to save:", JSON.stringify(killHistoryData, null, 2));
        
        // Create KillHistory instance
        const killHistory = new KillHistory(killHistoryData);
        console.log("   KillHistory instance created");
        
        // Validate before saving
        const validationError = killHistory.validateSync();
        if (validationError) {
          console.log("❌ Validation error:", validationError);
          throw validationError;
        } else {
          console.log("✅ Validation passed");
        }
        
        // Save with detailed error handling
        console.log("   Attempting to save kill history...");
        const savedKillHistory = await killHistory.save();
        console.log("✅ Kill history saved successfully to collection!");
        console.log("   Saved kill history:", savedKillHistory);
        
      } catch (killHistoryError) {
        console.log("❌ KILL HISTORY COLLECTION SAVE ERROR:");
        console.log("   Error message:", killHistoryError.message);
        console.log("⚠️  Continuing with player update despite kill history collection error");
      }
      
      console.log(`Player ${currentPlayer.CameraHolderName} got a kill. Total Kills: ${updateData.Kills}, KillsForCal: ${updateData.KillsForCal}`);
    }

    // Update the player with all changes
    const player = await Player.findByIdAndUpdate(id, updateData, { new: true });
    console.log("✅ Player updated successfully");
    console.log("   Updated player Kills:", player.Kills);
    console.log("   Updated player KillsForCal:", player.KillsForCal);
    console.log("   Updated player killTimestamps count:", player.killTimestamps ? player.killTimestamps.length : 0);

    res.json(player);
  } catch (err) {
    console.error("❌ Error in updatePlayer:", err);
    res.status(500).json({ error: err.message });
  }
};

// Add a kill to the current camera holder - DUAL STORAGE
exports.addKillToHolder = async (req, res) => {
  try {
    console.log("\n🎯 addKillToHolder called (DUAL STORAGE)");
    console.log("   Request body:", req.body);
    
    // Find the current camera holder
    const currentHolder = await Player.findOne({ 
      CameraHolderName: { $ne: "None" } 
    });

    if (!currentHolder) {
      console.log("❌ No active camera holder found");
      return res.status(404).json({ message: "No active camera holder found" });
    }

    console.log("✅ Current holder found:", {
      id: currentHolder._id,
      CameraHolderName: currentHolder.CameraHolderName,
      playerName: currentHolder.playerName,
      currentKills: currentHolder.Kills,
      currentKillsForCal: currentHolder.KillsForCal,
      killTimestampsCount: currentHolder.killTimestamps ? currentHolder.killTimestamps.length : 0
    });

    const killTimestamp = new Date();
    
    // 1. Update Player model
    currentHolder.Kills += 1; // Increment lifetime kills
    currentHolder.KillsForCal +=1; // Increment session kills
    currentHolder.killTimestamps = [...(currentHolder.killTimestamps || []), killTimestamp];
    
    // Save the player update first
    await currentHolder.save();
    console.log("✅ Player updated with new kill count and killTimestamp in array");
    console.log("   New Kills (lifetime):", currentHolder.Kills);
    console.log("   New KillsForCal (session):", currentHolder.KillsForCal);
    console.log("   New killTimestamps count:", currentHolder.killTimestamps.length);

    // 2. Save to KillHistory collection
    console.log("\n💾 SAVING TO KILLHISTORY COLLECTION");
    let killHistorySaved = false;
    let killHistoryId = null;
    let killHistoryErrorMessage = null;
    
    try {
      const killHistoryData = {
        playerId: currentHolder._id,
        playerName: currentHolder.playerName || currentHolder.CameraHolderName,
        CameraHolderName: currentHolder.CameraHolderName,
        timestamp: killTimestamp,
        // IMPORTANT FIX: Store the new total Kills count for this specific kill event
        Kills: currentHolder.Kills, 
        streamId: req.body.streamId || "default-stream"
      };
      
      console.log("   Kill history data:", JSON.stringify(killHistoryData, null, 2));
      
      const killHistory = new KillHistory(killHistoryData);
      console.log("   KillHistory instance created");
      
      // Validate
      const validationError = killHistory.validateSync();
      if (validationError) {
        console.log("❌ Validation failed:", validationError);
        throw validationError;
      }
      
      console.log("   Validation passed, saving...");
      const savedKillHistory = await killHistory.save();
      
      console.log("✅ Kill history saved successfully to collection!");
      console.log("   Saved ID:", savedKillHistory._id);
      
      killHistorySaved = true;
      killHistoryId = savedKillHistory._id;
      
    } catch (killHistoryError) {
      console.log("❌ Kill history collection save failed:");
      console.log("   Error:", killHistoryError.message);
      killHistoryErrorMessage = killHistoryError.message;
    }

    res.json({ 
      message: `Kill added to ${currentHolder.CameraHolderName}. Kill history collection save ${killHistorySaved ? 'succeeded' : 'failed'}.`,
      player: currentHolder,
      killTimestamp: killTimestamp,
      killHistoryId: killHistoryId,
      killHistorySaved: killHistorySaved,
      killHistoryError: killHistoryErrorMessage
    });

  } catch (err) {
    console.error("❌ Error in addKillToHolder:", err);
    res.status(500).json({ error: err.message });
  }
};

// Reset camera holder
exports.resetCameraHolder = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log("🔄 resetCameraHolder called for ID:", id);
    
    const player = await Player.findById(id);
    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }
    
    console.log("✅ Player found for reset:", player.CameraHolderName);
    
    // Reset player stats
    player.CameraHolderName = "None";
    player.CameraHoldStartTime = null;
    player.Kills = 0; // Lifetime kills should NOT be reset here
    // player.KillsForCal = 0; // Reset session/camera hold kills
    player.LastHoldDuration = 0;
    player.TotalHoldTime = 0;
    // player.killTimestamps = []; // Optionally clear the array in Player model
    
    await player.save();
    console.log("✅ Player reset complete. KillsForCal reset. Lifetime Kills and KillHistory collection preserved.");

    res.json({ 
      message: `Player stats reset. KillsForCal reset. Lifetime Kills and KillHistory preserved.`,
      player: player
    });
  } catch (err) {
    console.error("❌ Error resetting player:", err);
    res.status(500).json({ error: err.message });
  }
};

// Test KillHistory model
exports.testKillHistory = async (req, res) => {
  try {
    console.log("\n🧪 TESTING KILL HISTORY MODEL");
    
    console.log("1. Model import test:");
    console.log("   KillHistory type:", typeof KillHistory);
    console.log("   KillHistory name:", KillHistory.name);
    
    console.log("\n2. Creating test entry:");
    const testData = {
      playerId: "507f1f77bcf86cd799439011", 
      playerName: "TestPlayer",
      CameraHolderName: "TestPlayer",
      timestamp: new Date(),
      Kills: 1, // Example kill number
      streamId: "test-stream"
    };
    
    console.log("   Test data:", testData);
    
    const testKill = new KillHistory(testData);
    console.log("   Instance created:", testKill);
    
    console.log("\n3. Validation test:");
    const validationError = testKill.validateSync();
    if (validationError) {
      console.log("   Validation failed:", validationError);
      return res.json({ success: false, error: validationError.message });
    } else {
      console.log("   Validation passed");
    }
    
    console.log("\n4. Save test:");
    const saved = await testKill.save();
    console.log("   Saved successfully:", saved._id);
    
    console.log("\n5. Find test:");
    const found = await KillHistory.findById(saved._id);
    console.log("   Found:", found ? "Yes" : "No");
    
    console.log("\n6. Count test:");
    const count = await KillHistory.countDocuments();
    console.log("   Total kill history records:", count);
    
    await KillHistory.findByIdAndDelete(saved._id);
    console.log("   Test data cleaned up");
    
    res.json({ 
      success: true, 
      message: "KillHistory model test passed",
      testId: saved._id,
      totalRecords: count
    });
    
  } catch (err) {
    console.error("❌ KillHistory test failed:", err);
    res.json({ 
      success: false, 
      error: err.message,
      stack: err.stack
    });
  }
};

// Get kill history for debugging
exports.getPlayerKillHistory = async (req, res) => {
  try {
    const { playerId, cameraHolderName, startTime, endTime } = req.query;
    
    console.log("🔍 Getting kill history with params:", { playerId, cameraHolderName, startTime, endTime });
    
    const query = {};
    
    if (playerId) query.playerId = playerId;
    if (cameraHolderName) query.CameraHolderName = cameraHolderName;
    
    if (startTime || endTime) {
      query.timestamp = {};
      if (startTime) query.timestamp.$gte = new Date(startTime);
      if (endTime) query.timestamp.$lte = new Date(endTime);
    }
    
    console.log("   Query:", JSON.stringify(query, null, 2));
    
    const killHistory = await KillHistory.find(query).sort({ timestamp: 1 }).limit(100);
    const totalKills = await KillHistory.countDocuments(query);
    
    console.log(`   Found ${killHistory.length} records in KillHistory collection`);
    
    let playerKillTimestamps = [];
    let playerDetails = null;
    if (cameraHolderName) {
      const player = await Player.findOne({ CameraHolderName: cameraHolderName }).select('killTimestamps Kills KillsForCal');
      if (player) {
        playerKillTimestamps = player.killTimestamps || [];
        playerDetails = { Kills: player.Kills, KillsForCal: player.KillsForCal };
      }
    }
    
    res.json({
      totalKillsInCollection: totalKills,
      killHistoryFromCollection: killHistory,
      playerDetails: playerDetails,
      killTimestampsFromPlayerModel: playerKillTimestamps,
      query
    });
  } catch (err) {
    console.error("❌ Error getting kill history:", err);
    res.status(500).json({ error: err.message });
  }
};