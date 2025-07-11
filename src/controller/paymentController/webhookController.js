require('dotenv').config();

const Payment = require("../../model/payment/Payment")
const PaymentMethod = require("../../model/payment/PaymentMethod")
const User = require("../../model/authModel/userModel")
const stripeService = require("../../utils/payment-utils")
const playfabService = require("../../utils/playfab/playfab-service") // Import PlayFab service
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

/**
 * Handle Stripe webhook events (with PlayFab integration)
 * @route POST /api/webhook
 * @access Public
 */
const handleWebhook = async (req, res) => {
  const signature = req.headers["stripe-signature"]

  if (!signature) {
    return res.status(400).json({ message: "Stripe signature is missing" })
  }

  try {
    const event = stripeService.constructEvent(req.rawBody || req.body, signature)
    console.log(`Webhook received: ${event.type}`)

    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object)
        break
      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object)
        break
      case "payment_method.attached":
        await handlePaymentMethodAttached(event.data.object)
        break
      case "payment_method.detached":
        await handlePaymentMethodDetached(event.data.object)
        break
      case "charge.refunded":
        await handleChargeRefunded(event.data.object)
        break
      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return res.status(200).json({ received: true })
  } catch (error) {
    console.error("Webhook error:", error)
    return res.status(400).json({ message: `Webhook error: ${error.message}` })
  }
}

/**
 * Handle payment_intent.succeeded event (with PlayFab integration)
 * @param {Object} paymentIntent - Stripe payment intent
 */
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  try {
    // Find the payment in our database
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id,
    })

    if (!payment) {
      console.log(`Payment not found for intent: ${paymentIntent.id}`)
      return
    }

    // Get user information
    const user = await User.findById(payment.userId)
    if (!user) {
      console.log(`User not found for payment: ${payment._id}`)
      return
    }

    // Update payment status
    payment.status = "completed"
    payment.receiptUrl = paymentIntent.charges.data[0]?.receipt_url

    // Save card details if available
    if (paymentIntent.payment_method) {
      const stripePaymentMethod = await stripe.paymentMethods.retrieve(paymentIntent.payment_method)
      if (stripePaymentMethod.card) {
        payment.cardDetails = {
          last4: stripePaymentMethod.card.last4,
          brand: stripePaymentMethod.card.brand,
          expMonth: stripePaymentMethod.card.exp_month,
          expYear: stripePaymentMethod.card.exp_year,
        }

        // Check if this payment method is already saved
        const existingMethod = await PaymentMethod.findOne({
          stripePaymentMethodId: stripePaymentMethod.id,
        })

        if (!existingMethod && paymentIntent.setup_future_usage === "off_session") {
          // Save as a payment method for future use
          await PaymentMethod.create({
            userId: payment.userId,
            stripePaymentMethodId: stripePaymentMethod.id,
            type: "card",
            isDefault: false,
            details: {
              brand: stripePaymentMethod.card.brand,
              last4: stripePaymentMethod.card.last4,
              expMonth: stripePaymentMethod.card.exp_month,
              expYear: stripePaymentMethod.card.exp_year,
            },
            billingDetails: {
              name: stripePaymentMethod.billing_details.name,
              email: stripePaymentMethod.billing_details.email,
              phone: stripePaymentMethod.billing_details.phone,
              address: stripePaymentMethod.billing_details.address,
            },
          })
        }
      }
    }

    await payment.save()

    // Update user's wallet balance
    const previousBalance = user.walletBalance || 0
    user.walletBalance = previousBalance + payment.amount
    await user.save()

    // Update PlayFab wallet
    try {
      await playfabService.getOrCreatePlayer(payment.userId.toString(), user.email, user.username)
      await playfabService.updatePlayerWallet(
        payment.userId.toString(),
        payment.amount,
        "Stripe Webhook - Payment Succeeded",
      )
      console.log(`PlayFab wallet updated for user ${payment.userId}: +${payment.amount}`)
    } catch (playfabError) {
      console.error("PlayFab wallet update error in webhook:", playfabError.message)
    }

    // Emit wallet update event if socket.io is available
    try {
      const io = require("../../controller/socket/socket-manager").io
      if (io) {
        io.emit("wallet_update", {
          userId: payment.userId.toString(),
          newBalance: user.walletBalance,
          previousBalance: previousBalance,
          change: payment.amount,
          source: "webhook_payment_succeeded",
        })
      }
    } catch (error) {
      console.log("Socket.io not available for wallet update notification")
    }

    console.log(`Payment ${payment._id} marked as completed and wallet updated`)
  } catch (error) {
    console.error("Error handling payment_intent.succeeded:", error)
  }
}

