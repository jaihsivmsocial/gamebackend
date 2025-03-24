const  jwt = require( "jsonwebtoken")
const  User= require( "../model/userModel")

exports. optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1]

    if (!token) {
      // No token, proceed as anonymous
      req.isAnonymous = true
      next()
      return
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      const user = await User.findById(decoded.id).select("-password")

      if (!user) {
        // User not found, proceed as anonymous
        req.isAnonymous = true
        next()
        return
      }

      // User authenticated
      req.user = {
        id: user._id,
        username: user.username,
      }
      req.isAnonymous = false
      next()
    } catch (error) {
      // Invalid token, proceed as anonymous
      req.isAnonymous = true
      next()
    }
  } catch (error) {
    console.error("Authentication error:", error)
    req.isAnonymous = true
    next()
  }
}

