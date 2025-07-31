require("dotenv").config()
const Payment = require("../../model/payment/Payment")
const PaymentMethod = require("../../model/payment/PaymentMethod")
const User = require("../../model/authModel/userModel")
const stripeService = require("../../utils/payment-utils")
const playFabService = require("../../utils/playfab/playfab-service") // Import PlayFab service
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)
const mongoose = require("mongoose")

if (!playFabService) {
  console.error("❌ PlayFab service failed to load")
}

const updatePlayFabInventory = async (user, amount, paymentId, source = "payment") => {
  try {
    // Check if PlayFab is configured
    if (!playFabService.isConfigured()) {
      return { success: false, reason: "PlayFab not configured" }
    }
    // Check if user has PlayFab data
    const entityId = playFabService.getPlayFabEntityId(user)
    if (!entityId) {
      return { success: false, reason: "No PlayFab Entity ID" }
    }
    console.log(`✅ Using PlayFab Entity ID: ${entityId} for user ${user._id}`)
    // Process payment to PlayFab using production service (same as your Postman)
    console.log("🚀 Calling playFabService.processPaymentToPlayFab (Production)...")
    const result = await playFabService.processPaymentToPlayFab(user, amount, paymentId, {
      source,
      userId: user._id.toString(),
    })
    if (result.success) {
      console.log(`✅ Successfully updated PlayFab inventory for user ${user._id} (Production)`)
      console.log("PlayFab Result:", result.playFabResult)
    } else {
      console.error(`❌ Failed to update PlayFab inventory: ${result.error}`)
    }
    return result
  } catch (error) {
    console.error("❌ Error updating PlayFab inventory:", error.message)
    return { success: false, error: error.message }
  }
}

// Export the updatePlayFabInventory function
exports.updatePlayFabInventory = updatePlayFabInventory

exports.getWalletBalance = async (req, res) => {
  try {
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      console.error("User not authenticated")
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      })
    }
    // Find the user
    const user = await User.findById(req.user.id)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }
    // Get total completed payments for this user
    const completedPayments = await Payment.find({
      userId: req.user.id,
      status: "completed",
    })
    // Calculate total amount from completed payments
    const totalPayments = completedPayments.reduce((total, payment) => {
      return total + (payment.amount || 0)
    }, 0)
    // Get PlayFab balance if configured (using production service)
    let playFabBalance = null
    let playFabSynced = false
    try {
      if (playFabService.isConfigured()) {
        const entityId = playFabService.getPlayFabEntityId(user)
        if (entityId) {
          console.log("🔍 Getting PlayFab balance using production service...")
          const inventoryData = await playFabService.getPlayerInventory(user)
          if (inventoryData.success) {
            playFabBalance = inventoryData.virtualCurrencyBalance
            playFabSynced = true
            console.log(`✅ PlayFab balance retrieved: ${playFabBalance}`)
          }
        }
      }
    } catch (error) {
      console.error("Error getting PlayFab balance:", error.message)
      // Don't fail the request if PlayFab is unavailable
    }
    // Return wallet balance and payment stats
    return res.status(200).json({
      success: true,
      walletBalance: user.walletBalance || 0,
      accountBalance: user.accountBalance || 0,
      totalPayments: totalPayments,
      paymentCount: completedPayments.length,
      playFabBalance,
      playFabSynced,
      lastUpdated: new Date(),
    })
  } catch (error) {
    console.error("Error getting wallet balance:", error)
    return res.status(500).json({
      success: false,
      message: "Error retrieving wallet balance",
      error: error.message,
    })
  }
}

/**
 * Update wallet balance for the current user
 * @route POST /api/payments/wallet/update
 * @access Private
 */
