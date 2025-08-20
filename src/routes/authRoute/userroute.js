const express = require("express")
const {
  register,
  login,
  verifyAuth,
  checkUsername,
  forgotPassword,
  updateProfile,
  requestOtpReset,
  verifyOtpAndResetPassword,
  sendSignupOtp,          // Add this new import
  verifySignupOtp,        // Add this new import
} = require("../../controller/authController/authController")
const authMiddleware = require("../../middleware/authMiddleware")

const router = express.Router()

// Auth routes
router.post("/register", register)
router.post("/login", login)
router.get("/check-username/:username", checkUsername)
router.post("/forgot-password", forgotPassword)
router.post("/request-otp-reset", requestOtpReset)
router.post("/verify-otp-reset", verifyOtpAndResetPassword)
router.get("/verify-auth", verifyAuth)
router.put("/updateProfile", authMiddleware, updateProfile)

// NEW: Signup OTP routes
router.post("/send-signup-otp", sendSignupOtp)           
router.post("/verify-signup-otp", verifySignupOtp) 

module.exports = router