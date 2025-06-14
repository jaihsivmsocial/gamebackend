// const Redis = require("ioredis")

// // Create separate Redis clients for different purposes
// const redisClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379")
// const redisPubClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379")
// const redisSubClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379")

// // Viewer counter utility
// const viewerCounter = {
//   async incrementViewers(streamId) {
//     const key = `viewers:${streamId}`
//     const count = await redisClient.incr(key)
//     await redisClient.expire(key, 3600) // 1 hour TTL
//     return Number.parseInt(count)
//   },

//   async decrementViewers(streamId) {
//     const key = `viewers:${streamId}`
//     const count = await redisClient.decr(key)

//     // If count is 0 or negative, delete the key
//     if (count <= 0) {
//       await redisClient.del(key)
//       return 0
//     }

//     return Number.parseInt(count)
//   },

//   async getViewerCount(streamId) {
//     const key = `viewers:${streamId}`
//     const count = await redisClient.get(key)
//     return Number.parseInt(count || 0)
//   },

//   async resetViewerCount(streamId) {
//     const key = `viewers:${streamId}`
//     await redisClient.del(key)
//     return 0
//   },

//   async getActiveViewers(streamId) {
//     // Get all viewer keys for this stream
//     const pattern = `viewer:${streamId}:*`
//     const keys = await redisClient.keys(pattern)
//     return keys.length
//   },

//   async syncViewerCount(streamId) {
//     // Count actual active viewers
//     const activeViewers = await this.getActiveViewers(streamId)

//     // Update the count
//     const key = `viewers:${streamId}`
//     if (activeViewers === 0) {
//       await redisClient.del(key)
//     } else {
//       await redisClient.set(key, activeViewers.toString())
//       await redisClient.expire(key, 3600) // 1 hour TTL
//     }

//     return activeViewers
//   },
// }

// // Chat rate limiter utility
// const chatRateLimiter = {
//   async checkLimit(userId, streamId) {
//     const key = `ratelimit:chat:${userId}:${streamId}`
//     const count = await redisClient.incr(key)

//     if (count === 1) {
//       await redisClient.expire(key, 10) // 10 seconds window
//     }

//     return count <= 20 // 5 messages per 10 seconds
//   },
// }

// module.exports = {
//   redisClient,
//   redisPubClient,
//   redisSubClient,
//   viewerCounter,
//   chatRateLimiter,
// }

const Redis = require("ioredis")
const { logger } = require("../utils/clipvalidation/logger")

// Use your existing Redis setup but enhance it for production
const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  db: process.env.REDIS_DB || 0,
  retryDelayOnFailover: 100,
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: 30000,
  connectTimeout: 10000,
  commandTimeout: 5000,
  enableOfflineQueue: false,
}

// Create Redis clients (enhanced version of your existing setup)
const redisClient = new Redis(process.env.REDIS_URL || redisConfig)
const redisPubClient = new Redis(process.env.REDIS_URL || redisConfig)
const redisSubClient = new Redis(process.env.REDIS_URL || redisConfig)

// Enhanced event handlers
redisClient.on("connect", () => {
  logger.info("Redis client connected")
})

redisClient.on("error", (err) => {
  logger.error("Redis client error:", err)
})

redisPubClient.on("error", (err) => {
  logger.error("Redis pub client error:", err)
})

redisSubClient.on("error", (err) => {
  logger.error("Redis sub client error:", err)
})

// Your existing viewer counter (enhanced for reels)
const viewerCounter = {
  async incrementViewers(streamId) {
    const key = `viewers:${streamId}`
    const count = await redisClient.incr(key)
    await redisClient.expire(key, 3600) // 1 hour TTL
    return Number.parseInt(count)
  },

  async decrementViewers(streamId) {
    const key = `viewers:${streamId}`
    const count = await redisClient.decr(key)

    if (count <= 0) {
      await redisClient.del(key)
      return 0
    }

    return Number.parseInt(count)
  },

  async getViewerCount(streamId) {
    const key = `viewers:${streamId}`
    const count = await redisClient.get(key)
    return Number.parseInt(count || 0)
  },

  async resetViewerCount(streamId) {
    const key = `viewers:${streamId}`
    await redisClient.del(key)
    return 0
  },

  async getActiveViewers(streamId) {
    const pattern = `viewer:${streamId}:*`
    const keys = await redisClient.keys(pattern)
    return keys.length
  },

  async syncViewerCount(streamId) {
    const activeViewers = await this.getActiveViewers(streamId)
    const key = `viewers:${streamId}`

    if (activeViewers === 0) {
      await redisClient.del(key)
    } else {
      await redisClient.set(key, activeViewers.toString())
      await redisClient.expire(key, 3600)
    }

    return activeViewers
  },
}