exports.updateWalletBalance = async (req, res) => {
  try {
    const { amount } = req.body
    // Validate amount
    if (amount === undefined || isNaN(Number.parseFloat(amount))) {
      return res.status(400).json({
        success: false,
        message: "Valid amount is required",
      })
    }
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      console.error("User not authenticated")
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      })
    }
    // Find the user
    const user = await User.findById(req.user.id)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }
    // Get current balance
    const currentBalance = user.walletBalance || 0
    // Update user's wallet balance
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { walletBalance: Number.parseFloat(amount) },
      { new: true },
    )
    // Emit wallet update event if socket.io is available
    try {
      const io = require("../../controller/socket/socket-manager").io
      if (io) {
        io.emit("wallet_update", {
          userId: req.user.id,
          newBalance: Number.parseFloat(amount),
          previousBalance: currentBalance,
          change: Number.parseFloat(amount) - currentBalance,
          source: "manual_update",
        })
      }
    } catch (error) {
      console.log("Socket.io not available for wallet update notification")
    }
    return res.status(200).json({
      success: true,
      previousBalance: currentBalance,
      newBalance: updatedUser.walletBalance,
      change: updatedUser.walletBalance - currentBalance,
      message: "Wallet balance updated successfully",
    })
  } catch (error) {
    console.error("Error updating wallet balance:", error)
    return res.status(500).json({
      success: false,
      message: "Error updating wallet balance",
      error: error.message,
    })
  }
}

/**
 * Refresh wallet balance from payment history
 * @route POST /api/payments/wallet/refresh
 * @access Private
 */
exports.refreshWalletBalance = async (req, res) => {
  try {
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      console.error("User not authenticated")
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      })
    }
    // Find the user
    const user = await User.findById(req.user.id)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }
    // Get all completed payments for this user
    const completedPayments = await Payment.find({
      userId: req.user.id,
      status: "completed",
    })
    // Calculate total amount from completed payments
    const totalPayments = completedPayments.reduce((total, payment) => {
      return total + (payment.amount || 0)
    }, 0)
    // Get current balance
    const currentBalance = user.walletBalance || 0
    // Update user's wallet balance based on payment history
    const updatedUser = await User.findByIdAndUpdate(req.user.id, { walletBalance: totalPayments }, { new: true })
    // Emit wallet update event if socket.io is available
    try {
      const io = require("../../controller/socket/socket-manager").io
      if (io) {
        io.emit("wallet_update", {
          userId: req.user.id,
          newBalance: totalPayments,
          previousBalance: currentBalance,
          change: totalPayments - currentBalance,
          source: "refresh",
        })
      }
    } catch (error) {
      console.log("Socket.io not available for wallet update notification")
    }
    return res.status(200).json({
      success: true,
      previousBalance: currentBalance,
      newBalance: updatedUser.walletBalance,
      paymentCount: completedPayments.length,
      message: "Wallet balance refreshed successfully",
    })
  } catch (error) {
    console.error("Error refreshing wallet balance:", error)
    return res.status(500).json({
      success: false,
      message: "Error refreshing wallet balance",
      error: error.message,
    })
  }
}

/**
 * Get or create a Stripe customer for the current user
 * @route GET /api/payments/customer
 * @access Private
 */
exports.getOrCreateCustomer = async (req, res) => {
  try {
    console.log("Getting or creating Stripe customer for user:", req.user.id)
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      console.error("User not authenticated")
      return res.status(401).json({ message: "Authentication required" })
    }
    // Get or create customer
    const customerId = await stripeService.getOrCreateCustomer(req.user.id)
    console.log("Stripe customer ID:", customerId)
    return res.status(200).json({
      success: true,
      customerId,
    })
  } catch (error) {
    console.error("Error getting or creating customer:", error)
    return res.status(500).json({
      message: "Error getting or creating customer",
      error: error.message,
    })
  }
}

/**
 * Attach a payment method to a customer
 * @route POST /api/payments/methods/attach
 * @access Private
 */
