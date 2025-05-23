const { body, validationResult } = require("express-validator");
const User = require("../model/userModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { sendOtpEmail } = require('../utils/email');
const axios = require('axios'); 
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
require('dotenv').config();

// PlayFab configuration
const PLAYFAB_TITLE_ID = process.env.PLAYFAB_TITLE_ID;
const PLAYFAB_SECRET_KEY = process.env.PLAYFAB_SECRET_KEY;
const PLAYFAB_API_URL = `https://${PLAYFAB_TITLE_ID}.playfabapi.com`;

// Enhanced PlayFab request function with better error handling and logging
async function playfabRequest(endpoint, data, headers = {}) {
  try {
    console.log(`Making PlayFab request to: ${PLAYFAB_API_URL}${endpoint}`);
    console.log('Request data:', JSON.stringify(data, null, 2));
    
    // Determine which headers to use based on the endpoint
    let requestHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    
    // Add X-SecretKey for admin/server endpoints
    if (endpoint.startsWith('/Admin') || endpoint.startsWith('/Server')) {
      requestHeaders['X-SecretKey'] = PLAYFAB_SECRET_KEY;
    }
    
    // Make the API request
    const response = await axios.post(`${PLAYFAB_API_URL}${endpoint}`, data, {
      headers: requestHeaders
    });
    
    console.log(`PlayFab response from ${endpoint}:`, JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error(`PlayFab API Error (${endpoint}):`, error.response?.data || error.message);
    throw error;
  }
}

exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Standardize username to lowercase for consistent storage and lookup
    const standardizedUsername = username.toLowerCase();

    // Check if user already exists (by username or email)
    const existingUser = await User.findOne({
      $or: [{ email }, { username: standardizedUsername }],
    });

    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Hash the password before saving
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 1. Register user with PlayFab
    try {
      const playfabResponse = await playfabRequest('/Client/RegisterPlayFabUser', {
        TitleId: PLAYFAB_TITLE_ID,
        Username: standardizedUsername,
        Email: email,
        Password: password, // PlayFab will handle password security
        RequireBothUsernameAndEmail: true
      });
      
      // 2. Create new user in MongoDB with PlayFab ID
      const user = new User({
        username: standardizedUsername,
        email,
        password: hashedPassword,
        displayName: username,
        playfabId: playfabResponse.data.PlayFabId,
        playfabSessionTicket: playfabResponse.data.SessionTicket,
        playfabLastLogin: new Date()
      });

      await user.save();

      // Generate JWT token for immediate login
      const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "7d" });

      // Return the complete response including the full PlayFab response
      res.status(201).json({
        code: playfabResponse.code,
        status: playfabResponse.status,
        data: playfabResponse.data,
        message: "User registered successfully",
        token,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          profilePicture: user.profilePicture,
          playfabId: user.playfabId
        }
      });
    } catch (playfabError) {
      // If PlayFab registration fails, return error
      console.error("PlayFab registration error:", playfabError);
      return res.status(400).json({ 
        message: "Registration failed", 
        error: playfabError.response?.data?.errorMessage || "PlayFab registration error" 
      });
    }
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
    const standardizedUsername = username.toLowerCase();
    const user = await User.findOne({ username: standardizedUsername });

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

    // Login with PlayFab
    try {
      const playfabResponse = await playfabRequest('/Client/LoginWithPlayFab', {
        TitleId: PLAYFAB_TITLE_ID,
        Username: standardizedUsername,
        Password: password
      });

      // Update PlayFab session information in MongoDB
      user.playfabSessionTicket = playfabResponse.data.SessionTicket;
      user.playfabLastLogin = new Date();
      await user.save();

      // Generate token with consistent payload structure
      const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, {
        expiresIn: "24h",
      });
      
      // Set both cookie and return token in response for maximum compatibility
      const cookieData = {
        token: token,
        username: user.username,
      };
      
      // Set HTTP-only cookie for secure browser storage
      res.cookie("authData", JSON.stringify(cookieData), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      // Return the complete PlayFab response structure
      res.json({
        code: playfabResponse.code,
        status: playfabResponse.status,
        data: playfabResponse.data,
        token,
        username: user.username,
        walletBalance: user.walletBalance || 0,
        profilePicture: user.profilePicture || null,
        playfabId: user.playfabId
      });
    } catch (playfabError) {
      console.error("PlayFab login error:", playfabError);
      
      // If PlayFab login fails but MongoDB login succeeded, we'll still log the user in
      // but we'll try to repair the PlayFab account on the next successful login
      
      const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, {
        expiresIn: "24h",
      });

      const cookieData = {
        token: token,
        username: user.username,
      };

      res.cookie("authData", JSON.stringify(cookieData), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.json({
        token,
        username: user.username,
        walletBalance: user.walletBalance || 0,
        profilePicture: user.profilePicture || null,
        playfabSyncError: "PlayFab login failed, will try to repair on next login"
      });
    }
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Add a verification endpoint for checking authentication status
exports.verifyAuth = async (req, res) => {
  try {
    // Get token from Authorization header or cookie
    const authHeader = req.headers.authorization;
    const authCookie = req.cookies?.authData;

    let token;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      // Extract token from Authorization header
      token = authHeader.substring(7);
    } else if (authCookie) {
      // Extract token from cookie
      const cookieData = JSON.parse(authCookie);
      token = cookieData.token;
    }

    if (!token) {
      return res.status(401).json({ authenticated: false, message: "No authentication token provided" });
    }

    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find the user
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ authenticated: false, message: "User not found" });
    }

    // Verify PlayFab session if available
    let playfabStatus = { active: false };
    let playfabResponse = null;
    
    if (user.playfabSessionTicket) {
      try {
        playfabResponse = await playfabRequest('/Client/GetPlayerProfile', {
          PlayFabId: user.playfabId,
          ProfileConstraints: {
            ShowDisplayName: true,
            ShowStatistics: true
          }
        });
        playfabStatus = { active: true, profile: playfabResponse.data.PlayerProfile };
      } catch (error) {
        console.log("PlayFab session verification failed:", error.message);
        // We don't fail the whole auth if PlayFab verification fails
        playfabStatus = { active: false, error: "Session expired" };
      }
    }

    // User is authenticated - include full PlayFab response if available
    const response = {
      authenticated: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        walletBalance: user.walletBalance || 0,
        profilePicture: user.profilePicture || null,
        playfabId: user.playfabId,
        playfabStatus
      }
    };
    
    // Add PlayFab response if available
    if (playfabResponse) {
      response.playfab = playfabResponse;
    }
    
    return res.status(200).json(response);
  } catch (error) {
    console.error("Auth verification error:", error);
    return res.status(401).json({ authenticated: false, message: "Invalid or expired token" });
  }
};

