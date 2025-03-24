const QualitySettings = require("../model/videoqualityModel")

const qualitySettingsController = {
  // Get quality settings for a user and stream
  async getQualitySettings(req, res) {
    try {
      const { userId, streamId } = req.params

      if (!userId || !streamId) {
        return res.status(400).json({ success: false, error: "Missing userId or streamId" })
      }

      // Find existing settings or return defaults
      const settings = await QualitySettings.findOne({ userId, streamId })

      if (!settings) {
        // Return default settings if none exist
        return res.status(200).json({
          success: true,
          settings: {
            userId,
            streamId,
            quality: "auto",
            frameRate: "60",
          },
        })
      }

      return res.status(200).json({
        success: true,
        settings,
      })
    } catch (error) {
      console.error("Error getting quality settings:", error)
      return res.status(500).json({ success: false, error: "Server error" })
    }
  },

  // Update quality settings
  async updateQualitySettings(req, res) {
    try {
      const { userId, streamId } = req.params
      const { quality, frameRate } = req.body

      if (!userId || !streamId) {
        return res.status(400).json({ success: false, error: "Missing userId or streamId" })
      }

      // Validate quality and frameRate
      const validQualities = ["auto", "240p", "360p", "720p", "1080p"]
      const validFrameRates = ["30", "60"]

      if (quality && !validQualities.includes(quality)) {
        return res.status(400).json({ success: false, error: "Invalid quality setting" })
      }

      if (frameRate && !validFrameRates.includes(frameRate)) {
        return res.status(400).json({ success: false, error: "Invalid frameRate setting" })
      }

      // Find and update or create new settings
      const settings = await QualitySettings.findOneAndUpdate(
        { userId, streamId },
        {
          quality: quality || "auto",
          frameRate: frameRate || "60",
          lastUpdated: Date.now(),
        },
        { new: true, upsert: true },
      )

      return res.status(200).json({
        success: true,
        settings,
      })
    } catch (error) {
      console.error("Error updating quality settings:", error)
      return res.status(500).json({ success: false, error: "Server error" })
    }
  },
}

module.exports = qualitySettingsController