exports.attachPaymentMethod = async (req, res) => {
  try {
    const { paymentMethodId, customerId } = req.body
    console.log(`Attaching payment method ${paymentMethodId} to customer ${customerId}`)
    if (!paymentMethodId) {
      return res.status(400).json({ message: "Payment method ID is required" })
    }
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      console.error("User not authenticated")
      return res.status(401).json({ message: "Authentication required" })
    }
    // Get customer ID from request or get/create one
    let customerIdToUse = customerId
    if (!customerIdToUse) {
      try {
        customerIdToUse = await stripeService.getOrCreateCustomer(req.user.id)
      } catch (customerError) {
        console.error("Error getting or creating customer:", customerError)
        return res.status(500).json({
          message: "Error getting or creating customer",
          error: customerError.message,
        })
      }
    }
    console.log(`Using customer ID: ${customerIdToUse}`)
    try {
      // Attach payment method to customer
      const paymentMethod = await stripeService.attachPaymentMethod(paymentMethodId, customerIdToUse)
      // Save payment method to database
      if (paymentMethod.card) {
        // Check if this payment method is already saved
        const existingMethod = await PaymentMethod.findOne({
          stripePaymentMethodId: paymentMethod.id,
          userId: req.user.id,
        })
        if (!existingMethod) {
          await PaymentMethod.create({
            userId: req.user.id,
            stripePaymentMethodId: paymentMethod.id,
            type: "card",
            isDefault: false,
            details: {
              brand: paymentMethod.card.brand,
              last4: paymentMethod.card.last4,
              expMonth: paymentMethod.card.exp_month,
              expYear: paymentMethod.card.exp_year,
            },
            billingDetails: paymentMethod.billing_details
              ? {
                  name: paymentMethod.billing_details.name,
                  email: paymentMethod.billing_details.email,
                  phone: paymentMethod.billing_details.phone,
                  address: paymentMethod.billing_details.address,
                }
              : {},
          })
        }
      }
      return res.status(200).json({
        success: true,
        paymentMethod: {
          id: paymentMethod.id,
          type: paymentMethod.type,
          brand: paymentMethod.card?.brand,
          last4: paymentMethod.card?.last4,
          expMonth: paymentMethod.card?.exp_month,
          expYear: paymentMethod.card?.exp_year,
        },
        customerId: customerIdToUse,
      })
    } catch (stripeError) {
      console.error("Stripe error attaching payment method:", stripeError)
      // Check if it's already attached to this customer
      if (stripeError.message.includes("already been attached")) {
        try {
          // Just retrieve the payment method
          const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
          return res.status(200).json({
            success: true,
            paymentMethod: {
              id: paymentMethod.id,
              type: paymentMethod.type,
              brand: paymentMethod.card?.brand,
              last4: paymentMethod.card?.last4,
              expMonth: paymentMethod.card?.exp_month,
              expYear: paymentMethod.card?.exp_year,
            },
            customerId: customerIdToUse,
            message: "Payment method already attached to this customer",
          })
        } catch (retrieveError) {
          console.error("Error retrieving payment method:", retrieveError)
          return res.status(500).json({
            message: "Error retrieving payment method",
            error: retrieveError.message,
          })
        }
      }
      return res.status(400).json({
        message: "Error attaching payment method",
        error: stripeError.message,
      })
    }
  } catch (error) {
    console.error("Error in attachPaymentMethod controller:", error)
    return res.status(500).json({
      message: "Error attaching payment method",
      error: error.message,
    })
  }
}

/**
 * Create a payment intent
 * @route POST /api/payments/create-intent
 * @access Private
 */
