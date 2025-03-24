const Redis = require("ioredis")

// Create separate Redis clients for different purposes
const redisClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379")
const redisPubClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379")
const redisSubClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379")

// Viewer counter utility
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

    // If count is 0 or negative, delete the key
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
    // Get all viewer keys for this stream
    const pattern = `viewer:${streamId}:*`
    const keys = await redisClient.keys(pattern)
    return keys.length
  },

  async syncViewerCount(streamId) {
    // Count actual active viewers
    const activeViewers = await this.getActiveViewers(streamId)

    // Update the count
    const key = `viewers:${streamId}`
    if (activeViewers === 0) {
      await redisClient.del(key)
    } else {
      await redisClient.set(key, activeViewers.toString())
      await redisClient.expire(key, 3600) // 1 hour TTL
    }

    return activeViewers
  },
}

// Chat rate limiter utility
const chatRateLimiter = {
  async checkLimit(userId, streamId) {
    const key = `ratelimit:chat:${userId}:${streamId}`
    const count = await redisClient.incr(key)

    if (count === 1) {
      await redisClient.expire(key, 10) // 10 seconds window
    }

    return count <= 5 // 5 messages per 10 seconds
  },
}

module.exports = {
  redisClient,
  redisPubClient,
  redisSubClient,
  viewerCounter,
  chatRateLimiter,
}

