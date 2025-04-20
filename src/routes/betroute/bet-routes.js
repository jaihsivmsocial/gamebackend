const express = require("express")
const {
  placeBet,
  resolveBetQuestion,
  getUserBets,
  getActiveBetQuestion,
  getBetStats,
  getUserWalletBalance,
} = require("../../controller/BetController/bet-controller.js")
const  authenticate = require("../../middleware/authMiddleware.js")


const router = express.Router()

// Place a bet (protected route)
router.post("/place", authenticate, placeBet)

// Resolve a bet question (admin only)
router.post("/resolve", authenticate, resolveBetQuestion)

// Get user's bet history (protected route)
router.get("/history", authenticate, getUserBets)

// Get active bet question
router.get("/active", getActiveBetQuestion)

// Get betting statistics
router.get("/stats", getBetStats)

router.get("/wallet", getUserWalletBalance)
// router.post("/wallet/reset", resetBalance)





module.exports = router
