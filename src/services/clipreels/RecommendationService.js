const Video = require("../model/Video")
const { videoCache, engagementTracker, sessionManager } = require("../config/redis")
const { logger } = require("../utils/logger")

class RecommendationService {
  constructor() {
    this.weights = {
      userInteraction: 0.4,
      contentSimilarity: 0.3,
      trending: 0.2,
      recency: 0.1,
    }
  }

  async getPersonalizedFeed(userId, page = 1, limit = 10) {
    try {
      // Try cache first (using your Redis setup)
      const cachedFeed = await videoCache.getCachedVideoFeed(userId, page)
      if (cachedFeed) {
        return cachedFeed
      }

      // Track active user
      await sessionManager.trackActiveUser(userId)

      // Get user preferences from cache
      let userPreferences = await sessionManager.getUserPreferences(userId)
      if (!userPreferences) {
        userPreferences = await this.buildUserPreferences(userId)
        await sessionManager.cacheUserPreferences(userId, userPreferences)
      }

      // Generate recommendations
      const recommendations = await this.generateRecommendations(userId, userPreferences, page, limit)

      // Cache the feed
      await videoCache.cacheVideoFeed(userId, page, recommendations)

      return recommendations
    } catch (error) {
      logger.error("Personalized feed error:", error)
      return this.getTrendingFeed(page, limit)
    }
  }

  async buildUserPreferences(userId) {
    // Build preferences based on user interactions
    const interactions = await Video.aggregate([
      {
        $match: {
          $or: [{ "likes.userId": userId }, { "comments.userId": userId }],
        },
      },
      {
        $project: {
          tags: 1,
          username: 1,
          createdAt: 1,
        },
      },
      { $limit: 50 },
      { $sort: { createdAt: -1 } },
    ])

    const preferences = {
      preferredTags: {},
      preferredCreators: {},
    }

    interactions.forEach((interaction) => {
      interaction.tags?.forEach((tag) => {
        preferences.preferredTags[tag] = (preferences.preferredTags[tag] || 0) + 1
      })

      if (interaction.username) {
        preferences.preferredCreators[interaction.username] =
          (preferences.preferredCreators[interaction.username] || 0) + 1
      }
    })

    return preferences
  }

  async getTrendingFeed(page = 1, limit = 10) {
    try {
      // Try cache first
      if (page === 1) {
        const cachedTrending = await videoCache.getCachedTrendingVideos()
        if (cachedTrending) {
          return cachedTrending
        }
      }

      const skip = (page - 1) * limit
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

      const trending = await Video.aggregate([
        {
          $match: {
            isActive: true,
            createdAt: { $gte: oneDayAgo },
          },
        },
        {
          $addFields: {
            engagementScore: {
              $add: [
                { $multiply: [{ $size: "$likes" }, 3] },
                { $multiply: [{ $size: "$comments" }, 5] },
                { $multiply: ["$shares", 4] },
                { $multiply: ["$views", 1] },
              ],
            },
          },
        },
        { $sort: { engagementScore: -1, createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
      ])

      const result = {
        videos: trending,
        pagination: {
          page,
          limit,
          hasMore: trending.length === limit,
        },
        algorithm: "trending",
      }

      // Cache trending videos for first page
      if (page === 1) {
        await videoCache.cacheTrendingVideos(result)
      }

      return result
    } catch (error) {
      logger.error("Trending feed error:", error)
      throw error
    }
  }

  // Enhanced with real-time engagement tracking
  async updateUserEngagement(userId, videoId, action, duration = null) {
    try {
      // Track in real-time using your Redis setup
      if (action === "view") {
        await engagementTracker.trackVideoView(videoId, userId)
      } else if (action === "like") {
        await engagementTracker.trackVideoLike(videoId, userId, true)
      } else if (action === "unlike") {
        await engagementTracker.trackVideoLike(videoId, userId, false)
      }

      // Invalidate user's feed cache
      await videoCache.invalidateUserFeedCache(userId)

      // Publish real-time event
      const engagementData = {
        userId,
        videoId,
        action,
        duration,
        timestamp: new Date(),
      }

      // You can use your existing pub/sub setup
      // await redisPubClient.publish("user_engagement", JSON.stringify(engagementData))
    } catch (error) {
      logger.error("Update user engagement error:", error)
    }
  }
}

module.exports = new RecommendationService()
