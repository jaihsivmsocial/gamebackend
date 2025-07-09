// src/middleware/authMiddleware.js
const jwt = require("jsonwebtoken")
const User = require("../model/authModel/userModel")

// Middleware to authenticate user
const authenticate = async (req, res, next) => {
  try {
    // Check for token in multiple places
    let token
    // 1. Check Authorization header (Bearer token)
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1]
    }
    // 2. Check cookies as fallback
    else if (req.cookies && req.cookies.authData) {
      try {
        const cookieData = JSON.parse(req.cookies.authData)
        token = cookieData.token
      } catch (e) {
        console.error("Error parsing cookie:", e)
      }
    }
    // 3. NEW: Check for token in query parameter (e.g., /purchase?token=YOUR_JWT)
    else if (req.query.token) { // <--- THIS IS THE ADDED LOGIC
      token = req.query.token // <--- THIS IS THE ADDED LOGIC
    } // <--- THIS IS THE ADDED LOGIC

    if (!token) {
      console.log("No authentication token found")
      return res.status(401).json({ message: "Authentication required" })
    }

    // Add debugging for token verification
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret_for_development")
      const user = await User.findById(decoded.id).select("-password")
      if (!user) {
        console.log("User not found for ID:", decoded.id)
        return res.status(404).json({ message: "User not found" })
      }
      // Important: Store the actual MongoDB ObjectId as a string
      req.user = {
        id: user._id.toString(), // Convert ObjectId to string
        username: user.username,
      }
      next()
    } catch (jwtError) {
      console.error("Token verification failed:", jwtError.message)
      return res.status(401).json({ message: "Invalid or expired token" })
    }
  } catch (error) {
    console.error("Authentication error:", error)
    res.status(401).json({ message: "Authentication failed" })
  }
}

module.exports = authenticate