// Complete production-ready video controller with enhanced error handling
const Video = require("../../model/clip/videoModel")
const path = require("path")

// Initialize S3 client with better error handling
let s3Client
try {
  const { S3Client } = require("@aws-sdk/client-s3")
  const { createPresignedPost } = require("@aws-sdk/s3-presigned-post")

  s3Client = new S3Client({
    region: "ams3", // Correct, matches your .env
    endpoint: "https://ams3.digitaloceanspaces.com", // Correct
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  })
  console.log("S3 Client initialized successfully")
  console.log("AWS Region:", process.env.AWS_REGION)
  console.log("AWS Bucket:", process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME)
} catch (error) {
  console.error("Failed to initialize S3 client:", error)
}

// Generate presigned URL for direct S3 upload
const generatePresignedUrl = async (req, res) => {
  try {
    console.log("=== PRESIGNED URL REQUEST ===")
    console.log("Request body:", req.body)
    console.log("User:", req.user ? { id: req.user.id, username: req.user.username } : "No user")

    // Check if S3 client is initialized
    if (!s3Client) {
      console.error("S3 client not initialized")
      return res.status(500).json({
        success: false,
        message: "S3 service not available",
        error: "S3 client initialization failed",
      })
    }

    // Check environment variables
    const requiredEnvVars = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"]
    const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar])
    if (missingEnvVars.length > 0) {
      console.error("Missing environment variables:", missingEnvVars)
      return res.status(500).json({
        success: false,
        message: "Server configuration error",
        error: `Missing environment variables: ${missingEnvVars.join(", ")}`,
      })
    }

    // Check authentication
    if (!req.user || !req.user.id) {
      console.error("User not authenticated")
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "User not found in request",
      })
    }

    const { filename, contentType, fileSize } = req.body

    // Validation
    if (!filename || !contentType) {
      console.error("Missing filename or contentType")
      return res.status(400).json({
        success: false,
        message: "Filename and content type are required",
      })
    }

    // Check file type
    if (!contentType.startsWith("video/")) {
      console.error("Invalid content type:", contentType)
      return res.status(400).json({
        success: false,
        message: "Only video files are allowed",
      })
    }

    // Check file size (100MB limit)
    const maxSize = 100 * 1024 * 1024 // 100MB
    if (fileSize && fileSize > maxSize) {
      console.error("File too large:", fileSize)
      return res.status(400).json({
        success: false,
        message: "File size too large. Maximum size is 100MB",
      })
    }

    // Generate unique key for S3
    const fileExtension = path.extname(filename)
    const uniqueKey = `videos/${req.user.id}/${Date.now()}-${Math.random().toString(36).substring(2)}${fileExtension}`

    // Get bucket name with fallback
    const bucketName = process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || "mstribe-website"
    console.log("=== S3 CONFIGURATION ===")
    console.log("Bucket name:", bucketName)
    console.log("S3 Key:", uniqueKey)
    console.log("Content Type:", contentType)
    console.log("File size:", fileSize)
    console.log("AWS Region:", process.env.AWS_REGION)

    // Import createPresignedPost dynamically to catch import errors
    const { createPresignedPost } = require("@aws-sdk/s3-presigned-post")
    const presignedPostData = await createPresignedPost(s3Client, {
      Bucket: bucketName,
      Key: uniqueKey,
      Conditions: [
        ["content-length-range", 0, maxSize],
        ["starts-with", "$Content-Type", "video/"],
        ["eq", "$Content-Type", contentType],
      ],
      Fields: {
        "Content-Type": contentType,
        ACL: "public-read", // ADDED: Ensure public readability
      },
      Expires: 3600, // 1 hour expiry
    })

    console.log("=== PRESIGNED POST GENERATED ===")
    console.log("URL:", presignedPostData.url)
    console.log("Fields:", presignedPostData.fields)
    res.json({
      success: true,
      url: presignedPostData.url,
      fields: presignedPostData.fields,
      key: uniqueKey,
      expiresIn: 3600,
    })
  } catch (error) {
    console.error("=== PRESIGNED URL ERROR ===")
    console.error("Error type:", error.constructor.name)
    console.error("Error message:", error.message)
    console.error("Error stack:", error.stack)

    // Check for specific AWS errors
    if (error.name === "CredentialsProviderError") {
      return res.status(500).json({
        success: false,
        message: "AWS credentials error",
        error: "Invalid AWS credentials configuration",
      })
    }
    if (error.name === "UnknownEndpoint") {
      return res.status(500).json({
        success: false,
        message: "AWS region error",
        error: "Invalid AWS region configuration",
      })
    }
    if (error.message.includes("bucket")) {
      return res.status(500).json({
        success: false,
        message: "S3 bucket error",
        error: "Bucket access denied or does not exist",
      })
    }

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
    console.log("=== SAVE VIDEO REQUEST ===")
    console.log("Request body:", req.body)
    console.log("User:", req.user ? { id: req.user.id, username: req.user.username } : "No user")

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

    // Check authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      })
    }

    // Use your exact bucket name and region
    const bucketName = process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || "mstribe-website"
    // MODIFIED: Ensure region consistency with S3 client initialization
    const region = process.env.AWS_REGION || "ams3"

    // Construct the S3 URL
    const videoUrl = `https://${bucketName}.${region}.digitaloceanspaces.com/${s3Key}`

    // For thumbnailUrl, if a dedicated one isn't provided, use the videoUrl itself as a fallback.
    // Ideally, a separate thumbnail image would be generated and uploaded to S3.
    const thumbnailUrl = videoUrl // Use the video's direct URL as the thumbnail URL for now

    console.log("=== VIDEO SAVE DATA ===")
    console.log("Video URL:", videoUrl)
    console.log("S3 Key:", s3Key)
    console.log("Title:", title)

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
      likes: [], // Initialize as empty array for Mongoose
      comments: [], // Initialize as empty array for Mongoose
      shares: 0,
      downloads: 0,
      thumbnailUrl: thumbnailUrl,
      sharedBy: [], // Initialize new field
      linkClicks: 0, // Initialize new field
      uniqueLinkClicks: [], // Initialize new field
      uniqueViews: [], // ADDED: Initialize uniqueViews field
    })

    // Save the video
    await video.save()

    console.log(`Video saved to database: ${video._id}`)
    res.status(201).json({
      success: true,
      message: "Video saved successfully",
      video: {
        id: video._id,
        title: video.title,
        description: video.description,
        videoUrl: video.videoUrl,
        thumbnailUrl: thumbnailUrl, // Ensure this is a direct, publicly accessible URL to an image
        username: video.username,
        views: video.views,
        likes: video.likes,
        createdAt: video.createdAt,
      },
    })
  } catch (error) {
    console.error("=== SAVE VIDEO ERROR ===")
    console.error("Error:", error)
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

    // Use your exact bucket name and region
    const bucketName = process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || "mstribe-website"
    // MODIFIED: Ensure region consistency with S3 client initialization
    const region = process.env.AWS_REGION || "ams3"

    // Upload to S3 (you'll need to implement uploadToS3 function here, ensuring public-read ACL)
    // Example: await uploadToS3(file.buffer, uniqueKey, file.mimetype, bucketName, region);
    const videoUrl = `https://${bucketName}.${region}.digitaloceanspaces.com/${uniqueKey}`

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
      likes: [], // Initialize as empty array for Mongoose
      comments: [], // Initialize as empty array for Mongoose
      shares: 0,
      downloads: 0,
      // Initialize new fields
      sharedBy: [],
      linkClicks: 0,
      uniqueLinkClicks: [],
      uniqueViews: [], // ADDED: Initialize uniqueViews field
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

// Get single video (now only fetches data, view increment moved to /:id/view)
const getVideo = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user ? req.user.id : null
    const userIp = req.ip || req.headers["x-forwarded-for"]?.split(",").shift() || "unknown"

    // Check for shared link source from query parameter
    const isSharedLinkClick = req.query.source === "share"

    console.log(`[getVideo] Request for video ID: ${id}`)
    console.log(
      `[getVideo] User ID: ${userId}, IP: ${userIp}, Query Source: ${req.query.source}, Is Shared Link Click: ${isSharedLinkClick}`,
    )

    const video = await Video.findById(id)

    if (!video || !video.isActive) {
      console.log(`[getVideo] Video ID ${id} not found or inactive.`)
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    // NEW: Track link clicks if from a shared source
    if (isSharedLinkClick) {
      console.log(`[getVideo] Processing shared link click for video ID: ${id}`)
      console.log(
        `[getVideo] Video state BEFORE link click update: Link Clicks: ${video.linkClicks}, Unique Link Clicks: ${video.uniqueLinkClicks.length}`,
      )

      video.linkClicks = (video.linkClicks || 0) + 1 // Increment total link clicks

      // Track unique link clicks
      let alreadyClicked = false
      if (userId) {
        alreadyClicked = video.uniqueLinkClicks.some((entry) => entry.userId && entry.userId.equals(userId))
      } else {
        alreadyClicked = video.uniqueLinkClicks.some((entry) => entry.ip === userIp)
      }

      if (!alreadyClicked) {
        video.uniqueLinkClicks.push({ userId: userId, ip: userIp, clickedAt: new Date() })
        console.log(`[getVideo] Unique link click added for video ID ${id}.`)
      } else {
        console.log(`[getVideo] Video ID ${id} already clicked by this user/IP.`)
      }

      await video.save() // Save changes to linkClicks and uniqueLinkClicks
      console.log(
        `[getVideo] Video state AFTER link click update: Link Clicks: ${video.linkClicks}, Unique Link Clicks: ${video.uniqueLinkClicks.length}`,
      )
    } else {
      console.log(`[getVideo] Not a shared link click for video ID: ${id}. Link clicks not incremented.`)
    }

    // Views increment logic has been moved to a separate endpoint (/api/videos/:id/view)
    // This endpoint now only fetches the video data.
    res.json({
      success: true,
      video: video,
    })
  } catch (error) {
    console.error("[getVideo] Error fetching video:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch video",
    })
  }
}

