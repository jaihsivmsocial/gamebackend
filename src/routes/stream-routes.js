const express = require("express")
const router = express.Router()
const streamController = require("../controller/stream-controller")
const authenticate  = require("../middleware/authMiddleware")

router.get("/", streamController.getActiveStreams)
router.get("/top", streamController.getTopStreams)
router.get("/:streamId", streamController.getStream)
router.get("/:streamId/viewers", streamController.getViewerCount)

// New routes for manually incrementing/decrementing viewer counts
router.post("/:streamId/viewers/increment", streamController.incrementViewerCount)
router.post("/:streamId/viewers/decrement", streamController.decrementViewerCount)

// Protected routes (authentication required)
router.post("/", authenticate, streamController.createStream)
router.get("/:streamId/stats", authenticate, streamController.getStreamStats)
router.get("/analytics", authenticate, streamController.getStreamAnalytics)
router.delete("/:streamId", authenticate, streamController.endStream)

module.exports = router