// Enhanced chat rate limiter for reels comments
const chatRateLimiter = {
  async checkLimit(userId, streamId) {
    const key = `ratelimit:chat:${userId}:${streamId}`
    const count = await redisClient.incr(key)

    if (count === 1) {
      await redisClient.expire(key, 10) // 10 seconds window
    }

    return count <= 5 // 5 messages per 10 seconds for reels
  },

  // New: Rate limiter for video interactions
  async checkVideoInteractionLimit(userId, action) {
    const key = `ratelimit:${action}:${userId}`
    const count = await redisClient.incr(key)

    if (count === 1) {
      const ttl = action === "like" ? 1 : action === "comment" ? 10 : 60
      await redisClient.expire(key, ttl)
    }

    const limits = {
      like: 100, // 100 likes per second
      comment: 10, // 10 comments per 10 seconds
      share: 20, // 20 shares per minute
      upload: 5, // 5 uploads per hour
    }

    return count <= (limits[action] || 10)
  },
}

// New: Video caching utilities for reels
const videoCache = {
  // Cache video feed
  async cacheVideoFeed(userId, page, videos) {
    const key = `feed:${userId}:${page}`
    await redisClient.setex(key, 300, JSON.stringify(videos)) // 5 minutes cache
  },

  async getCachedVideoFeed(userId, page) {
    const key = `feed:${userId}:${page}`
    const cached = await redisClient.get(key)
    return cached ? JSON.parse(cached) : null
  },

  // Cache trending videos
  async cacheTrendingVideos(videos) {
    const key = "trending:videos"
    await redisClient.setex(key, 600, JSON.stringify(videos)) // 10 minutes cache
  },

  async getCachedTrendingVideos() {
    const key = "trending:videos"
    const cached = await redisClient.get(key)
    return cached ? JSON.parse(cached) : null
  },

  // Cache video metadata
  async cacheVideoMetadata(videoId, metadata) {
    const key = `video:${videoId}:metadata`
    await redisClient.setex(key, 3600, JSON.stringify(metadata)) // 1 hour cache
  },

  async getCachedVideoMetadata(videoId) {
    const key = `video:${videoId}:metadata`
    const cached = await redisClient.get(key)
    return cached ? JSON.parse(cached) : null
  },

  // Invalidate user's feed cache when they upload/interact
  async invalidateUserFeedCache(userId) {
    const pattern = `feed:${userId}:*`
    const keys = await redisClient.keys(pattern)
    if (keys.length > 0) {
      await redisClient.del(...keys)
    }
  },
}

