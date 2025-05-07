const express = require("express")
const router = express.Router()
const paymentController = require("../../controller/paymentController/payment-controller")
const authenticate = require("../../middleware/authMiddleware")
const validateObjectId = require("../../middleware/validateObjectId")

// All routes are protected except webhook
router.use(authenticate)

// Customer route - must be before other routes
router.get("/customer", paymentController.getOrCreateCustomer)

// Wallet balance routes
router.get("/wallet", paymentController.getWalletBalance)
router.post("/wallet/update", paymentController.updateWalletBalance)
router.post("/wallet/refresh", paymentController.refreshWalletBalance)

// Payment intent routes
router.post("/create-intent", paymentController.createPaymentIntent)
router.post("/confirm/:paymentId", validateObjectId("paymentId"), paymentController.confirmPayment)

// Setup intent routes - support both GET and POST
router.get("/setup-intent", paymentController.createSetupIntent)
router.post("/setup-intent", paymentController.createSetupIntent)

// Payment method routes
router.get("/methods", paymentController.getPaymentMethods)
router.post("/methods", paymentController.addPaymentMethod)
router.post("/methods/attach", paymentController.attachPaymentMethod)
router.delete("/methods/:methodId", paymentController.deletePaymentMethod)

// Payment history routes
router.get("/history", paymentController.getPaymentHistory)

// This route must come AFTER all other specific routes to avoid conflicts
router.get("/:paymentId", validateObjectId("paymentId"), paymentController.getPaymentById)

module.exports = router
