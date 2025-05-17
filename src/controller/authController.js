const { body, validationResult } = require("express-validator");
const User = require("../model/userModel");
const bcrypt = require("bcrypt");  // Use bcrypt properly
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const {sendOtpEmail}= require('../utils/email')


exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body

    // Standardize username to lowercase for consistent storage and lookup
    const standardizedUsername = username.toLowerCase()

    // Check if user already exists (by username or email)
    const existingUser = await User.findOne({
      $or: [{ email }, { username: standardizedUsername }],
    })

    if (existingUser) {
      return res.status(400).json({ message: "User already exists" })
    }

    // Hash the password before saving
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)

    // Create new user with standardized username and hashed password
    const user = new User({
      username: standardizedUsername, // Store lowercase username for consistent lookup
      email,
      password: hashedPassword,
      displayName: username, // Optionally store original case as displayName for display purposes
    })

    await user.save()

    // Generate JWT token for immediate login if desired
    const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "7d" })

    res.status(201).json({
      message: "User registered successfully",
      token, // Include token in response
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        profilePicture: user.profilePicture,
      },
    })
  } catch (error) {
    console.error("Registration error:", error)
    res.status(500).json({ message: "Server error" })
  }
}

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body

    // Validate request body
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" })
    }

    // Check if JWT_SECRET is set
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: "JWT_SECRET is missing in environment variables" })
    }

    // Convert username to lowercase for case-insensitive login
    // This matches how we store usernames in the register function
    const user = await User.findOne({ username: username.toLowerCase() })

    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" })
    }

    // Ensure user.password exists
    if (!user.password) {
      return res.status(500).json({ error: "User password not set in database" })
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" })
    }

    // Generate token with consistent payload structure
    const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, {
      expiresIn: "24h", // Longer expiration for better user experience
    })

    // Set both cookie and return token in response for maximum compatibility
    const cookieData = {
      token: token,
      username: user.username,
    }

    // Set HTTP-only cookie for secure browser storage
    res.cookie("authData", JSON.stringify(cookieData), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // Only secure in production
      sameSite: "Lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    })

    // Return token in response body for non-browser clients and localStorage storage
    res.json({
      token,
      username: user.username,
      walletBalance: user.walletBalance || 0,
      profilePicture: user.profilePicture || null,
    })
  } catch (error) {
    console.error("Login Error:", error)
    res.status(500).json({ error: "Internal server error" })
  }
}

// Add a verification endpoint for checking authentication status
exports.verifyAuth = async (req, res) => {
  try {
    // Get token from Authorization header or cookie
    const authHeader = req.headers.authorization
    const authCookie = req.cookies?.authData

    let token

    if (authHeader && authHeader.startsWith("Bearer ")) {
      // Extract token from Authorization header
      token = authHeader.substring(7)
    } else if (authCookie) {
      // Extract token from cookie
      const cookieData = JSON.parse(authCookie)
      token = cookieData.token
    }

    if (!token) {
      return res.status(401).json({ authenticated: false, message: "No authentication token provided" })
    }

    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Find the user
    const user = await User.findById(decoded.id)

    if (!user) {
      return res.status(401).json({ authenticated: false, message: "User not found" })
    }

    // User is authenticated
    return res.status(200).json({
      authenticated: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        walletBalance: user.walletBalance || 0,
        profilePicture: user.profilePicture || null,
      },
    })
  } catch (error) {
    console.error("Auth verification error:", error)
    return res.status(401).json({ authenticated: false, message: "Invalid or expired token" })
  }
}

// Add a logout endpoint
exports.logout = async (req, res) => {
  try {
    // Clear the auth cookie
    res.clearCookie("authData")

    return res.status(200).json({ success: true, message: "Logged out successfully" })
  } catch (error) {
    console.error("Logout error:", error)
    return res.status(500).json({ success: false, message: "Error during logout" })
  }
}


exports.updateProfile = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized: User ID is missing" });
    }

    const { location, profilePicture } = req.body;
    const userId = req.user.id;

    // Build update object dynamically
    const updateData = {};
    if (location !== undefined) updateData.location = location;
    if (profilePicture !== undefined) updateData.profilePicture = profilePicture;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true } // Ensures new data follows schema validation
    ).select("-password -verificationToken -verificationTokenExpires -resetPasswordToken -resetPasswordExpires");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};




