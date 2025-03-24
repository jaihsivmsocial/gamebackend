const express = require("express")
const router = express.Router()
const WebRTCController = require("../controller/webrtc-controller")
const  authenticate  = require("../middleware/authMiddleware")

// All WebRTC routes require authentication
router.use(authenticate)

// WebRTC signaling routes
router.post("/offer", WebRTCController.handleOffer)
router.post("/answer", WebRTCController.handleAnswer)
router.post("/ice-candidate", WebRTCController.handleIceCandidate)

module.exports = router

