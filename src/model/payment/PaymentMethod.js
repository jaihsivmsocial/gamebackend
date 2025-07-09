const mongoose = require("mongoose")

const paymentMethodSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    stripePaymentMethodId: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["card", "paypal", "wallet"],
      required: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    details: {
      brand: String,
      last4: String,
      expMonth: Number,
      expYear: Number,
    },
    billingDetails: {
      name: String,
      email: String,
      phone: String,
      address: {
        line1: String,
        line2: String,
        city: String,
        state: String,
        postal_code: String,
        country: String,
      },
    },
  },
  {
    timestamps: true,
  },
)

// Index for faster queries
paymentMethodSchema.index({ userId: 1 })
paymentMethodSchema.index({ stripePaymentMethodId: 1 }, { unique: true })

const PaymentMethod = mongoose.model("PaymentMethod", paymentMethodSchema)

module.exports = PaymentMethod