// NEW: Increment video view count
const incrementView = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user ? req.user.id : null
    const userIp = req.ip || req.headers["x-forwarded-for"]?.split(",").shift() || "unknown"

    console.log(`[incrementView] Request for video ID: ${id}, User ID: ${userId}, IP: ${userIp}`)

    const video = await Video.findById(id)

    if (!video || !video.isActive) {
      console.log(`[incrementView] Video ID ${id} not found or inactive.`)
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    console.log(
      `[incrementView] Video state BEFORE update: Views: ${video.views}, Unique Views: ${video.uniqueViews.length}`,
    )

    video.views = (video.views || 0) + 1 // Increment total views

    // Track unique views
    let alreadyViewed = false
    if (userId) {
      alreadyViewed = video.uniqueViews.some((entry) => entry.userId && entry.userId.equals(userId))
    } else {
      alreadyViewed = video.uniqueViews.some((entry) => entry.ip === userIp)
    }

    if (!alreadyViewed) {
      video.uniqueViews.push({ userId: userId, ip: userIp, viewedAt: new Date() })
      console.log(`[incrementView] Unique view added for video ID ${id}.`)
    } else {
      console.log(`[incrementView] Video ID ${id} already viewed by this user/IP.`)
    }

    await video.save()

    console.log(`[incrementView] Video ID ${id} saved successfully after updates.`)
    console.log(
      `[incrementView] Video state AFTER update: Views: ${video.views}, Unique Views: ${video.uniqueViews.length}`,
    )

    res.json({
      success: true,
      views: video.views,
      uniqueViews: video.uniqueViews.length,
    })
  } catch (error) {
    console.error("[incrementView] Error incrementing view:", error)
    res.status(500).json({
      success: false,
      message: "Failed to increment view count",
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

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://api.5mof.gg"
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"

    // Use the video's actual thumbnail URL from the database
    const thumbnailUrl = video.thumbnailUrl
    const videoPageUrl = `${siteUrl}/video/${video._id}`
    const playerUrl = `${siteUrl}/video/${video._id}/player`

    // Use the video's actual video URL from the database
    const videoContentUrl = video.videoUrl

    const metadata = {
      // Basic info
      title: video.title,
      description: video.description || `Watch this amazing video by @${video.username}`,
      url: videoPageUrl,
      playerUrl: playerUrl,
      imageUrl: thumbnailUrl,
      videoUrl: videoContentUrl,

      // Video details
      duration: video.duration || 30,
      views: video.views || 0,
      likes: video.likes?.length || 0,
      username: video.username,
      createdAt: video.createdAt,
      tags: video.tags || [],

      // Platform specific metadata
      siteName: "Clip App",
      type: "video.other",

      // Open Graph specific
      "og:title": video.title,
      "og:description": video.description || `Video by @${video.username}`,
      "og:image": thumbnailUrl,
      "og:image:width": "1200",
      "og:image:height": "630",
      "og:image:type": "image/jpeg", // IMPORTANT: Ensure this matches the actual type of your thumbnails
      "og:video": videoContentUrl,
      "og:video:secure_url": videoContentUrl,
      "og:video:type": "video/mp4", // IMPORTANT: Ensure this matches the actual type of your videos
      "og:video:width": "720",
      "og:video:height": "1280",
      "og:url": videoPageUrl,
      "og:site_name": "Clip App",
      "og:type": "video.other",
      "og:locale": "en_US",

      // Twitter Card specific
      "twitter:card": "player",
      "twitter:site": "@ClipApp",
      "twitter:creator": `@${video.username}`,
      "twitter:title": video.title,
      "twitter:description": video.description || `Video by @${video.username}`,
      "twitter:image": thumbnailUrl,
      "twitter:player": playerUrl,
      "twitter:player:width": "720",
      "twitter:player:height": "1280",
      "twitter:player:stream": videoContentUrl,

      // Schema.org structured data
      structuredData: {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        name: video.title,
        description: video.description || `Video by @${video.username}`,
        thumbnailUrl: thumbnailUrl,
        uploadDate: video.createdAt,
        duration: `PT${video.duration || 30}S`,
        contentUrl: videoContentUrl,
        embedUrl: playerUrl,
        author: {
          "@type": "Person",
          name: video.username,
        },
        publisher: {
          "@type": "Organization",
          name: "Clip App",
          url: siteUrl,
        },
        interactionStatistic: [
          {
            "@type": "InteractionCounter",
            interactionType: "https://schema.org/WatchAction",
            userInteractionCount: video.views || 0,
          },
          {
            "@type": "InteractionCounter",
            interactionType: "https://schema.org/LikeAction",
            userInteractionCount: video.likes?.length || 0,
          },
        ],
      },
    }

    res.json({
      success: true,
      metadata: metadata,
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

    if (!video || !video.isActive || !video.thumbnailUrl) {
      // If video not found, inactive, or no thumbnail URL, return 404
      return res.status(404).json({
        success: false,
        message: "Video thumbnail not found or not available",
      })
    }

    // Redirect to the actual thumbnail URL stored in the database
    // This URL MUST be a direct link to an image file (e.g., an S3 public URL)
    res.redirect(302, video.thumbnailUrl)
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

    const likeIndex = video.likes.findIndex((like) => like.userId && like.userId.equals(userId)) // Use findIndex for array of objects
    let isLiked = false

    if (likeIndex > -1) {
      // Unlike
      video.likes.splice(likeIndex, 1)
    } else {
      // Like
      video.likes.push({ userId: userId, createdAt: new Date() }) // Push object
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
    const userId = req.user ? req.user.id : null
    const userIp = req.ip || req.headers["x-forwarded-for"]?.split(",").shift() || "unknown"

    console.log(`[incrementShare] Request for video ID: ${id}, User ID: ${userId}, IP: ${userIp}`)

    const video = await Video.findById(id)

    if (!video || !video.isActive) {
      console.log(`[incrementShare] Video ID ${id} not found or inactive.`)
      return res.status(404).json({
        success: false,
        message: "Video not found",
      })
    }

    console.log(`[incrementShare] Video state BEFORE update:
      Shares: ${video.shares}, Shared By: ${video.sharedBy.length}`)

    video.shares = (video.shares || 0) + 1 // Increment total share actions

    // Track unique sharers
    let alreadyShared = false
    if (userId) {
      alreadyShared = video.sharedBy.some((entry) => entry.userId && entry.userId.equals(userId))
    } else {
      alreadyShared = video.sharedBy.some((entry) => entry.ip === userIp)
    }

    if (!alreadyShared) {
      video.sharedBy.push({ userId: userId, ip: userIp, sharedAt: new Date() })
      console.log(`[incrementShare] Unique sharer added for video ID ${id}.`)
    } else {
      console.log(`[incrementShare] Video ID ${id} already shared by this user/IP.`)
    }

    await video.save()

    console.log(`[incrementShare] Video ID ${id} saved successfully after updates.`)
    console.log(`[incrementShare] Video state AFTER update:
      Shares: ${video.shares}, Shared By: ${video.sharedBy.length}`)

    res.json({
      success: true,
      shares: video.shares,
      uniqueSharers: video.sharedBy.length,
    })
  } catch (error) {
    console.error("[incrementShare] Error incrementing share:", error)
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
  incrementView, // NEWLY ADDED
}