// Add a logout endpoint
exports.logout = async (req, res) => {
  try {
    // Get user from request (assuming middleware sets this)
    const userId = req.user?.id;
    let playfabResponse = null;
    
    if (userId) {
      const user = await User.findById(userId);
      
      // Logout from PlayFab if we have a session ticket
      if (user && user.playfabSessionTicket) {
        try {
          playfabResponse = await playfabRequest('/Client/ForgetAllCredentials', {
            SessionTicket: user.playfabSessionTicket
          });
          
          // Clear PlayFab session in our database
          user.playfabSessionTicket = null;
          await user.save();
        } catch (playfabError) {
          console.error("PlayFab logout error:", playfabError);
          // Continue with local logout even if PlayFab logout fails
        }
      }
    }
    
    // Clear the auth cookie
    res.clearCookie("authData");

    const response = { success: true, message: "Logged out successfully" };
    
    // Add PlayFab response if available
    if (playfabResponse) {
      response.playfab = playfabResponse;
    }
    
    return res.status(200).json(response);
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({ success: false, message: "Error during logout" });
  }
};


// exports.updateProfile = async (req, res) => {
//   try {
//     if (!req.user || !req.user.id) {
//       return res.status(401).json({ message: "Unauthorized: User ID is missing" });
//     }

//     const { profilePicture } = req.body;
//     const userId = req.user.id;

//     // Find the user
//     const user = await User.findById(userId);
//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     // Build update object dynamically
//     const updateData = {};
  
//     if (profilePicture !== undefined) updateData.profilePicture = profilePicture;

//     // Update user in MongoDB
//     const updatedUser = await User.findByIdAndUpdate(
//       userId,
//       updateData,
//       { new: true, runValidators: true }
//     ).select("-password -verificationToken -verificationTokenExpires -resetPasswordToken -resetPasswordExpires");

//     // Update user data in PlayFab if we have a PlayFab ID
//     let playfabResponse = null;
//     if (user.playfabId && user.playfabSessionTicket) {
//       try {
//         // Prepare PlayFab update data
//         const playfabUpdateData = {};
//         if (location !== undefined) playfabUpdateData.Location = location;
        
