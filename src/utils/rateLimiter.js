const { redisClient } = require("../config/redis")

/**
 * Chat rate limiter utility
 * Prevents users from sending too many messages in a short period
 */
const chatRateLimiter = {
  /**
   * Check if a user has exceeded their rate limit
   * @param {string} userId - The user ID
   * @param {string} streamId - The stream ID
   * @returns {Promise<boolean>} - True if the user can send a message, false if rate limited
   */
  async checkLimit(userId, streamId) {
    try {
      // Create a key for this user and stream
      const key = `ratelimit:chat:${userId}:${streamId}`

      // Sliding window approach for rate limiting
      const now = Date.now()
      const windowKey = `${key}:window`
      const counterKey = `${key}:counter`

      // Window size: 10 seconds, max messages: 5
      const windowSize = 10000 // 10 seconds in milliseconds
      const maxMessages = 5 // Maximum messages per window

      // Get current count
      const count = await redisClient.incr(counterKey)

      // Set expiry on first message
      if (count === 1) {
        await redisClient.expire(counterKey, 10) // 10 seconds window
      }

      // Check if user is sending too many messages in the window
      if (count > maxMessages) {
        return false
      }

      // Check for burst messages (too many messages in quick succession)
      const burstKey = `${key}:burst`
      const burstCount = await redisClient.incr(burstKey)

      // Set short expiry for burst counter
      if (burstCount === 1) {
        await redisClient.expire(burstKey, 1) // 1 second window for burst
      }

      // If user is sending too many messages in quick succession
      if (burstCount > 3) {
        // Max 3 messages per second
        return false
      }

      // Record this message timestamp in the window
      await redisClient.zadd(windowKey, now, `${now}`)
      await redisClient.expire(windowKey, Math.ceil(windowSize / 1000))

      // Clean up old timestamps
      await redisClient.zremrangebyscore(windowKey, 0, now - windowSize)

      return true
    } catch (error) {
      console.error("Rate limit check error:", error)
      // In case of error, allow the message to prevent blocking legitimate users
      return true
    }
  },

  /**
   * Get remaining messages allowed for a user
   * @param {string} userId - The user ID
   * @param {string} streamId - The stream ID
   * @returns {Promise<number>} - Number of messages remaining before rate limit
   */
  async getRemainingMessages(userId, streamId) {
    try {
      const key = `ratelimit:chat:${userId}:${streamId}:counter`
      const count = await redisClient.get(key)

      if (!count) return 5 // Default max if no count exists

      return Math.max(0, 5 - Number.parseInt(count, 10))
    } catch (error) {
      console.error("Error getting remaining messages:", error)
      return 0
    }
  },

  /**
   * Reset rate limit for a user
   * @param {string} userId - The user ID
   * @param {string} streamId - The stream ID
   */
  async resetLimit(userId, streamId) {
    try {
      const baseKey = `ratelimit:chat:${userId}:${streamId}`
      await redisClient.del(`${baseKey}:counter`)
      await redisClient.del(`${baseKey}:window`)
      await redisClient.del(`${baseKey}:burst`)
    } catch (error) {
      console.error("Error resetting rate limit:", error)
    }
  },
}

module.exports = chatRateLimiter

