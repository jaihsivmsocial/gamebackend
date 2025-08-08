const express = require("express")
const {
  placeBet,
  resolveBetQuestion,
  getUserBets,
  getActiveBetQuestion,
  getBetStats,
  getUserWalletBalance,
  updateWalletBalance,
  resetBalance,
  getPlatformFeeStats,
  // debugController,

  placeBetWithPartialPayment,
} = require("../../controller/BetController/bet-controller.js")
const authenticate = require("../../middleware/authMiddleware.js")


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

// Get platform fee statistics (admin only)
router.get("/platform-fees", authenticate, getPlatformFeeStats)

// Get user wallet balance (protected route)
router.get("/wallet", authenticate, getUserWalletBalance)

// Update user wallet balance (protected route)
router.post("/wallet/update", authenticate, updateWalletBalance)

// Reset user wallet balance (protected route)
router.post("/wallet/reset", authenticate, resetBalance)

// router.post("/place-partial", authenticate, placeBetWithPartialPayment)

module.exports = router
