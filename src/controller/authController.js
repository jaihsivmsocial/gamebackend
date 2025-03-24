const { body, validationResult } = require("express-validator");
const User = require("../model/userModel");
const bcrypt = require("bcrypt");  // Use bcrypt properly
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if user already exists (by username or email)
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Hash the password before saving
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user with hashed password
    const user = new User({
      username,
      email,
      password: hashedPassword, // Store hashed password
    });

    await user.save();

    // Generate JWT token
    // const token = jwt.sign(
    //   { id: user._id, username: user.username },
    //   process.env.JWT_SECRET,
    //   { expiresIn: "7d" }
    // );

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        profilePicture: user.profilePicture,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate request body
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    // Check if JWT_SECRET is set
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: "JWT_SECRET is missing in environment variables" });
    }

    // Convert username to lowercase for case-insensitive login
    const user = await User.findOne({ username: username.toLowerCase() });

    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Ensure user.password exists
    if (!user.password) {
      return res.status(500).json({ error: "User password not set in database" });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    const cookieData = {
      token: token,
      username: user.username,
    };

    res.cookie("authData", JSON.stringify(cookieData), {
      httpOnly: true,
      secure: false, // false for localhost
      sameSite: "Lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({ token, username: user.username });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};


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

// Verify email
exports. verifyEmail = async (req, res) => {
  try {
    const { token } = req.params

    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: Date.now() },
    })

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired verification token" })
    }

    user.isVerified = true
    user.verificationToken = undefined
    user.verificationTokenExpires = undefined

    await user.save()

    res.status(200).json({ message: "Email verified successfully. You can now log in." })
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message })
  }
}

exports . getprofile= async(req,res)=>{
  try {
    const user = await User.findById(req.user.id).select("-password")
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    res.status(200).json({ user })
  } catch (error) {
    console.error("Get profile error:", error)
    res.status(500).json({ message: "Server error" })
  }
}

// Request password reset
exports. forgotPassword = async (req, res) => {
  try {
    const { email } = req.body

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex")
    user.resetPasswordToken = resetToken
    user.resetPasswordExpires = Date.now() + 3600000 // 1 hour

    await user.save()

    // Send password reset email
    await sendPasswordResetEmail(user.email, resetToken)

    res.status(200).json({ message: "Password reset email sent" })
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message })
  }
}

// Reset password
exports. resetPassword = async (req, res) => {
  try {
    const { token } = req.params
    const { password } = req.body

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    })

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset token" })
    }

    user.password = password
    user.resetPasswordToken = undefined
    user.resetPasswordExpires = undefined

    await user.save()

    res.status(200).json({ message: "Password reset successful" })
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message })
  }
}