// New: Real-time engagement tracking
const engagementTracker = {
  // Track video views in real-time
  async trackVideoView(videoId, userId = null) {
    const viewKey = `video:${videoId}:views`
    const uniqueViewKey = `video:${videoId}:unique_views`

    // Increment total views
    await redisClient.incr(viewKey)

    // Track unique views if user is logged in
    if (userId) {
      await redisClient.sadd(uniqueViewKey, userId)
      await redisClient.expire(uniqueViewKey, 86400) // 24 hours
    }

    return await redisClient.get(viewKey)
  },

  // Get real-time engagement stats
  async getVideoEngagement(videoId) {
    const [views, uniqueViews, likes, comments] = await Promise.all([
      redisClient.get(`video:${videoId}:views`) || 0,
      redisClient.scard(`video:${videoId}:unique_views`) || 0,
      redisClient.get(`video:${videoId}:likes`) || 0,
      redisClient.get(`video:${videoId}:comments`) || 0,
    ])

    return {
      views: Number.parseInt(views),
      uniqueViews: Number.parseInt(uniqueViews),
      likes: Number.parseInt(likes),
      comments: Number.parseInt(comments),
    }
  },

  // Track likes in real-time
  async trackVideoLike(videoId, userId, isLike) {
    const likeKey = `video:${videoId}:likes`
    const userLikeKey = `video:${videoId}:user_likes`

    if (isLike) {
      await redisClient.incr(likeKey)
      await redisClient.sadd(userLikeKey, userId)
    } else {
      await redisClient.decr(likeKey)
      await redisClient.srem(userLikeKey, userId)
    }

    await redisClient.expire(userLikeKey, 86400) // 24 hours
    return await redisClient.get(likeKey)
  },

  // Check if user liked video
  async hasUserLikedVideo(videoId, userId) {
    const userLikeKey = `video:${videoId}:user_likes`
    return await redisClient.sismember(userLikeKey, userId)
  },
}

// New: User session management
const sessionManager = {
  // Track active users
  async trackActiveUser(userId) {
    const key = `active_users`
    await redisClient.sadd(key, userId)
    await redisClient.expire(key, 300) // 5 minutes
  },

  // Get active user count
  async getActiveUserCount() {
    const key = `active_users`
    return await redisClient.scard(key)
  },

  // User preference caching
  async cacheUserPreferences(userId, preferences) {
    const key = `user:${userId}:preferences`
    await redisClient.setex(key, 3600, JSON.stringify(preferences)) // 1 hour
  },

  async getUserPreferences(userId) {
    const key = `user:${userId}:preferences`
    const cached = await redisClient.get(key)
    return cached ? JSON.parse(cached) : null
  },
}

// Enhanced Redis manager class
class RedisManager {
  constructor() {
    this.client = redisClient
    this.publisher = redisPubClient
    this.subscriber = redisSubClient
    this.isConnected = false
  }

  // Your existing methods enhanced
  async get(key) {
    try {
      const value = await this.client.get(key)
      return value ? JSON.parse(value) : null
    } catch (error) {
      logger.error("Redis GET error:", error)
      return null
    }
  }

  async set(key, value, ttl = 3600) {
    try {
      await this.client.setex(key, ttl, JSON.stringify(value))
      return true
    } catch (error) {
      logger.error("Redis SET error:", error)
      return false
    }
  }

  async del(key) {
    try {
      await this.client.del(key)
      return true
    } catch (error) {
      logger.error("Redis DEL error:", error)
      return false
    }
  }

  // Pub/Sub for real-time features
  async publish(channel, message) {
    try {
      await this.publisher.publish(channel, JSON.stringify(message))
    } catch (error) {
      logger.error("Redis publish error:", error)
    }
  }

  async subscribe(channel, callback) {
    try {
      await this.subscriber.subscribe(channel)
      this.subscriber.on("message", (receivedChannel, message) => {
        if (receivedChannel === channel) {
          callback(JSON.parse(message))
        }
      })
    } catch (error) {
      logger.error("Redis subscribe error:", error)
    }
  }

  // Rate limiting (using your existing pattern)
  async checkRateLimit(key, limit, window) {
    try {
      const current = await this.client.incr(key)
      if (current === 1) {
        await this.client.expire(key, window)
      }
      return current <= limit
    } catch (error) {
      logger.error("Rate limit check error:", error)
      return true
    }
  }

  async gracefulShutdown() {
    logger.info("Closing Redis connections...")
    if (this.client) await this.client.quit()
    if (this.publisher) await this.publisher.quit()
    if (this.subscriber) await this.subscriber.quit()
    logger.info("Redis connections closed")
  }
}

// Create manager instance
const redisManager = new RedisManager()

module.exports = {
  // Your existing exports
  redisClient,
  redisPubClient,
  redisSubClient,
  viewerCounter,
  chatRateLimiter,

  // New enhanced utilities
  videoCache,
  engagementTracker,
  sessionManager,
  redisManager,
}
