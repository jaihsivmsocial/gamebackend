const express = require("express");
const { register, login, checkUsername,
    verifyEmail,
    forgotPassword,
    resetPassword,
    updateProfile, } = require("../controller/authController");
const authMiddleware = require("../middleware/authMiddleware");
const router = express.Router();


router.post("/register", register);
router.post("/login", login);
router.put("/updateProfile",authMiddleware, updateProfile)
router.get("/check-username/:username", checkUsername)
router.get("/verify-email/:token", verifyEmail)
router.post("/forgot-password", forgotPassword)
router.post("/reset-password/:token", resetPassword)

// 


// router.post("/sendmessages", authMiddleware, sendMessage)
// router.get("/messages", authMiddleware, getMessages);

 
module.exports = router;