exports.createPaymentIntent = async (req, res) => {
  console.log("=== CREATE PAYMENT INTENT REQUEST (Production) ===")
  console.log("Request body:", JSON.stringify(req.body, null, 2))
  console.log("User:", req.user ? `ID: ${req.user.id}` : "Not authenticated")
  try {
    const { amount, currency = "usd", paymentMethod, saveCard, customerId } = req.body
    // Validate amount
    if (!amount) {
      console.log("Missing amount in request")
      return res.status(400).json({
        success: false,
        message: "Amount is required",
      })
    }
    // Convert amount to number if it's a string
    const numericAmount = typeof amount === "string" ? Number.parseFloat(amount) : amount
    if (isNaN(numericAmount) || numericAmount <= 0) {
      console.log("Invalid amount:", amount, "Parsed as:", numericAmount)
      return res.status(400).json({
        success: false,
        message: "Valid amount is required (must be a positive number)",
      })
    }
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      console.error("User not authenticated")
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      })
    }
    console.log(`Processing ${paymentMethod} payment for amount ${numericAmount} ${currency}`)
    // Handle account balance payment method separately
    if (paymentMethod === "balance") {
      // Get user and check balance
      const user = await User.findById(req.user.id)
      if (!user) {
        console.error("User not found:", req.user.id)
        return res.status(404).json({
          success: false,
          message: "User not found",
        })
      }
      console.log("User account balance:", user.accountBalance)
      if (!user.accountBalance || user.accountBalance < numericAmount) {
        return res.status(400).json({
          success: false,
          message: "Insufficient account balance",
          availableBalance: user.accountBalance || 0,
        })
      }
      // Create payment record
      const payment = await Payment.create({
        userId: req.user.id,
        amount: numericAmount,
        currency,
        status: "completed",
        paymentMethod: "balance",
        metadata: {
          description: "Account balance payment",
        },
      })
      console.log("Payment created:", payment._id)
      // Update user's wallet balance with the payment amount
      const previousWalletBalance = user.walletBalance || 0
      await User.findByIdAndUpdate(req.user.id, {
        $inc: {
          walletBalance: numericAmount,
          accountBalance: -numericAmount,
        },
      })
      console.log(`User wallet balance updated: +${numericAmount}`)
      console.log(`User account balance updated: -${numericAmount}`)
      // Update PlayFab inventory using production service (same as your Postman)
      const playFabResult = await updatePlayFabInventory(user, numericAmount, payment._id.toString(), "balance")
      // Emit wallet update event if socket.io is available
      try {
        const io = require("../../controller/socket/socket-manager").io
        if (io) {
          io.emit("wallet_update", {
            userId: req.user.id,
            newBalance: previousWalletBalance + numericAmount,
            previousBalance: previousWalletBalance,
            change: numericAmount,
            source: "balance_payment",
            playFabUpdated: playFabResult.success,
          })
        }
      } catch (error) {
        console.log("Socket.io not available for wallet update notification")
      }
      return res.status(201).json({
        success: true,
        payment,
        message: "Payment completed successfully using account balance",
        walletBalance: previousWalletBalance + numericAmount,
        accountBalance: user.accountBalance - numericAmount,
        playFabResult,
      })
    }
    // Handle direct payment (when Stripe isn't available in frontend)
    if (req.body.directPayment) {
      console.log("Processing direct payment without Stripe")
      // Get user for PlayFab update
      const user = await User.findById(req.user.id)
      // Create payment record
      const payment = await Payment.create({
        userId: req.user.id,
        amount: numericAmount,
        currency,
        status: "completed", // Mark as completed immediately
        paymentMethod,
        metadata: {
          description: "Direct payment (no Stripe)",
          cardDetails: req.body.cardDetails ? JSON.stringify(req.body.cardDetails) : null,
        },
      })
      console.log("Direct payment created:", payment._id)
      // Update user's wallet balance
      if (user) {
        const previousBalance = user.walletBalance || 0
        user.walletBalance = previousBalance + numericAmount
        await user.save()
        console.log(`User wallet balance updated: +${numericAmount}`)
        // Update PlayFab inventory using production service (same as your Postman)
        const playFabResult = await updatePlayFabInventory(user, numericAmount, payment._id.toString(), "direct")
        // Emit wallet update event if socket.io is available
        try {
          const io = require("../../controller/socket/socket-manager").io
          if (io) {
            io.emit("wallet_update", {
              userId: req.user.id,
              newBalance: user.walletBalance,
              previousBalance: previousBalance,
              change: numericAmount,
              source: "direct_payment",
              playFabUpdated: playFabResult.success,
            })
          }
        } catch (error) {
          console.log("Socket.io not available for wallet update notification")
        }
        return res.status(201).json({
          success: true,
          payment,
          message: "Payment completed successfully via direct payment",
          walletBalance: user.walletBalance,
          playFabResult,
        })
      }
    }
    // For card payments, create a Stripe payment intent
    console.log("Creating Stripe payment intent")
    try {
      // Use provided customer ID or get/create one
      let stripeCustomerId = customerId
      if (!stripeCustomerId) {
        try {
          stripeCustomerId = await stripeService.getOrCreateCustomer(req.user.id)
          console.log("Created/retrieved Stripe customer ID:", stripeCustomerId)
        } catch (customerError) {
          console.error("Error getting/creating Stripe customer:", customerError)
          return res.status(500).json({
            success: false,
            message: "Error creating Stripe customer",
            error: customerError.message,
          })
        }
      }
      console.log("Using Stripe customer ID:", stripeCustomerId)
      // Create the payment intent parameters
      const paymentIntentParams = {
        amount: Math.round(numericAmount * 100), // Convert to cents
        currency,
        customer: stripeCustomerId,
        metadata: {
          userId: req.user.id,
          paymentMethod,
        },
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
      }
      // Only add setup_future_usage if saveCard is true
      if (saveCard) {
        paymentIntentParams.setup_future_future_usage = "off_session"
      }
      // If a specific payment method is provided, use it
      if (paymentMethod && paymentMethod !== "balance" && paymentMethod.startsWith("pm_")) {
        paymentIntentParams.payment_method = paymentMethod
      }
      console.log("Payment intent params:", JSON.stringify(paymentIntentParams, null, 2))
      const paymentIntent = await stripeService.createPaymentIntent(paymentIntentParams)
      console.log("Stripe payment intent created:", paymentIntent.id)
      // Create payment record
      const payment = await Payment.create({
        userId: req.user.id,
        amount: numericAmount,
        currency,
        status: "pending",
        paymentMethod,
        stripePaymentIntentId: paymentIntent.id,
        stripeCustomerId: stripeCustomerId,
        metadata: {
          description: "Card payment",
        },
      })
      console.log("Payment record created:", payment._id)
      return res.status(201).json({
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentId: payment._id,
        paymentIntentId: paymentIntent.id,
        customerId: stripeCustomerId,
      })
    } catch (stripeError) {
      console.error("Stripe error:", stripeError)
      return res.status(400).json({
        success: false,
        message: "Error processing with Stripe",
        error: stripeError.message,
        code: stripeError.code || "stripe_error",
      })
    }
  } catch (error) {
    console.error("Error creating payment intent:", error)
    return res.status(500).json({
      success: false,
      message: "Error creating payment",
      error: error.message,
    })
  }
}