//         // Update PlayFab user data
//         playfabResponse = await playfabRequest('/Client/UpdateUserData', {
//           SessionTicket: user.playfabSessionTicket,
//           Data: playfabUpdateData
//         });
        
//         // If profile picture is updated, we could also update it in PlayFab
//         if (profilePicture !== undefined) {
//           // Example: Update PlayFab display name or avatar URL
//           const displayNameResponse = await playfabRequest('/Client/UpdateUserTitleDisplayName', {
//             SessionTicket: user.playfabSessionTicket,
//             DisplayName: user.username,
//             // You might store the profile picture URL in custom data
//           });
          
//           // Merge responses
//           playfabResponse = {
//             ...playfabResponse,
//             displayNameUpdate: displayNameResponse
//           };
//         }
//       } catch (playfabError) {
//         console.error("PlayFab profile update error:", playfabError);
//         // We don't fail the whole update if PlayFab update fails
//       }
//     }

//     const response = {
//       message: "Profile updated successfully",
//       user: updatedUser
//     };
    
//     // Add PlayFab response if available
//     if (playfabResponse) {
//       response.playfab = playfabResponse;
//     }
    
//     res.status(200).json(response);
//   } catch (error) {
//     console.error("Error updating profile:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };

// Check if username is available





// Configure AWS S3


AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'eu-north-1'
});

const s3 = new AWS.S3();

// Configure multer for memory storage (before S3 upload)
const storage = multer.memoryStorage();

// File filter to validate file type
const fileFilter = (req, file, cb) => {
  console.log('Received file:', file.fieldname, file.originalname, file.mimetype);
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, JPG, PNG, and WEBP are allowed.'), false);
  }
};

// Configure multer upload
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Helper function to upload to S3
const uploadToS3 = async (file) => {
  const fileExtension = path.extname(file.originalname);
  const fileName = `profile-pictures/${uuidv4()}${fileExtension}`;
  
  // IMPORTANT: NO ACL PARAMETER HERE
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype
  };
  
  const result = await s3.upload(params).promise();
  return result.Location; // Return the URL of the uploaded file
};

// Main profile update controller
exports.updateProfile = async (req, res) => {
  console.log('Update profile request received');
  console.log('Request body fields:', Object.keys(req.body));
  console.log('Request files:', req.files ? Object.keys(req.files) : 'No files');
  
  // Wrap the multer upload in a promise to handle it properly
  const handleUpload = () => {
    return new Promise((resolve, reject) => {
      upload.single('profilePicture')(req, res, (err) => {
        if (err) {
          console.error('Multer error:', err);
          if (err.code === 'LIMIT_FILE_SIZE') {
            return reject(new Error('File size exceeds the 5MB limit'));
          }
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return reject(new Error(`Unexpected field. Please use 'profilePicture' as the field name for your file upload.`));
          }
          return reject(err);
        }
        console.log('File upload processed successfully');
        if (req.file) {
          console.log('File details:', {
            fieldname: req.file.fieldname,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
          });
        } else {
          console.log('No file was uploaded');
        }
        resolve();
      });
    });
  };

  try {
    // Handle file upload first
    await handleUpload();

    // Validate user authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized: User ID is missing" });
    }

    const userId = req.user.id;

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Build update object
    const updateData = {};
    
    // Handle profile picture upload if a file was provided
    if (req.file) {
      try {
        const profilePictureUrl = await uploadToS3(req.file);
        updateData.profilePicture = profilePictureUrl;
        console.log('Image uploaded to S3:', profilePictureUrl);
      } catch (uploadError) {
        console.error('S3 upload error:', uploadError);
        return res.status(400).json({ 
          message: "Error uploading profile picture", 
          error: uploadError.message 
        });
      }
    } else if (req.body.profilePicture) {
      // If a URL was provided directly (e.g., from a previous upload)
      updateData.profilePicture = req.body.profilePicture;
      console.log('Using provided profile picture URL:', updateData.profilePicture);
    }

    // If no update data, return early
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No update data provided" });
    }

    // Update user in MongoDB
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select("-password -verificationToken -verificationTokenExpires -resetPasswordToken -resetPasswordExpires");

    console.log('User updated in MongoDB');

    // Update user data in PlayFab if we have a PlayFab ID
    let playfabResponse = null;
    if (user.playfabId && user.playfabSessionTicket && updateData.profilePicture) {
      try {
        console.log('Updating PlayFab profile with new image URL');
        
        // Update PlayFab with the new profile picture URL in user data
        const userDataResponse = await playfabRequest('/Client/UpdateUserData', {
          SessionTicket: user.playfabSessionTicket,
          Data: {
            ProfilePictureUrl: updateData.profilePicture
          }
        });
        
        // Update PlayFab avatar URL
        const avatarResponse = await playfabRequest('/Client/UpdateAvatarUrl', {
          SessionTicket: user.playfabSessionTicket,
          ImageUrl: updateData.profilePicture
        });
        
        // Update display name if needed
        const displayNameResponse = await playfabRequest('/Client/UpdateUserTitleDisplayName', {
          SessionTicket: user.playfabSessionTicket,
          DisplayName: user.username
        });
        
        // Update player profile with the new avatar
        const profileResponse = await playfabRequest('/Client/UpdatePlayerProfile', {
          SessionTicket: user.playfabSessionTicket,
          AvatarUrl: updateData.profilePicture,
          DisplayName: user.username
        });
        
        // Merge all responses
        playfabResponse = {
          userData: userDataResponse,
          avatar: avatarResponse,
          displayName: displayNameResponse,
          profile: profileResponse
        };
        
        console.log('PlayFab profile updated successfully');
      } catch (playfabError) {
        console.error("PlayFab profile update error:", playfabError);
        // We don't fail the whole update if PlayFab update fails
      }
    }

    const response = {
      message: "Profile updated successfully",
      user: updatedUser
    };
    
    // Add PlayFab response if available
    if (playfabResponse) {
      response.playfab = playfabResponse;
    }
    
    res.status(200).json(response);
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Function to delete profile picture from S3 (useful for cleanup)
exports.deleteProfilePicture = async (imageUrl) => {
  if (!imageUrl) return;
  
  try {
    // Extract the key from the URL
    const key = imageUrl.split('/').slice(3).join('/');
    
    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key
    };
    
    await s3.deleteObject(params).promise();
  } catch (error) {
    console.error("Error deleting image from S3:", error);
    // Handle error as needed
  }
};

