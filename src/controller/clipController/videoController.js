const Video = require("../../model/clip/videoModel")
const { uploadToS3, deleteFromS3, generatePresignedUrl } = require("../../config/aws")
const fs = require("fs")
const path = require("path")
const os = require("os")
const { createCanvas, loadImage } = require("canvas")
const ffmpeg = require("fluent-ffmpeg")
const { promisify } = require("util")
const mkdirp = promisify(require("mkdirp"))
const rimraf = promisify(require("rimraf"))
const fetch = require("node-fetch")

// Helper function to generate a thumbnail from a video URL
async function generateThumbnail(videoUrl, videoId) {
  try {
    // Create temp directory
    const tempDir = path.join(os.tmpdir(), `video-thumbnails-${videoId}`)
    await mkdirp(tempDir)

    // Download video to temp file
    const videoResponse = await fetch(videoUrl)
    const videoBuffer = await videoResponse.buffer()
    const videoPath = path.join(tempDir, `video-${videoId}.mp4`)
    fs.writeFileSync(videoPath, videoBuffer)

    // Generate thumbnail path
    const thumbnailPath = path.join(tempDir, `thumbnail-${videoId}.jpg`)

    // Generate thumbnail using ffmpeg
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .on("error", (err) => {
          console.error("Error generating thumbnail:", err)
          reject(err)
        })
        .screenshots({
          count: 1,
          folder: tempDir,
          filename: `thumbnail-${videoId}.jpg`,
          size: "640x360",
        })
        .on("end", async () => {
          try {
            // Read the thumbnail
            const thumbnailBuffer = fs.readFileSync(thumbnailPath)

            // Upload thumbnail to S3
            const uploadResult = await uploadToS3(thumbnailBuffer, `thumbnail-${videoId}.jpg`, "image/jpeg")

            // Clean up temp files
            await rimraf(tempDir)

            resolve(uploadResult.url)
          } catch (error) {
            reject(error)
          }
        })
    })
  } catch (error) {
    console.error("Failed to generate thumbnail:", error)
    return null
  }
}

// Upload video
const uploadVideo = async (req, res) => {
  try {
    console.log("Upload request received")
    console.log("Body:", req.body)
    console.log(
      "File:",
      req.file
        ? {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
          }
        : "No file",
    )

    const { title, description, tags } = req.body
    const videoFile = req.file

    // Validation
    if (!videoFile) {
      console.log("No video file provided")
      return res.status(400).json({
        success: false,
        message: "Video file is required",
      })
    }

    if (!title || title.trim().length === 0) {
      console.log("No title provided")
      return res.status(400).json({
        success: false,
        message: "Title is required",
      })
    }

    // Check file size (100MB limit)
    const maxSize = 100 * 1024 * 1024 // 100MB
    if (videoFile.size > maxSize) {
      return res.status(400).json({
        success: false,
        message: "File size too large. Maximum size is 100MB",
      })
    }

    // Check file type
    if (!videoFile.mimetype.startsWith("video/")) {
      return res.status(400).json({
        success: false,
        message: "Only video files are allowed",
      })
    }

    console.log("Starting S3 upload...")

    // Upload to S3
    const uploadResult = await uploadToS3(videoFile.buffer, videoFile.originalname, videoFile.mimetype)

    console.log("S3 upload successful:", uploadResult)

    // Create video record
    const video = new Video({
      title: title.trim(),
      description: description?.trim() || "",
      videoUrl: uploadResult.url,
      videoKey: uploadResult.key,
      userId: req.user.id,
      username: req.user.username,
      fileSize: videoFile.size,
      tags: tags ? tags.split(",").map((tag) => tag.trim().toLowerCase()) : [],
    })

    // Save the video first to get an ID
    await video.save()
    console.log(`Video saved to database: ${video._id}`)

    // Generate thumbnail asynchronously
    try {
      console.log("Generating thumbnail...")
      const thumbnailUrl = await generateThumbnail(uploadResult.url, video._id)

      if (thumbnailUrl) {
        video.thumbnailUrl = thumbnailUrl
        await video.save()
        console.log(`Thumbnail generated and saved: ${thumbnailUrl}`)
      }
    } catch (thumbnailError) {
      console.error("Thumbnail generation failed:", thumbnailError)
      // Continue without thumbnail
    }

    res.status(201).json({
      success: true,
      message: "Video uploaded successfully",
      video: {
        id: video._id,
        title: video.title,
        videoUrl: video.videoUrl,
        thumbnailUrl: video.thumbnailUrl,
        username: video.username,
        createdAt: video.createdAt,
      },
    })
  } catch (error) {
    console.error("Upload error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to upload video",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    })
  }
}

