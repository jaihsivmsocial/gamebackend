const mongoose = require("mongoose")

const qualitySettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    streamId: {
      type: String,
      required: true,
      index: true,
    },
    quality: {
      type: String,
      enum: ["auto", "240p", "360p", "720p", "1080p"],
      default: "auto",
    },
    frameRate: {
      type: String,
      enum: ["30", "60"],
      default: "60",
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
)

// Compound index for faster lookups
qualitySettingsSchema.index({ userId: 1, streamId: 1 }, { unique: true })

const QualitySettings = mongoose.model("QualitySettings", qualitySettingsSchema)

module.exports = QualitySettings

