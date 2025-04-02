// PlayFab configuration file
require("dotenv").config()
const PlayFab = require("playfab-sdk")

// Set PlayFab settings
PlayFab.settings.titleId = process.env.PLAYFAB_TITLE_ID || "1E3DA1"
PlayFab.settings.developerSecretKey =process.env.PLAYFAB_SECRET_KEY || "4QCHN85E539T1T5UXERFFSGY8APIWMTQXJRMFZ76ZZOCKEW85M"

console.log("PlayFab Title ID:", PlayFab.settings.titleId)
console.log("PlayFab Secret Key exists:", !!PlayFab.settings.developerSecretKey)

// PlayFab modules
const PlayFabClient = PlayFab.PlayFabClient
const PlayFabServer = PlayFab.PlayFabServer
const PlayFabAdmin = PlayFab.PlayFabAdmin

// Helper function to handle PlayFab responses
const handlePlayFabResponse = (error, result) => {
  if (error) {
    console.error("PlayFab error:", error)
    return {
      success: false,
      error: error.errorMessage || error.message || JSON.stringify(error),
    }
  }

  return {
    success: true,
    data: result.data,
  }
}

// Alternative PlayFab connection test that's even simpler
console.log("Testing PlayFab connection...")
console.log("PlayFab settings:", {
  titleId: PlayFab.settings.titleId,
  developerSecretKeyExists: !!PlayFab.settings.developerSecretKey,
})

// Just check if the SDK is properly initialized
if (PlayFab.settings.titleId && PlayFab.settings.developerSecretKey) {
  console.log("PlayFab SDK initialized successfully")
} else {
  console.error("PlayFab SDK initialization failed - missing titleId or developerSecretKey")
}

// Test PlayFab connection with GetTitleData (doesn't require login)
PlayFabServer.GetTitleData(
  {
    Keys: ["WelcomeMessage"],
  },
  (error, result) => {
    if (error) {
      console.error("PlayFab connection test failed:", error)
    } else {
      console.log("PlayFab connection test succeeded!")
      console.log("Result:", result)
    }
  },
)

// Export PlayFab modules for use in other files
module.exports = {
  PlayFab,
  PlayFabClient,
  PlayFabServer,
  PlayFabAdmin,
  handlePlayFabResponse,
}