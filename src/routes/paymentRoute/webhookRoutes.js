const express = require("express")
const router = express.Router()
const webhookController = require("../../controller/paymentController/webhookController")

// Webhook route - no authentication needed
router.post("/", express.raw({ type: "application/json" }), webhookController.handleWebhook)

module.exports = router
