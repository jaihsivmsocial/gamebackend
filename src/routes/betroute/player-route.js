const express = require("express");
const router = express.Router();
const playerController = require("../../controller/BetController/playerController");
// const  authenticate = require("../../middleware/authMiddleware.js")

router.post("/", playerController.createPlayer);
router.get("/get", playerController.getPlayers);
router.put("/:id", playerController.updatePlayer);

router.post('/:id/kill', playerController.addKillToHolder);
router.post('/reset-holder', playerController.resetCameraHolder);

module.exports = router;
