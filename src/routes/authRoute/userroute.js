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

} = require("../../controller/authController/authController")
const authMiddleware = require("../../middleware/authMiddleware")
const router = express.Router()

// Auth routes
router.post("/register", register)
router.post("/login", login)
router.get("/1/:username", checkUsername)
router.post("/forgot-password", forgotPassword)
router.post("/request-otp-reset", requestOtpReset)
router.post("/verify-otp-reset", verifyOtpAndResetPassword)
router.post("/verify-auth",  verifyAuth)
router.put("/updateProfile",  authMiddleware, updateProfile)


module.exports = router