// Get videos with pagination
const getVideos = async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page) || 1
    const limit = Number.parseInt(req.query.limit) || 10
    const sortBy = req.query.sortBy || "createdAt"
    const sortOrder = req.query.sortOrder || "desc"
    const skip = (page - 1) * limit

    // Build sort object
    const sort = {}
    sort[sortBy] = sortOrder === "desc" ? -1 : 1

    const [videos, total] = await Promise.all([
      Video.find({ isActive: true }).sort(sort).skip(skip).limit(limit).select("-__v").lean(),
      Video.countDocuments({ isActive: true }),
    ])

    // Add user-specific data if authenticated
    if (req.user) {
      videos.forEach((video) => {
        video.isLiked = video.likes.some((like) => like.userId.toString() === req.user.id)
      })
    }

    res.json({
      success: true,
      videos,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalVideos: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
        limit,
      },
    })
  } catch (error) {
    console.error("Get videos error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch videos",
    })
  }
}

// Get single video
const getVideo = async (req, res) => {
  try {
    const { id } = req.params
    const video = await Video.findById(id).select("-__v")

    if (!video || !video.isActive) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    // Increment views
    video.views += 1
    await video.save()

    // Add user-specific data
    const videoData = video.toObject()
    if (req.user) {
      videoData.isLiked = video.likes.some((like) => like.userId.toString() === req.user.id)
    }

    res.json({
      success: true,
      video: videoData,
    })
  } catch (error) {
    console.error("Get video error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch video",
    })
  }
}

// Get video thumbnail
const getVideoThumbnail = async (req, res) => {
  try {
    const { id } = req.params
    const video = await Video.findById(id)

    if (!video || !video.isActive) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    // If we already have a thumbnail URL stored, redirect to it
    if (video.thumbnailUrl) {
      return res.redirect(video.thumbnailUrl)
    }

    // If no thumbnail exists yet, try to generate one
    try {
      const thumbnailUrl = await generateThumbnail(video.videoUrl, video._id)

      if (thumbnailUrl) {
        // Save the thumbnail URL
        video.thumbnailUrl = thumbnailUrl
        await video.save()

        // Redirect to the new thumbnail
        return res.redirect(thumbnailUrl)
      }
    } catch (thumbnailError) {
      console.error("Thumbnail generation failed:", thumbnailError)
      // Continue to fallback
    }

    // Fallback: Generate a dynamic thumbnail
    const canvas = createCanvas(640, 360)
    const ctx = canvas.getContext("2d")

    // Fill background with gradient
    const gradient = ctx.createLinearGradient(0, 0, 640, 360)
    gradient.addColorStop(0, "#0b0f19")
    gradient.addColorStop(1, "#0a1a2e")
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 640, 360)

    // Add video title
    ctx.fillStyle = "#ffffff"
    ctx.font = "bold 24px Arial"
    ctx.textAlign = "center"
    ctx.fillText(video.title || "Untitled Video", 320, 160)

    // Add username
    ctx.font = "16px Arial"
    ctx.fillText(`by @${video.username || "user"}`, 320, 200)

    // Add view count
    ctx.font = "14px Arial"
    ctx.fillText(`${video.views || 0} views`, 320, 230)

    // Add app logo/icon
    ctx.fillStyle = "#a4ff00"
    ctx.beginPath()
    ctx.arc(320, 100, 30, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = "#000000"
    ctx.font = "bold 30px Arial"
    ctx.fillText("C", 320, 110)

    // Convert to buffer and send
    const buffer = canvas.toBuffer("image/jpeg")
    res.set("Content-Type", "image/jpeg")
    res.send(buffer)
  } catch (error) {
    console.error("Get thumbnail error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to generate thumbnail",
    })
  }
}

// Get video metadata

