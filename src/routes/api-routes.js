const express = require("express")
const router = express.Router()
const streamRoutes = require("./streamRoute/stream-routes")
const webrtcRoutes = require("./webrtc-routes")
const  authenticate  = require("../middleware/authMiddleware")

// Mount stream routes
router.use("/streams", streamRoutes)

// Mount WebRTC routes
router.use("/webrtc", webrtcRoutes)

// Health check route
router.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" })
})

module.exports = router

