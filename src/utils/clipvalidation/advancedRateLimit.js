const { redisClient, chatRateLimiter } = require("../config/redis")
const { logger } = require("../utils/logger")

class AdvancedRateLimit {
  constructor() {
    // Use your existing Redis client
    this.redis = redisClient

    this.limits = {
      upload: { requests: 5, window: 3600, burst: 2 },
      like: { requests: 100, window: 60, burst: 10 },
      comment: { requests: 30, window: 60, burst: 5 },
      view: { requests: 1000, window: 60, burst: 50 },
      general: { requests: 1000, window: 60, burst: 100 },
    }
  }

  // Enhanced version using your existing rate limiter pattern
  async checkLimit(userId, action, customLimit = null) {
    const limit = customLimit || this.limits[action]
    if (!limit) return true

    // Use your existing chatRateLimiter pattern for video interactions
    if (action === "comment") {
      return await chatRateLimiter.checkVideoInteractionLimit(userId, action)
    }

    const key = `ratelimit:${action}:${userId}`
    const count = await this.redis.incr(key)

    if (count === 1) {
      await this.redis.expire(key, limit.window)
    }

    return count <= limit.requests
  }

  // Middleware factory using your Redis setup
  createRateLimit(type = "general") {
    return async (req, res, next) => {
      try {
        const userId = req.user?.id || req.ip
        const allowed = await this.checkLimit(userId, type)

        if (!allowed) {
          logger.warn(`Rate limit exceeded for ${type}:${userId}`)
          return res.status(429).json({
            success: false,
            message: "Rate limit exceeded",
            retryAfter: this.limits[type]?.window || 60,
            type: "rate_limit_exceeded",
          })
        }

        next()
      } catch (error) {
        logger.error("Rate limit middleware error:", error)
        next() // Allow on error
      }
    }
  }

  // DDoS protection using your Redis client
  async detectDDoS(ip) {
    try {
      const ddosKey = `ddos:${ip}`
      const requests = await this.redis.incr(ddosKey)

      if (requests === 1) {
        await this.redis.expire(ddosKey, 60)
      }

      if (requests > 500) {
        logger.warn(`Potential DDoS detected from IP: ${ip}`)
        await this.redis.setex(`blocked:${ip}`, 3600, "true")
        return true
      }

      return false
    } catch (error) {
      logger.error("DDoS detection error:", error)
      return false
    }
  }
}

module.exports = new AdvancedRateLimit()
