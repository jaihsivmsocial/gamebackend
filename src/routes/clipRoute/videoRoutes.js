const express = require("express")
const multer = require("multer")
const {
  uploadVideo,
  getVideos,
  getVideo,
  toggleLike,
  addComment,
  incrementShare,
  getDownloadUrl,
  deleteVideo,
  getTrendingVideos,
  getVideoThumbnail,
  getVideoMetadata,
  // Add these new imports
  generatePresignedUrl,
  saveVideoAfterUpload,
} = require("./../../controller/clipController/videoController")
const authenticate = require("../../middleware/authMiddleware")
const {
  validateRequest,
  validateQuery,
  videoUploadSchema,
  commentSchema,
  paginationSchema,
} = require("../../utils/clipvalidation/validation")

const router = express.Router()

// Configure multer with better error handling
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    if (!file.mimetype.startsWith("video/")) {
      return cb(new Error("Only video files are allowed"), false)
    }

    // Check file extension
    const allowedExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm"]
    const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf("."))

    if (!allowedExtensions.includes(fileExtension)) {
      return cb(new Error("Invalid file extension"), false)
    }

    cb(null, true)
  },
})

// ===== SPECIFIC ROUTES FIRST (BEFORE /:id) =====

// Public specific routes
router.get("/get", validateQuery(paginationSchema), getVideos)
router.get("/trending", getTrendingVideos)

// Protected specific routes - NEW: Direct S3 upload routes
router.post("/upload-url", authenticate, generatePresignedUrl) // Generate presigned URL
router.post("/save", authenticate, saveVideoAfterUpload) // Save after S3 upload

// Protected specific routes - EXISTING
router.post("/upload", authenticate, upload.single("video"), validateRequest(videoUploadSchema), uploadVideo)

// ===== PARAMETERIZED ROUTES LAST (AFTER SPECIFIC ROUTES) =====

// Public parameterized routes
router.get("/:id", getVideo) // This should be AFTER specific routes
router.post("/:id/share", incrementShare)
router.get("/:id/thumbnail", getVideoThumbnail)
router.get("/:id/metadata", getVideoMetadata)

// Protected parameterized routes
router.post("/:id/like", authenticate, toggleLike)
router.post("/:id/comment", authenticate, validateRequest(commentSchema), addComment)
router.get("/:id/download", getDownloadUrl)
router.delete("/:id", authenticate, deleteVideo)

module.exports = router
