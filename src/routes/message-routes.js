const express = require("express")
const router = express.Router()
const messageController = require("../controller/message-controller")

// Get messages for a stream
router.get("/messages/:streamId", messageController.getMessages)

// Send a new message
router.post("/messages", messageController.sendChatMessage)

// Reply to a message
router.post("/messages/reply", messageController.replyToMessage)

module.exports = router