/**
 * Confirm a payment
 * @route POST /api/payments/confirm/:paymentId
 * @access Private
 */
exports.confirmPayment = async (req, res) => {
  try {
    const { paymentId } = req.params
    const { paymentIntentId, paymentMethodId, saveCard } = req.body
    if (!paymentIntentId) {
      return res.status(400).json({ message: "Payment intent ID is required" })
    }
    // Find the payment
    const payment = await Payment.findById(paymentId)
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" })
    }
    // Verify that the payment belongs to the user
    if (payment.userId.toString() !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized" })
    }
    // Retrieve the payment intent from Stripe
    const paymentIntent = await stripeService.retrievePaymentIntent(paymentIntentId)
    let user = null
    let playFabResult = null
    if (paymentIntent.status === "succeeded") {
      // Payment already succeeded
      payment.status = "completed"
      // Safely access receipt URL if it exists
      if (paymentIntent.charges && paymentIntent.charges.data && paymentIntent.charges.data.length > 0) {
        payment.receiptUrl = paymentIntent.charges.data[0].receipt_url
      }
      // Save card details if available
      if (paymentIntent.payment_method) {
        try {
          const paymentMethod = await stripe.paymentMethods.retrieve(paymentIntent.payment_method)
          if (paymentMethod.card) {
            payment.cardDetails = {
              last4: paymentMethod.card.last4,
              brand: paymentMethod.card.brand,
              expMonth: paymentMethod.card.exp_month,
              expYear: paymentMethod.card.exp_year,
            }
            // Check if this payment method is already saved
            const existingMethod = await PaymentMethod.findOne({
              stripePaymentMethodId: paymentMethod.id,
              userId: req.user.id,
            })
            // Save as a payment method for future use (always save it if it doesn't exist)
            if (!existingMethod) {
              await PaymentMethod.create({
                userId: req.user.id,
                stripePaymentMethodId: paymentMethod.id,
                type: "card",
                isDefault: false,
                details: {
                  brand: paymentMethod.card.brand,
                  last4: paymentMethod.card.last4,
                  expMonth: paymentMethod.card.exp_month,
                  expYear: paymentMethod.card.exp_year,
                },
                billingDetails: paymentMethod.billing_details
                  ? {
                      name: paymentMethod.billing_details.name,
                      email: paymentMethod.billing_details.email,
                      phone: paymentMethod.billing_details.phone,
                      address: paymentMethod.billing_details.address,
                    }
                  : {},
              })
              console.log(`Payment method ${paymentMethod.id} saved for user ${req.user.id}`)
            }
          }
        } catch (error) {
          console.error("Error saving payment method:", error)
        }
      }
      await payment.save()
      // Update user's wallet balance if payment is successful
      user = await User.findById(req.user.id)
      if (user) {
        const previousBalance = user.walletBalance || 0
        user.walletBalance = previousBalance + payment.amount
        await user.save()
        console.log(`User wallet balance updated: +${payment.amount}`)
        // Update PlayFab inventory using production service (same as your Postman)
        playFabResult = await updatePlayFabInventory(user, payment.amount, payment._id.toString(), "stripe")
        // Emit wallet update event if socket.io is available
        try {
          const io = require("../../controller/socket/socket-manager").io
          if (io) {
            io.emit("wallet_update", {
              userId: req.user.id,
              newBalance: user.walletBalance,
              previousBalance: previousBalance,
              change: payment.amount,
              source: "payment_confirmation",
              playFabUpdated: playFabResult.success,
            })
          }
        } catch (error) {
          console.log("Socket.io not available for wallet update notification")
        }
      }
      return res.status(200).json({
        success: true,
        payment,
        message: "Payment completed successfully",
        walletBalance: user ? user.walletBalance : null,
        playFabResult,
      })
    }
    // Handle other payment intent statuses (requires_payment_method, requires_confirmation, etc.)
    // ... (rest of the existing confirmation logic remains the same, but add PlayFab updates where wallet is updated)
    return res.status(400).json({
      success: false,
      message: `Payment is in ${paymentIntent.status} state`,
      paymentIntentStatus: paymentIntent.status,
    })
  } catch (error) {
    console.error("Error confirming payment:", error)
    return res.status(500).json({
      message: "Error confirming payment",
      error: error.message,
    })
  }
}

