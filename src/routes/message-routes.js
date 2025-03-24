const express = require("express");
const router = express.Router();
const messageController = require("../controller/message-controller");

router.get("/messages/:streamId", messageController.getMessages);
router.post("/messages", messageController.sendChatMessage);

module.exports = router;