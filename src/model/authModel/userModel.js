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
   DisplayName:{
    type:String,
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
    playfabId: {
      type: String,
      sparse: true,
    },
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
    playfabSessionTicket: {
      type: String,
    },
    playfabLastLogin: {
      type: Date,
    },
    biggestWin: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    // Add these fields for password reset
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    isOtpVerified: Boolean,

    // Keep these if you're using them elsewhere
    resetOtp: String,
    resetOtpExpires: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
