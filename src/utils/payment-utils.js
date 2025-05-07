require('dotenv').config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)
const User = require("../model/userModel")
const PaymentMethod = require("../model/payment/PaymentMethod")
/**
 * Stripe service to handle all Stripe-related operations
 */
class StripeService {
  /**
   * Get or create a Stripe customer for a user
   * @param {string} userId - MongoDB user ID
   * @returns {Promise<string>} - Stripe customer ID
   */
  async getOrCreateCustomer(userId) {
    try {
      const user = await User.findById(userId)

      if (!user) {
        throw new Error("User not found")
      }

      // If user already has a Stripe customer ID, return it
      if (user.stripeCustomerId) {
        // Verify the customer exists in Stripe
        try {
          await stripe.customers.retrieve(user.stripeCustomerId)
          return user.stripeCustomerId
        } catch (stripeError) {
          console.log(`Customer ${user.stripeCustomerId} not found in Stripe, creating new one`)
          // If customer doesn't exist in Stripe, create a new one
        }
      }

      // Create a new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.username,
        metadata: {
          userId: userId.toString(), // Make sure userId is converted to string
        },
      })

      // Update user with Stripe customer ID
      await User.findByIdAndUpdate(userId, {
        stripeCustomerId: customer.id,
      })

      return customer.id
    } catch (error) {
      console.error("Error in getOrCreateCustomer:", error)
      throw error
    }
  }

  /**
   * Create a payment intent
   * @param {Object} params - Payment intent parameters
   * @returns {Promise<Object>} - Stripe payment intent
   */
  async createPaymentIntent(params) {
    try {
      console.log("Creating Stripe payment intent with params:", JSON.stringify(params, null, 2))

      // Check if Stripe is properly initialized
      if (!stripe) {
        console.error("Stripe is not initialized")
        throw new Error("Stripe is not initialized")
      }

      // Check if required parameters are present
      if (!params.amount || !params.currency) {
        console.error("Missing required parameters for payment intent")
        throw new Error("Missing required parameters: amount and currency are required")
      }

      // Ensure customer is included
      if (!params.customer) {
        console.error("Customer ID is required for payment intent")
        throw new Error("Customer ID is required")
      }

      const paymentIntent = await stripe.paymentIntents.create(params)
      console.log("Stripe payment intent created successfully:", paymentIntent.id)
      return paymentIntent
    } catch (error) {
      console.error("Error creating payment intent in Stripe:", error)
      throw error
    }
  }

  /**
   * Create a setup intent for saving cards
   * @param {string} customerId - Stripe customer ID
   * @returns {Promise<Object>} - Stripe setup intent
   */
  async createSetupIntent(customerId) {
    try {
      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        usage: "off_session",
      })
      return setupIntent
    } catch (error) {
      console.error("Error creating setup intent:", error)
      throw error
    }
  }

  /**
   * Save a payment method to a customer
   * @param {string} paymentMethodId - Stripe payment method ID
   * @param {string} customerId - Stripe customer ID
   * @returns {Promise<Object>} - Stripe payment method
   */
  async attachPaymentMethod(paymentMethodId, customerId) {
    try {
      console.log(`Attaching payment method ${paymentMethodId} to customer ${customerId}`)

      // First check if the payment method exists
      let paymentMethod
      try {
        paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
        console.log(`Payment method ${paymentMethodId} retrieved:`, paymentMethod.id)
      } catch (retrieveError) {
        console.error(`Error retrieving payment method ${paymentMethodId}:`, retrieveError)
        throw new Error(`Payment method not found: ${retrieveError.message}`)
      }

      // Check if payment method is already attached to this customer
      if (paymentMethod.customer === customerId) {
        console.log(`Payment method ${paymentMethodId} is already attached to customer ${customerId}`)
        return paymentMethod
      }

      // If attached to a different customer, detach it first
      if (paymentMethod.customer) {
        console.log(
          `Payment method ${paymentMethodId} is attached to customer ${paymentMethod.customer}, detaching first`,
        )
        try {
          await stripe.paymentMethods.detach(paymentMethodId)
          console.log(`Payment method ${paymentMethodId} detached successfully`)
        } catch (detachError) {
          console.error(`Error detaching payment method ${paymentMethodId}:`, detachError)
          throw new Error(`Could not detach payment method: ${detachError.message}`)
        }
      }

      // Now attach the payment method to the customer
      try {
        paymentMethod = await stripe.paymentMethods.attach(paymentMethodId, {
          customer: customerId,
        })
        console.log(`Payment method ${paymentMethodId} attached to customer ${customerId}`)
      } catch (attachError) {
        console.error(`Error attaching payment method ${paymentMethodId} to customer ${customerId}:`, attachError)

        // If it's already attached, this is fine
        if (attachError.message.includes("already been attached")) {
          console.log(`Payment method ${paymentMethodId} is already attached to a customer`)
          // Try to retrieve it again
          paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
        } else {
          throw new Error(`Could not attach payment method: ${attachError.message}`)
        }
      }

      return paymentMethod
    } catch (error) {
      console.error("Error in attachPaymentMethod:", error)
      throw error
    }
  }

  /**
   * Get all payment methods for a customer
   * @param {string} customerId - Stripe customer ID
   * @param {string} type - Payment method type (card, paypal, etc.)
   * @returns {Promise<Array>} - Array of payment methods
   */
  async listPaymentMethods(customerId, type = "card") {
    try {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: type,
      })
      return paymentMethods.data
    } catch (error) {
      console.error("Error listing payment methods:", error)
      throw error
    }
  }

  /**
   * Delete a payment method
   * @param {string} paymentMethodId - Stripe payment method ID
   * @returns {Promise<Object>} - Deleted payment method
   */
  async detachPaymentMethod(paymentMethodId) {
    try {
      const paymentMethod = await stripe.paymentMethods.detach(paymentMethodId)
      return paymentMethod
    } catch (error) {
      console.error("Error detaching payment method:", error)
      throw error
    }
  }

  /**
   * Confirm a payment intent
   * @param {string} paymentIntentId - Stripe payment intent ID
   * @param {Object} params - Confirmation parameters
   * @returns {Promise<Object>} - Confirmed payment intent
   */
  async confirmPaymentIntent(paymentIntentId, params) {
    try {
      const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, params)
      return paymentIntent
    } catch (error) {
      console.error("Error confirming payment intent:", error)
      throw error
    }
  }

  /**
   * Retrieve a payment intent
   * @param {string} paymentIntentId - Stripe payment intent ID
   * @returns {Promise<Object>} - Payment intent
   */
  async retrievePaymentIntent(paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
      return paymentIntent
    } catch (error) {
      console.error("Error retrieving payment intent:", error)
      throw error
    }
  }

  /**
   * Create a refund
   * @param {string} paymentIntentId - Stripe payment intent ID
   * @param {Object} params - Refund parameters
   * @returns {Promise<Object>} - Refund
   */
  async createRefund(paymentIntentId, params = {}) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        ...params,
      })
      return refund
    } catch (error) {
      console.error("Error creating refund:", error)
      throw error
    }
  }

  /**
   * Construct Stripe webhook event
   * @param {string} payload - Request body
   * @param {string} signature - Stripe signature
   * @returns {Promise<Object>} - Stripe event
   */
  constructEvent(payload, signature) {
    try {
      return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET)
    } catch (error) {
      console.error("Error constructing webhook event:", error)
      throw error
    }
  }
}

module.exports = new StripeService()