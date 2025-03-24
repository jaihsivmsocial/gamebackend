// Validation middleware
exports. validateRegister = (req, res, next) => {
  const { username, email, password } = req.body

  // Validate username
  if (!username || username.length < 3) {
    return res.status(400).json({ message: "Username must be at least 3 characters" })
  }

  // Validate email
  const emailRegex = /^\S+@\S+\.\S+$/
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ message: "Please provide a valid email" })
  }

  // Validate password
  if (!password || password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" })
  }

  next()
}

exports. validateLogin = (req, res, next) => {
  const { username, password } = req.body

  if (!username) {
    return res.status(400).json({ message: "Username is required" })
  }

  if (!password) {
    return res.status(400).json({ message: "Password is required" })
  }

  next()
}

