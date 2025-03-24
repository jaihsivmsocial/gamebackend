const  User= require( "../model/userModel.js")
// const { redisCache } = require( "../config/redis.js")

const redisCache = async () => {
    const module = await import("../config/mongodb.js");
    return module.redisCache;
  };

class UserActivityService {
  constructor() {
    this.updateInterval = 60000 // Update MongoDB every minute
    this.userActivities = new Map() // Map of userId -> lastSeen timestamp
    this.timer = null
  }

  initialize() {
    this.timer = setInterval(() => this.flushToDatabase(), this.updateInterval)
    console.log("User activity service initialized")
  }

  async trackActivity(userId, isAnonymous = false) {
    if (isAnonymous) return // Don't track anonymous users in MongoDB

    const now = Date.now()
    this.userActivities.set(userId, now)

    // Also update in Redis for real-time queries
    await redisCache.hSet(`user:${userId}`, "lastSeen", now.toString())
  }

  async flushToDatabase() {
    if (this.userActivities.size === 0) return

    try {
      const bulkOps = Array.from(this.userActivities.entries()).map(([userId, lastSeen]) => ({
        updateOne: {
          filter: { _id: userId },
          update: { $set: { lastSeen: new Date(lastSeen) } },
        },
      }))

      // Clear the map before the database operation
      const userCount = this.userActivities.size
      this.userActivities.clear()

      // Update all users in a single bulk operation
      await User.bulkWrite(bulkOps, { ordered: false })
      console.log(`Updated lastSeen for ${userCount} users`)
    } catch (error) {
      console.error("Error updating user activity:", error)
    }
  }

  shutdown() {
    if (this.timer) {
      clearInterval(this.timer)
    }

    return this.flushToDatabase()
  }
}

module.exports= new UserActivityService()