const getVideoMetadata = async (req, res) => {
  try {
    const { id } = req.params
    console.log(`Getting metadata for video: ${id}`)

    const video = await Video.findById(id)

    if (!video || !video.isActive) {
      console.log(`Video not found or inactive: ${id}`)
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }
     const baseUrl = "http://apitest.tribez.gg"
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"

    // Generate thumbnail URL - use existing or generate endpoint
    const thumbnailUrl = video.thumbnailUrl || `${baseUrl}/api/videos/${video._id}/thumbnail`

    console.log(`Generated thumbnail URL: ${thumbnailUrl}`)

    const metadata = {
      title: video.title,
      description: video.description || `Watch this amazing video by @${video.username}`,
      imageUrl: thumbnailUrl,
      url: `${siteUrl}/video/${video._id}`,
      type: "video.other",
      siteName: "Clip App",
      username: video.username,
      views: video.views || 0,
      likes: video.likes?.length || 0,
      createdAt: video.createdAt,
      videoUrl: video.videoUrl,
    }

    console.log("Generated metadata:", metadata)

    res.json({
      success: true,
      metadata: metadata,
    })
  } catch (error) {
    console.error("Get video metadata error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch video metadata",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    })
  }
}

// Toggle like
const toggleLike = async (req, res) => {
  try {
    const { id } = req.params
    const video = await Video.findById(id)

    if (!video || !video.isActive) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    const existingLikeIndex = video.likes.findIndex((like) => like.userId.toString() === req.user.id)

    if (existingLikeIndex > -1) {
      // Unlike
      video.likes.splice(existingLikeIndex, 1)
    } else {
      // Like
      video.likes.push({ userId: req.user.id })
    }

    await video.save()

    res.json({
      success: true,
      liked: existingLikeIndex === -1,
      likesCount: video.likes.length,
    })
  } catch (error) {
    console.error("Toggle like error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to toggle like",
    })
  }
}

// Add comment
const addComment = async (req, res) => {
  try {
    const { id } = req.params
    const { text } = req.body

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Comment text is required",
      })
    }

    const video = await Video.findById(id)
    if (!video || !video.isActive) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    const comment = {
      userId: req.user.id,
      username: req.user.username,
      text: text.trim(),
    }

    video.comments.push(comment)
    await video.save()

    const newComment = video.comments[video.comments.length - 1]

    res.status(201).json({
      success: true,
      message: "Comment added successfully",
      comment: newComment,
    })
  } catch (error) {
    console.error("Add comment error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to add comment",
    })
  }
}

// Increment share count
const incrementShare = async (req, res) => {
  try {
    const { id } = req.params
    const video = await Video.findByIdAndUpdate(id, { $inc: { shares: 1 } }, { new: true })

    if (!video || !video.isActive) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    res.json({
      success: true,
      shares: video.shares,
    })
  } catch (error) {
    console.error("Increment share error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to increment share count",
    })
  }
}

// Get download URL
const getDownloadUrl = async (req, res) => {
  try {
    const { id } = req.params
    const video = await Video.findById(id)

    if (!video || !video.isActive) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    // Increment download count
    video.downloads += 1
    await video.save()

    // Return the direct URL for now
    res.json({
      success: true,
      downloadUrl: video.videoUrl,
      downloads: video.downloads,
    })
  } catch (error) {
    console.error("Get download URL error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to get download URL",
    })
  }
}

// Delete video
const deleteVideo = async (req, res) => {
  try {
    const { id } = req.params
    const video = await Video.findById(id)

    if (!video) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    if (video.userId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this video",
      })
    }

    // Soft delete
    video.isActive = false
    await video.save()

    res.json({
      success: true,
      message: "Video deleted successfully",
    })
  } catch (error) {
    console.error("Delete video error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to delete video",
    })
  }
}

// Get trending videos
const getTrendingVideos = async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit) || 10
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const videos = await Video.find({
      isActive: true,
      createdAt: { $gte: oneDayAgo },
    })
      .sort({ views: -1, createdAt: -1 })
      .limit(limit)
      .lean()

    res.json({
      success: true,
      videos,
    })
  } catch (error) {
    console.error("Get trending videos error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch trending videos",
    })
  }
}

module.exports = {
  uploadVideo,
  getVideos,
  getVideo,
  getVideoThumbnail,
  getVideoMetadata,
  toggleLike,
  addComment,
  incrementShare,
  getDownloadUrl,
  deleteVideo,
  getTrendingVideos,
}
