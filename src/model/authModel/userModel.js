const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      // required: [true, "Username is required"],
      unique: true,
      trim: true,
      minlength: [3, "Username must be at least 3 characters"],
    },
    email: {
      type: String,
      // required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      // required: [true, "Password is required"],
      minlength: [4, "Password must be at least 6 characters"],
    },
    profilePicture: {
      type: String,
      default: "default-avatar.png",
    },
    location: {
      type: String,
      trim: true,
    },
    isStreaming: {
      type: Boolean,
      default: false,
    },
    DisplayName: {
      type: String,
    },
    otp: {
      type: String,
      required: false,
    },
    newpasword: {
      type: String,
      required: false,
    },
    streamKey: {
      type: String,
      unique: true,
      sparse: true,
    },
    // FIXED: Removed duplicate playfabId
    playfabId: {
      type: String,
      sparse: true, // Allow null values but ensure uniqueness when present
    },
    playfabEntityId: {
      type: String,
      sparse: true, // This is the Entity ID required for InventoryV2
    },
    playfabEntityToken: {
      type: String, // Store the actual EntityToken
    },
    playfabEntityTokenExpiration: {
      type: Date, // When the EntityToken expires
    },
    // FIXED: Removed duplicate playfabSessionTicket
    playfabSessionTicket: {
      type: String,
      sparse: true,
    },
    playfabLastLogin: {
      type: Date,
      sparse: true,
    },
    walletBalance: {
      type: Number,
      default: 10,
    },
    totalBets: {
      type: Number,
      default: 0,
    },
    totalWins: {
      type: Number,
      default: 0,
    },
    biggestWin: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    isTemporary: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Password reset fields
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    
    // OTP verification fields
    isOtpVerified: {
      type: Boolean,
      default: false,
    },
    
    // Signup/General OTP fields
    resetOtp: String,
    resetOtpExpires: Date,
  },
  { timestamps: true }
);

// FIXED: Updated TTL index to handle both password reset and signup OTP expiration
UserSchema.index(
  {
    isTemporary: 1,
    resetPasswordExpires: 1,
  },
  {
    expireAfterSeconds: 3600, // Delete temp records after 1 hour
    partialFilterExpression: {
      isTemporary: true,
      resetPasswordExpires: { $exists: true }
    }
  }
);

// Additional TTL index for signup OTP expiration
UserSchema.index(
  {
    isTemporary: 1,
    resetOtpExpires: 1,
  },
  {
    expireAfterSeconds: 3600, // Delete temp records after 1 hour
    partialFilterExpression: {
      isTemporary: true,
      resetOtpExpires: { $exists: true }
    }
  }
);

module.exports = mongoose.model("User", UserSchema);