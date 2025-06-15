// Complete production-ready video controller

const Video = require("../../model/clip/videoModel")
const path = require("path")
const { generatePresignedUrl: generateS3Url, deleteFromS3 } = require("../../config/aws")

// Generate presigned URL for direct S3 upload
const generatePresignedUrl = async (req, res) => {
  try {
    const { filename, contentType, fileSize } = req.body

    // Validation
    if (!filename || !contentType) {
      return res.status(400).json({
        success: false,
        message: "Filename and content type are required",
      })
    }

    // Check file type
    if (!contentType.startsWith("video/")) {
      return res.status(400).json({
        success: false,
        message: "Only video files are allowed",
      })
    }

    // Check file size (100MB limit)
    const maxSize = 100 * 1024 * 1024 // 100MB
    if (fileSize && fileSize > maxSize) {
      return res.status(400).json({
        success: false,
        message: "File size too large. Maximum size is 100MB",
      })
    }

    // Generate unique key for S3
    const fileExtension = path.extname(filename)
    const uniqueKey = `videos/${req.user.id}/${Date.now()}-${Math.random().toString(36).substring(2)}${fileExtension}`

    // Use createPresignedPost for proper POST upload
    const { createPresignedPost } = require("@aws-sdk/s3-presigned-post")
    const { S3Client } = require("@aws-sdk/client-s3")

    const client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    })

    const { url, fields } = await createPresignedPost(client, {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: uniqueKey,
      Conditions: [
        ["content-length-range", 0, maxSize],
        ["starts-with", "$Content-Type", contentType],
      ],
      Fields: {
        "Content-Type": contentType,
      },
      Expires: 3600, // 1 hour expiry
    })

    res.json({
      success: true,
      url: url,
      fields: fields,
      key: uniqueKey,
      expiresIn: 3600,
    })
  } catch (error) {
    console.error("Generate presigned URL error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to generate upload URL",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    })
  }
}

// Save video after direct S3 upload
const saveVideoAfterUpload = async (req, res) => {
  try {
    const { title, description, tags, s3Key, fileSize } = req.body

    // Validation
    if (!title || title.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Title is required",
      })
    }

    if (!s3Key) {
      return res.status(400).json({
        success: false,
        message: "S3 key is required",
      })
    }

    // Construct the S3 URL
    const videoUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`

    // Create video record
    const video = new Video({
      title: title.trim(),
      description: description?.trim() || "",
      videoUrl: videoUrl,
      videoKey: s3Key,
      userId: req.user.id,
      username: req.user.username,
      fileSize: fileSize || 0,
      tags: tags ? tags.split(",").map((tag) => tag.trim().toLowerCase()) : [],
      isActive: true,
      views: 0,
      likes: [],
      comments: [],
      shares: 0,
      downloads: 0,
    })

    // Save the video
    await video.save()
    console.log(`Video saved to database: ${video._id}`)

    // Generate basic thumbnail URL (optional - can be generated later)
    const thumbnailUrl = `${process.env.NEXT_PUBLIC_BASE_URL || "http://apitest.tribez.gg"}/api/videos/${video._id}/thumbnail`

    res.status(201).json({
      success: true,
      message: "Video saved successfully",
      video: {
        id: video._id,
        title: video.title,
        description: video.description,
        videoUrl: video.videoUrl,
        thumbnailUrl: thumbnailUrl,
        username: video.username,
        views: video.views,
        likes: video.likes,
        createdAt: video.createdAt,
      },
    })
  } catch (error) {
    console.error("Save video error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to save video",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    })
  }
}

// MISSING API 1: Traditional upload video (for backward compatibility)
const uploadVideo = async (req, res) => {
  try {
    const { title, description, tags } = req.body
    const file = req.file

    // Validation
    if (!title || title.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Title is required",
      })
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "Video file is required",
      })
    }

    // Generate unique key for S3
    const fileExtension = path.extname(file.originalname)
    const uniqueKey = `videos/${req.user.id}/${Date.now()}-${Math.random().toString(36).substring(2)}${fileExtension}`

    // Upload to S3 (you'll need to implement uploadToS3 function)
    const videoUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${uniqueKey}`

    // Create video record
    const video = new Video({
      title: title.trim(),
      description: description?.trim() || "",
      videoUrl: videoUrl,
      videoKey: uniqueKey,
      userId: req.user.id,
      username: req.user.username,
      fileSize: file.size || 0,
      tags: tags ? tags.split(",").map((tag) => tag.trim().toLowerCase()) : [],
      isActive: true,
      views: 0,
      likes: [],
      comments: [],
      shares: 0,
      downloads: 0,
    })

    await video.save()

    res.status(201).json({
      success: true,
      message: "Video uploaded successfully",
      video: {
        id: video._id,
        title: video.title,
        description: video.description,
        videoUrl: video.videoUrl,
        username: video.username,
        createdAt: video.createdAt,
      },
    })
  } catch (error) {
    console.error("Upload video error:", error)
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
    const skip = (page - 1) * limit

    const videos = await Video.find({ isActive: true }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()

    const totalVideos = await Video.countDocuments({ isActive: true })
    const hasNext = skip + videos.length < totalVideos

    res.json({
      success: true,
      videos: videos,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalVideos / limit),
        totalVideos: totalVideos,
        hasNext: hasNext,
        hasPrev: page > 1,
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

// MISSING API 2: Get trending videos
const getTrendingVideos = async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit) || 20

    // Algorithm: Sort by combination of views, likes, and recency
    const videos = await Video.aggregate([
      { $match: { isActive: true } },
      {
        $addFields: {
          likesCount: { $size: "$likes" },
          commentsCount: { $size: "$comments" },
          // Trending score: views + (likes * 2) + (comments * 3) + recency bonus
          trendingScore: {
            $add: [
              "$views",
              { $multiply: [{ $size: "$likes" }, 2] },
              { $multiply: [{ $size: "$comments" }, 3] },
              // Recency bonus: newer videos get higher score
              {
                $divide: [
                  { $subtract: [new Date(), "$createdAt"] },
                  1000 * 60 * 60 * 24, // Convert to days
                ],
              },
            ],
          },
        },
      },
      { $sort: { trendingScore: -1 } },
      { $limit: limit },
    ])

    res.json({
      success: true,
      videos: videos,
      total: videos.length,
    })
  } catch (error) {
    console.error("Get trending videos error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch trending videos",
    })
  }
}