/**
 * Handle payment_intent.payment_failed event
 * @param {Object} paymentIntent - Stripe payment intent
 */
const handlePaymentIntentFailed = async (paymentIntent) => {
  try {
    // Find the payment in our database
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id,
    })

    if (!payment) {
      console.log(`Payment not found for intent: ${paymentIntent.id}`)
      return
    }

    // Update payment status
    payment.status = "failed"
    payment.metadata.set("failureMessage", paymentIntent.last_payment_error?.message || "Payment failed")

    await payment.save()

    console.log(`Payment ${payment._id} marked as failed`)
  } catch (error) {
    console.error("Error handling payment_intent.payment_failed:", error)
  }
}

/**
 * Handle payment_method.attached event
 * @param {Object} paymentMethod - Stripe payment method
 */
const handlePaymentMethodAttached = async (paymentMethod) => {
  try {
    // Check if this payment method is already in our database
    const existingMethod = await PaymentMethod.findOne({
      stripePaymentMethodId: paymentMethod.id,
    })

    if (existingMethod) {
      console.log(`Payment method ${paymentMethod.id} already exists`)
      return
    }

    // Find the user by Stripe customer ID
    const user = await User.findOne({
      stripeCustomerId: paymentMethod.customer,
    })

    if (!user) {
      console.log(`User not found for customer: ${paymentMethod.customer}`)
      return
    }

    // Save the payment method
    if (paymentMethod.type === "card") {
      await PaymentMethod.create({
        userId: user._id,
        stripePaymentMethodId: paymentMethod.id,
        type: paymentMethod.type,
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

      console.log(`Payment method ${paymentMethod.id} saved for user ${user._id}`)
    }
  } catch (error) {
    console.error("Error handling payment_method.attached:", error)
  }
}

/**
 * Handle payment_method.detached event
 * @param {Object} paymentMethod - Stripe payment method
 */
const handlePaymentMethodDetached = async (paymentMethod) => {
  try {
    // Delete the payment method from our database
    const result = await PaymentMethod.deleteOne({
      stripePaymentMethodId: paymentMethod.id,
    })

    if (result.deletedCount > 0) {
      console.log(`Payment method ${paymentMethod.id} deleted`)
    } else {
      console.log(`Payment method ${paymentMethod.id} not found`)
    }
  } catch (error) {
    console.error("Error handling payment_method.detached:", error)
  }
}

/**
 * Handle charge.refunded event (with PlayFab integration)
 * @param {Object} charge - Stripe charge
 */
const handleChargeRefunded = async (charge) => {
  try {
    // Find the payment in our database
    const payment = await Payment.findOne({
      stripePaymentIntentId: charge.payment_intent,
    })

    if (!payment) {
      console.log(`Payment not found for intent: ${charge.payment_intent}`)
      return
    }

    // Get user information
    const user = await User.findById(payment.userId)
    if (!user) {
      console.log(`User not found for payment: ${payment._id}`)
      return
    }

    // Update payment status
    payment.status = "refunded"
    payment.metadata.set("refundId", charge.refunds.data[0]?.id)
    payment.metadata.set("refundReason", charge.refunds.data[0]?.reason)

    await payment.save()

    // Update user's wallet balance (subtract the refunded amount)
    const previousBalance = user.walletBalance || 0
    const refundAmount = payment.amount
    user.walletBalance = Math.max(0, previousBalance - refundAmount) // Ensure balance doesn't go negative
    await user.save()

    // Update PlayFab wallet (subtract the refunded amount)
    try {
      await playfabService.getOrCreatePlayer(payment.userId.toString(), user.email, user.username)
      await playfabService.subtractFromWallet(
        payment.userId.toString(),
        refundAmount,
        "Stripe Webhook - Charge Refunded",
      )
      console.log(`PlayFab wallet updated for user ${payment.userId}: -${refundAmount}`)
    } catch (playfabError) {
      console.error("PlayFab wallet update error in refund webhook:", playfabError.message)
    }

    // Emit wallet update event if socket.io is available
    try {
      const io = require("../../controller/socket/socket-manager").io
      if (io) {
        io.emit("wallet_update", {
          userId: payment.userId.toString(),
          newBalance: user.walletBalance,
          previousBalance: previousBalance,
          change: -refundAmount,
          source: "webhook_charge_refunded",
        })
      }
    } catch (error) {
      console.log("Socket.io not available for wallet update notification")
    }

    console.log(`Payment ${payment._id} marked as refunded and wallet updated`)
  } catch (error) {
    console.error("Error handling charge.refunded:", error)
  }
}

module.exports = {
  handleWebhook,
}
