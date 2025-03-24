const express = require("express")
const router = express.Router()
const qualitySettingsController = require("../controller/videoquality-controller")


// Get quality settings for a user and stream
router.get("/:userId/:streamId", qualitySettingsController.getQualitySettings)

// Update quality settings
router.post("/:userId/:streamId", qualitySettingsController.updateQualitySettings)

module.exports = router
