const mongoose = require("mongoose")

const streamSchema = new mongoose.Schema(
  {
    streamId: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    thumbnailUrl: {
      type: String,
    },
    broadcaster: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    startTime: {
      type: Date,
      default: Date.now,
    },
    endTime: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["created", "ready", "active", "ended"],
      default: "created",
    },
    settings: {
      isPrivate: {
        type: Boolean,
        default: false,
      },
      allowChat: {
        type: Boolean,
        default: true,
      },
      allowAnonymousViewers: {
        type: Boolean,
        default: true,
      },
    },
    metrics: {
      peakViewers: {
        type: Number,
        default: 0,
      },
      totalViewers: {
        type: Number,
        default: 0,
      },
      totalMessages: {
        type: Number,
        default: 0,
      },
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    timestamps: true,
  },
)

// Index for faster queries
streamSchema.index({ status: 1, startTime: -1 })
streamSchema.index({ broadcaster: 1, status: 1 })
streamSchema.index({ streamId: 1 }) // Index on the metaField

module.exports = mongoose.model("Stream", streamSchema)