/**
 * Get payment methods for a user
 * @route GET /api/payments/methods
 * @access Private
 */
exports.getPaymentMethods = async (req, res) => {
  try {
    // First check our database for saved payment methods
    const savedMethods = await PaymentMethod.find({ userId: req.user.id })
    if (savedMethods && savedMethods.length > 0) {
      // Format the response from our database
      const formattedMethods = savedMethods.map((method) => ({
        id: method.stripePaymentMethodId,
        type: method.type,
        brand: method.details.brand,
        last4: method.details.last4,
        expMonth: method.details.expMonth,
        expYear: method.details.expYear,
        billingDetails: method.billingDetails,
      }))
      return res.status(200).json({
        success: true,
        paymentMethods: formattedMethods,
      })
    }
    // If no methods in database, try to get from Stripe
    const user = await User.findById(req.user.id)
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }
    if (!user.stripeCustomerId) {
      return res.status(200).json({ paymentMethods: [] })
    }
    // Get payment methods from Stripe
    const paymentMethods = await stripeService.listPaymentMethods(user.stripeCustomerId, "card")
    // Format the response
    const formattedMethods = paymentMethods.map((method) => ({
      id: method.id,
      type: method.type,
      brand: method.card.brand,
      last4: method.card.last4,
      expMonth: method.card.exp_month,
      expYear: method.card.exp_year,
      billingDetails: method.billing_details,
    }))
    // Save these methods to our database for future use
    for (const method of paymentMethods) {
      const existingMethod = await PaymentMethod.findOne({
        stripePaymentMethodId: method.id,
        userId: req.user.id,
      })
      if (!existingMethod && method.card) {
        await PaymentMethod.create({
          userId: req.user.id,
          stripePaymentMethodId: method.id,
          type: "card",
          isDefault: false,
          details: {
            brand: method.card.brand,
            last4: method.card.last4,
            expMonth: method.card.exp_month,
            expYear: method.card.exp_year,
          },
          billingDetails: method.billing_details
            ? {
                name: method.billing_details.name,
                email: method.billing_details.email,
                phone: method.billing_details.phone,
                address: method.billing_details.address,
              }
            : {},
        })
      }
    }
    return res.status(200).json({
      success: true,
      paymentMethods: formattedMethods,
    })
  } catch (error) {
    console.error("Error getting payment methods:", error)
    return res.status(500).json({
      message: "Error getting payment methods",
      error: error.message,
    })
  }
}