// Check if username is available
exports. checkUsername = async (req, res) => {
  try {
    const { username } = req.params

    const user = await User.findOne({ username })

    if (user) {
      return res.status(400).json({ message: "Username taken" })
    }

    res.status(200).json({ message: "Username available" })
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message })
  }
}







exports. forgotPassword = async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ message: "Email is required" })
    }

    const user = await User.findOne({
      email: { $regex: new RegExp("^" + email + "$", "i") },
    })

    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()

    // Hash the OTP before storing it
    const salt = await bcrypt.genSalt(10)
    const hashedOtp = await bcrypt.hash(otp, salt)

    // Set OTP and expiration (15 minutes)
    user.resetPasswordToken = hashedOtp
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000 // 15 minutes
    await user.save()

    await sendOtpEmail(user.email, otp, user.username)

    res.status(200).json({
      message: "OTP sent to your email",
      // Only include OTP in development environment for testing
      testOtp: process.env.NODE_ENV === "development" ? otp : undefined,
    })
  } catch (error) {
    console.error("Forgot password error:", error)
    res.status(500).json({ message: "Server error", error: error.message })
  }
}


exports. requestOtpReset = async (req, res) => {
  try {
    const { email } = req.body
    console.log("OTP reset request for email:", email)

    if (!email) {
      return res.status(400).json({ message: "Email is required" })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email format" })
    }

    // Find user in the database (case-insensitive search)
    const user = await User.findOne({
      email: { $regex: new RegExp("^" + email + "$", "i") },
    })

    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    // Check if current OTP is still valid
    const isOtpValid = user.resetPasswordExpires && user.resetPasswordExpires > Date.now()

    // If OTP is still valid and not in development mode, don't generate a new one
    if (isOtpValid && process.env.NODE_ENV !== "development") {
      return res.status(200).json({
        message: "A valid OTP has already been sent to your email. Please check your inbox or spam folder.",
      })
    }

    // Generate a new 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()

    // Hash the OTP before storing it
    const salt = await bcrypt.genSalt(10)
    const hashedOtp = await bcrypt.hash(otp, salt)

    // Set OTP and expiration (15 minutes)
    user.resetPasswordToken = hashedOtp
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000 // 15 minutes
    await user.save()

    // Send OTP via email
    await sendOtpEmail(email, otp, user.username)

    res.status(200).json({
      message: "New OTP sent to your email",
      // Only include OTP in development environment for testing
      testOtp: process.env.NODE_ENV === "development" ? otp : undefined,
    })
  } catch (error) {
    console.error("OTP request error:", error)
    res.status(500).json({ message: "Server error", error: error.message })
  }
}

exports.verifyOtpAndResetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body

    console.log("Verifying OTP for:", email)
    console.log("OTP received:", otp)
    console.log("New password length:", newPassword?.length)

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        message: "Email, OTP, and new password are required",
      })
    }

    // Find user with valid reset token - use case-insensitive search
    const user = await User.findOne({
      email: { $regex: new RegExp("^" + email + "$", "i") },
    })

    if (!user) {
      console.log("User not found for email:", email)
      return res.status(404).json({ message: "User not found" })
    }

    // Check if OTP is expired
    if (!user.resetPasswordExpires || user.resetPasswordExpires < Date.now()) {
      console.log("OTP expired. Expiry time:", user.resetPasswordExpires, "Current time:", Date.now())
      return res.status(400).json({
        message: "OTP has expired. Please request a new OTP.",
      })
    }

    console.log("Stored hashed OTP:", user.resetPasswordToken)

    // Verify OTP
    const isValidOtp = await bcrypt.compare(otp, user.resetPasswordToken)
    console.log("OTP validation result:", isValidOtp)

    if (!isValidOtp) {
      return res.status(400).json({ message: "Invalid OTP" })
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      })
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(newPassword, salt)

    // Update user password
    user.password = hashedPassword
    user.resetPasswordToken = undefined
    user.resetPasswordExpires = undefined
    await user.save()

    res.status(200).json({ message: "Password reset successful" })
  } catch (error) {
    console.error("OTP verification error:", error)
    res.status(500).json({ message: "Server error", error: error.message })
  }
}