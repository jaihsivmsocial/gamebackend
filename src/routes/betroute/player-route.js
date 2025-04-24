const express = require("express");
const router = express.Router();
const playerController = require("../../controller/BetController/playerController");
const  authenticate = require("../../middleware/authMiddleware.js")

router.post("/name", authenticate, playerController.createPlayer);
router.get("/get", authenticate, playerController.getPlayers);
router.put("/:id", authenticate, playerController.updatePlayer);

module.exports = router;