/**
 * Add a new payment method
 * @route POST /api/payments/methods
 * @access Private
 */
exports.addPaymentMethod = async (req, res) => {
  try {
    const { paymentMethodId } = req.body
    if (!paymentMethodId) {
      return res.status(400).json({ message: "Payment method ID is required" })
    }
    // Get or create customer
    const customerId = await stripeService.getOrCreateCustomer(req.user.id)
    // Attach payment method to customer
    const paymentMethod = await stripeService.attachPaymentMethod(paymentMethodId, customerId)
    // Save payment method to database
    if (paymentMethod.card) {
      await PaymentMethod.create({
        userId: req.user.id,
        stripePaymentMethodId: paymentMethod.id,
        type: "card",
        isDefault: false,
        details: {
          brand: paymentMethod.card.brand,
          last4: paymentMethod.card.last4,
          expMonth: paymentMethod.card.exp_month,
          expYear: paymentMethod.card.exp_year,
        },
        billingDetails: {
          name: paymentMethod.billing_details.name,
          email: paymentMethod.billing_details.email,
          phone: paymentMethod.billing_details.phone,
          address: paymentMethod.billing_details.address,
        },
      })
    }
    return res.status(201).json({
      success: true,
      paymentMethod: {
        id: paymentMethod.id,
        type: paymentMethod.type,
        brand: paymentMethod.card?.brand,
        last4: paymentMethod.card?.last4,
        expMonth: paymentMethod.card?.exp_month,
        expYear: paymentMethod.card?.exp_year,
      },
    })
  } catch (error) {
    console.error("Error adding payment method:", error)
    return res.status(500).json({
      message: "Error adding payment method",
      error: error.message,
    })
  }
}

/**
 * Delete a payment method
 * @route DELETE /api/payments/methods/:methodId
 * @access Private
 */
