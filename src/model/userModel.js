const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, "Username is required"],
    unique: true,
    trim: true,
    minlength: [3, "Username must be at least 3 characters"],
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
  },
  password: {
    type: String,
    required: [true, "Password is required"],
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
  streamKey: {
    type: String,
    unique: true,
    sparse: true,
  },
},
{ timestamps: true },
);



module.exports = mongoose.model("User", UserSchema);