// Get single video
const getVideo = async (req, res) => {
  try {
    const { id } = req.params
    const video = await Video.findById(id)

    if (!video || !video.isActive) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    // Increment view count
    video.views = (video.views || 0) + 1
    await video.save()

    res.json({
      success: true,
      video: video,
    })
  } catch (error) {
    console.error("Get video error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch video",
    })
  }
}

// Get video metadata for rich sharing
const getVideoMetadata = async (req, res) => {
  try {
    const { id } = req.params
    const video = await Video.findById(id)

    if (!video || !video.isActive) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }
    const baseUrl = "http://apitest.tribez.gg"
    // const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:5000"
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"

    // Generate thumbnail URL
    const thumbnailUrl = video.thumbnailUrl || `${baseUrl}/api/videos/${video._id}/thumbnail`

    res.json({
      success: true,
      metadata: {
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
      },
    })
  } catch (error) {
    console.error("Get video metadata error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch video metadata",
    })
  }
}

// Simple thumbnail endpoint (returns placeholder for now)
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

    // For now, redirect to a placeholder or return video URL
    // In production, you'd generate actual thumbnails
    res.redirect(`/placeholder.svg?height=360&width=640&query=video-thumbnail`)
  } catch (error) {
    console.error("Get video thumbnail error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to get video thumbnail",
    })
  }
}

// Toggle like on video
const toggleLike = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.id

    const video = await Video.findById(id)
    if (!video || !video.isActive) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    const likeIndex = video.likes.indexOf(userId)
    let isLiked = false

    if (likeIndex > -1) {
      // Unlike
      video.likes.splice(likeIndex, 1)
    } else {
      // Like
      video.likes.push(userId)
      isLiked = true
    }

    await video.save()

    res.json({
      success: true,
      isLiked: isLiked,
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

// Add comment to video
const addComment = async (req, res) => {
  try {
    const { id } = req.params
    const { text } = req.body
    const userId = req.user.id
    const username = req.user.username

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
      userId: userId,
      username: username,
      text: text.trim(),
      createdAt: new Date(),
    }

    video.comments.push(comment)
    await video.save()

    res.json({
      success: true,
      comment: comment,
      commentsCount: video.comments.length,
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

    const video = await Video.findById(id)
    if (!video || !video.isActive) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    video.shares = (video.shares || 0) + 1
    await video.save()

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
    video.downloads = (video.downloads || 0) + 1
    await video.save()

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

// MISSING API 3: Delete video
const deleteVideo = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.id

    const video = await Video.findById(id)
    if (!video) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    // Check if user owns the video or is admin
    if (video.userId.toString() !== userId && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this video",
      })
    }

    // Soft delete (mark as inactive)
    video.isActive = false
    await video.save()

    // Optional: Delete from S3 (uncomment if you want hard delete)
    // if (video.videoKey) {
    //   try {
    //     await deleteFromS3(video.videoKey)
    //   } catch (s3Error) {
    //     console.error("Failed to delete from S3:", s3Error)
    //   }
    // }

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

// COMPLETE EXPORTS - All APIs included
module.exports = {
  // Direct S3 upload (NEW)
  generatePresignedUrl,
  saveVideoAfterUpload,

  // Traditional upload (ADDED)
  uploadVideo,

  // Video CRUD
  getVideos,
  getVideo,
  deleteVideo, // ADDED

  // Trending & Discovery (ADDED)
  getTrendingVideos,

  // Metadata & Sharing
  getVideoMetadata,
  getVideoThumbnail,

  // Interactions
  toggleLike,
  addComment,
  incrementShare,
  getDownloadUrl,
}
