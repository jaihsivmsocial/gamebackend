const mongoose = require("mongoose")

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      default: "usd",
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      enum: ["credit", "debit", "paypal", "crypto", "balance","wallet_hybrid"],
      required: true,
    },
    stripePaymentIntentId: {
      type: String,
      sparse: true,
    },
    stripeCustomerId: {
      type: String,
      sparse: true,
    },
    cardDetails: {
      last4: String,
      brand: String,
      expMonth: Number,
      expYear: Number,
    },
    metadata: {
     type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    receiptUrl: String,
  },
  {
    timestamps: true,
  },
)

// Index for faster queries
paymentSchema.index({ userId: 1, status: 1 })
paymentSchema.index({ stripePaymentIntentId: 1 }, { sparse: true })

const Payment = mongoose.model("Payment", paymentSchema)

module.exports = Payment