exports.checkUsername = async (req, res) => {
  try {
    const { username } = req.params;

    // Check in MongoDB
    const user = await User.findOne({ username });

    if (user) {
      return res.status(400).json({ message: "Username taken" });
    }

    // Check in PlayFab
    let playfabResponse = null;
    try {
      playfabResponse = await playfabRequest('/Client/GetAccountInfo', {
        TitleId: PLAYFAB_TITLE_ID,
        Username: username
      });
      
      // If we get here, the username exists in PlayFab
      return res.status(400).json({ 
        message: "Username taken",
        playfab: playfabResponse
      });
    } catch (playfabError) {
      // If error is "AccountNotFound", username is available
      if (playfabError.response?.data?.errorCode === 1001) {
        return res.status(200).json({ 
          message: "Username available",
          playfabError: playfabError.response?.data
        });
      }
      
      // For other errors, we'll assume it's available in PlayFab
      console.error("PlayFab username check error:", playfabError);
    }

    res.status(200).json({ message: "Username available" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({
      email: { $regex: new RegExp("^" + email + "$", "i") },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash the OTP before storing it
    const salt = await bcrypt.genSalt(10);
    const hashedOtp = await bcrypt.hash(otp, salt);

    // Set OTP and expiration (15 minutes)
    user.resetPasswordToken = hashedOtp;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
    await user.save();

    await sendOtpEmail(user.email, otp, user.username);

    res.status(200).json({
      message: "OTP sent to your email",
      // Only include OTP in development environment for testing
      testOtp: process.env.NODE_ENV === "development" ? otp : undefined,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.requestOtpReset = async (req, res) => {
  try {
    const { email } = req.body;
    console.log("OTP reset request for email:", email);

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    // Find user in the database (case-insensitive search)
    const user = await User.findOne({
      email: { $regex: new RegExp("^" + email + "$", "i") },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if current OTP is still valid
    const isOtpValid = user.resetPasswordExpires && user.resetPasswordExpires > Date.now();

    // If OTP is still valid and not in development mode, don't generate a new one
    if (isOtpValid && process.env.NODE_ENV !== "development") {
      return res.status(200).json({
        message: "A valid OTP has already been sent to your email. Please check your inbox or spam folder.",
      });
    }

    // Generate a new 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash the OTP before storing it
    const salt = await bcrypt.genSalt(10);
    const hashedOtp = await bcrypt.hash(otp, salt);

    // Set OTP and expiration (15 minutes)
    user.resetPasswordToken = hashedOtp;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
    await user.save();

    // Send OTP via email
    await sendOtpEmail(email, otp, user.username);

    res.status(200).json({
      message: "New OTP sent to your email",
      // Only include OTP in development environment for testing
      testOtp: process.env.NODE_ENV === "development" ? otp : undefined,
    });
  } catch (error) {
    console.error("OTP request error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.verifyOtpAndResetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    console.log("Verifying OTP for:", email);
    console.log("OTP received:", otp);
    console.log("New password length:", newPassword?.length);

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        message: "Email, OTP, and new password are required",
      });
    }

    // Find user with valid reset token - use case-insensitive search
    const user = await User.findOne({
      email: { $regex: new RegExp("^" + email + "$", "i") },
    });

    if (!user) {
      console.log("User not found for email:", email);
      return res.status(404).json({ message: "User not found" });
    }

    // Check if OTP is expired
    if (!user.resetPasswordExpires || user.resetPasswordExpires < Date.now()) {
      console.log("OTP expired. Expiry time:", user.resetPasswordExpires, "Current time:", Date.now());
      return res.status(400).json({
        message: "OTP has expired. Please request a new OTP.",
      });
    }

    console.log("Stored hashed OTP:", user.resetPasswordToken);

    // Verify OTP
    const isValidOtp = await bcrypt.compare(otp, user.resetPasswordToken);
    console.log("OTP validation result:", isValidOtp);

    if (!isValidOtp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update user password in MongoDB
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Update password in PlayFab if user has a PlayFab account
    let playfabResponse = null;
    if (user.playfabId) {
      try {
        // Use admin API to reset the password
        playfabResponse = await playfabRequest('/Admin/ResetPassword', {
          PlayFabId: user.playfabId,
          Password: newPassword
        });
      } catch (playfabError) {
        console.error("PlayFab password reset error:", playfabError);
        // We don't fail the whole reset if PlayFab reset fails
      }
    }

    const response = { message: "Password reset successful" };
    
    // Add PlayFab response if available
    if (playfabResponse) {
      response.playfab = playfabResponse;
    }
    
    res.status(200).json(response);
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Direct PlayFab API access endpoints
// These endpoints allow direct access to PlayFab APIs through your server

exports.directPlayFabRegister = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ message: "Username, email, and password are required" });
    }
    
    const playfabResponse = await playfabRequest('/Client/RegisterPlayFabUser', {
      TitleId: PLAYFAB_TITLE_ID,
      Username: username,
      Email: email,
      Password: password,
      RequireBothUsernameAndEmail: true
    });
    
    // Return the complete PlayFab response
    res.status(200).json(playfabResponse);
  } catch (error) {
    console.error("Direct PlayFab register error:", error);
    res.status(error.response?.status || 500).json(error.response?.data || { message: "Server error" });
  }
};

exports.directPlayFabLogin = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    
    const playfabResponse = await playfabRequest('/Client/LoginWithPlayFab', {
      TitleId: PLAYFAB_TITLE_ID,
      Username: username,
      Password: password
    });
    
    // Return the complete PlayFab response
    res.status(200).json(playfabResponse);
  } catch (error) {
    console.error("Direct PlayFab login error:", error);
    res.status(error.response?.status || 500).json(error.response?.data || { message: "Server error" });
  }
};

// Generic PlayFab API proxy endpoint
exports.playFabProxy = async (req, res) => {
  try {
    const { endpoint } = req.params;
    const data = req.body;
    
    // Add TitleId if not provided
    if (!data.TitleId && endpoint.startsWith('/Client/')) {
      data.TitleId = PLAYFAB_TITLE_ID;
    }
    
    // Get session ticket from headers if available
    const headers = {};
    if (req.headers['x-authorization']) {
      headers['X-Authorization'] = req.headers['x-authorization'];
    }
    
    const playfabResponse = await playfabRequest(endpoint, data, headers);
    
    // Return the complete PlayFab response
    res.status(200).json(playfabResponse);
  } catch (error) {
    console.error(`PlayFab proxy error (${req.params.endpoint}):`, error);
    res.status(error.response?.status || 500).json(error.response?.data || { message: "Server error" });
  }
};