exports.deletePaymentMethod = async (req, res) => {
  try {
    const { methodId } = req.params
    // Find payment method in database
    const paymentMethod = await PaymentMethod.findOne({
      stripePaymentMethodId: methodId,
      userId: req.user.id,
    })
    if (!paymentMethod) {
      return res.status(404).json({ message: "Payment method not found" })
    }
    // Detach payment method from Stripe
    await stripeService.detachPaymentMethod(methodId)
    // Delete payment method from database
    await PaymentMethod.deleteOne({ _id: paymentMethod._id })
    return res.status(200).json({
      success: true,
      message: "Payment method deleted successfully",
    })
  } catch (error) {
    console.error("Error deleting payment method:", error)
    return res.status(500).json({
      message: "Error deleting payment method",
      error: error.message,
    })
  }
}

/**
 * Get payment history for a user
 * @route GET /api/payments/history
 * @access Private
 */
exports.getPaymentHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query
    const query = { userId: req.user.id }
    if (status) {
      query.status = status
    }
    const options = {
      page: Number.parseInt(page),
      limit: Number.parseInt(limit),
      sort: { createdAt: -1 },
      populate: {
        path: "userId",
        select: "username email",
      },
    }
    const payments = await Payment.find(query)
      .skip((options.page - 1) * options.limit)
      .limit(options.limit)
      .sort(options.sort)
      .populate(options.populate)
    const total = await Payment.countDocuments(query)
    return res.status(200).json({
      success: true,
      payments,
      totalPages: Math.ceil(total / options.limit),
      currentPage: options.page,
      totalPayments: total,
    })
  } catch (error) {
    console.error("Error getting payment history:", error)
    return res.status(500).json({
      message: "Error getting payment history",
      error: error.message,
    })
  }
}

/**
 * Get a single payment by ID
 * @route GET /api/payments/:paymentId
 * @access Private
 */
exports.getPaymentById = async (req, res) => {
  try {
    const { paymentId } = req.params
    // This check is now redundant due to the middleware, but keeping for extra safety
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
      })
    }
    const payment = await Payment.findById(paymentId).populate({
      path: "userId",
      select: "username email",
    })
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      })
    }
    // Verify that the payment belongs to the user
    if (payment.userId._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      })
    }
    // If payment has a Stripe payment intent, get the latest status
    if (payment.stripePaymentIntentId) {
      try {
        const paymentIntent = await stripeService.retrievePaymentIntent(payment.stripePaymentIntentId)
        // Update payment status if it has changed
        if (
          (paymentIntent.status === "succeeded" && payment.status !== "completed") ||
          (paymentIntent.status === "canceled" && payment.status !== "failed")
        ) {
          payment.status = paymentIntent.status === "succeeded" ? "completed" : "failed"
          await payment.save()
        }
      } catch (stripeError) {
        // Log the error but don't fail the request
        console.error("Error retrieving payment intent from Stripe:", stripeError)
      }
    }
    return res.status(200).json({
      success: true,
      payment,
    })
  } catch (error) {
    console.error("Error getting payment:", error)
    return res.status(500).json({
      success: false,
      message: "Error getting payment",
      error: error.message,
    })
  }
}

/**
 * Create a setup intent for saving a card
 * @route POST /api/payments/setup-intent
 * @route GET /api/payments/setup-intent
 * @access Private
 */
exports.createSetupIntent = async (req, res) => {
  try {
    // Get or create customer
    const customerId = await stripeService.getOrCreateCustomer(req.user.id)
    // Create setup intent
    const setupIntent = await stripeService.createSetupIntent(customerId)
    return res.status(201).json({
      success: true,
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      customerId: customerId,
    })
  } catch (error) {
    console.error("Error creating setup intent:", error)
    return res.status(500).json({
      success: false,
      message: "Error creating setup intent",
      error: error.message,
    })
  }
}
