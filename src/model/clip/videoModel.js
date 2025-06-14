const mongoose = require("mongoose")

const videoSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    videoUrl: {
      type: String,
      required: [true, "Video URL is required"],
    },
    videoKey: {
      type: String,
      required: true, // S3 key for deletion
    },
    thumbnailUrl: {
      type: String,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Make sure this matches your User model name
      required: [true, "User ID is required"],
      index: true,
    },
    username: {
      type: String,
      required: [true, "Username is required"],
      index: true,
    },
    duration: {
      type: Number,
      default: 0,
      min: [0, "Duration cannot be negative"],
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    views: {
      type: Number,
      default: 0,
      min: [0, "Views cannot be negative"],
      index: true,
    },
    uniqueViews: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        ip: String,
        viewedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    likes: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    comments: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        username: {
          type: String,
          required: true,
        },
        text: {
          type: String,
          required: true,
          maxlength: [500, "Comment cannot exceed 500 characters"],
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        isEdited: {
          type: Boolean,
          default: false,
        },
      },
    ],
    shares: {
      type: Number,
      default: 0,
      min: [0, "Shares cannot be negative"],
    },
    downloads: {
      type: Number,
      default: 0,
      min: [0, "Downloads cannot be negative"],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isProcessing: {
      type: Boolean,
      default: false,
    },
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: [50, "Tag cannot exceed 50 characters"],
      },
    ],
    metadata: {
      resolution: String,
      codec: String,
      bitrate: Number,
      fps: Number,
    },
    analytics: {
      avgWatchTime: {
        type: Number,
        default: 0,
      },
      completionRate: {
        type: Number,
        default: 0,
      },
      engagementRate: {
        type: Number,
        default: 0,
      },
          ogMetadata: {
      title: {
        type: String,
        trim: true,
      },
      description: {
        type: String,
        trim: true,
      },
      imageUrl: {
        type: String,
      },
      lastGenerated: {
        type: Date,
        default: Date.now,
      },
    },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

module.exports = mongoose.model("Video", videoSchema)
