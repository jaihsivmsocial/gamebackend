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
  generatePresignedUrl,
  saveVideoAfterUpload,
  incrementView, // Keep this import for view increment
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

// Configure multer for video uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("video/")) {
      return cb(new Error("Only video files are allowed"), false)
    }
    const allowedExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm"]
    const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf("."))
    if (!allowedExtensions.includes(fileExtension)) {
      return cb(new Error("Invalid file extension"), false)
    }
    cb(null, true)
  },
})

// ===== API Routes =====

// Public routes
router.get("/get", validateQuery(paginationSchema), getVideos)
router.get("/trending", getTrendingVideos)
router.get("/:id", getVideo)
router.post("/:id/share", incrementShare)
router.get("/:id/thumbnail", getVideoThumbnail)
router.get("/:id/metadata", getVideoMetadata)
router.post("/:id/view", incrementView) // Essential for dynamic view count

// Protected routes (require authentication)
router.post("/upload-url", authenticate, generatePresignedUrl)
router.post("/save", authenticate, saveVideoAfterUpload)
router.post("/upload", authenticate, upload.single("video"), validateRequest(videoUploadSchema), uploadVideo)
router.post("/:id/like", authenticate, toggleLike)
router.post("/:id/comment", authenticate, validateRequest(commentSchema), addComment)
router.get("/:id/download", getDownloadUrl)
router.delete("/:id", authenticate, deleteVideo)

module.exports = router
