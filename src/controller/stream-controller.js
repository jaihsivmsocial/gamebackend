const WebRTCService = require("../services/webrtc-service")
const { redisClient, viewerCounter } = require("../config/redis")
const Stream = require("../model/streamModel")
const mongoose = require("mongoose")

// Helper function to check if a string is a valid MongoDB ObjectId
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id)
}

exports.createStream = async (req, res) => {
  try {
    const { title, description, thumbnailUrl } = req.body
    const userId = req.user.id

    // Generate a unique streamId for the time-series collection
    const streamId = new mongoose.Types.ObjectId().toString()

    // Create a new stream in the database
    const stream = new Stream({
      streamId: streamId, // Use this as the metaField for time-series collection
      title,
      description,
      thumbnailUrl,
      broadcaster: userId,
      startTime: new Date(),
      status: "created",
      timestamp: new Date(), // Required for time-series collections
    })

    await stream.save()

    // Initialize WebRTC stream
    const result = await WebRTCService.initializeStream(streamId, userId)

    if (!result.success) {
      return res.status(500).json({ error: result.error })
    }

    // Update stream status - use updateMany with streamId (metaField)
    await Stream.updateMany(
      { streamId: streamId }, // Query by metaField
      { $set: { status: "ready" } },
    )

    // Notify all connected clients about the new stream
    req.io.emit("stream_created", {
      streamId: streamId,
      title,
      description,
      thumbnailUrl,
      broadcaster: {
        id: userId,
        username: req.user.username,
        profilePicture: req.user.profilePicture,
      },
    })

    return res.status(201).json({
      success: true,
      stream: {
        id: streamId,
        title,
        description,
        thumbnailUrl,
        status: "ready", // Use the updated status
      },
    })
  } catch (error) {
    console.error("Error creating stream:", error)
    return res.status(500).json({ error: "Failed to create stream" })
  }
}

exports.getStream = async (req, res) => {
  try {
    const { streamId } = req.params

    // Check if streamId is a valid ObjectId
    if (!isValidObjectId(streamId)) {
      // For non-ObjectId streamIds, return a simplified response
      const viewerCount = await viewerCounter.getViewerCount(streamId)
      return res.status(200).json({
        success: true,
        stream: {
          streamId: streamId,
          title: "Test Stream",
          description: "This is a test stream",
          status: "active",
          viewerCount,
          broadcaster: {
            username: "Test User",
            profilePicture: "/placeholder.svg?height=100&width=100",
          },
        },
      })
    }

    // Get stream from database - query by streamId (metaField)
    const stream = await Stream.findOne({ streamId }).populate("broadcaster", "username profilePicture").lean()

    if (!stream) {
      return res.status(404).json({ error: "Stream not found" })
    }

    // Get viewer count from Redis
    const viewerCount = await viewerCounter.getViewerCount(streamId)

    return res.status(200).json({
      success: true,
      stream: {
        ...stream,
        viewerCount,
      },
    })
  } catch (error) {
    console.error("Error getting stream:", error)
    return res.status(500).json({ error: "Failed to get stream" })
  }
}

exports.endStream = async (req, res) => {
  try {
    const { streamId } = req.params
    const userId = req.user.id

    // Check if streamId is a valid ObjectId
    if (!isValidObjectId(streamId)) {
      // For non-ObjectId streamIds, just return success
      return res.status(200).json({
        success: true,
        message: "Stream ended successfully",
      })
    }

    // Get stream from database - query by streamId (metaField)
    const stream = await Stream.findOne({ streamId })

    if (!stream) {
      return res.status(404).json({ error: "Stream not found" })
    }

    // Check if user is the broadcaster
    if (stream.broadcaster.toString() !== userId) {
      return res.status(403).json({ error: "Unauthorized" })
    }

    // End WebRTC stream
    const result = await WebRTCService.endStream(streamId, userId)

    if (!result.success) {
      return res.status(500).json({ error: result.error })
    }

    // Update stream status - use updateMany with streamId (metaField)
    await Stream.updateMany(
      { streamId: streamId }, // Query by metaField
      {
        $set: {
          status: "ended",
          endTime: new Date(),
        },
      },
    )

    // Notify all connected clients about the ended stream
    req.io.emit("stream_ended", {
      streamId,
    })

    return res.status(200).json({
      success: true,
      message: "Stream ended successfully",
    })
  } catch (error) {
    console.error("Error ending stream:", error)
    return res.status(500).json({ error: "Failed to end stream" })
  }
}

exports.getActiveStreams = async (req, res) => {
  try {
    // Get active streams from database - query by status
    const streams = await Stream.find({ status: "active" })
      .populate("broadcaster", "username profilePicture")
      .sort({ startTime: -1 })
      .lean()

    // Get viewer counts from Redis
    const streamIds = streams.map((stream) => stream.streamId)

    // Add default test streams for testing
    const testStreamIds = ["default-stream", "stream-1", "stream-2", "stream-3", "stream-4"]
    const allStreamIds = [...streamIds, ...testStreamIds]

    const viewerCounts = await Promise.all(
      allStreamIds.map(async (id) => {
        return {
          id,
          count: await viewerCounter.getViewerCount(id),
        }
      }),
    )

    // Map viewer counts to streams
    const streamsWithViewerCounts = streams.map((stream) => {
      const viewerCount = viewerCounts.find((vc) => vc.id === stream.streamId)?.count || 0
      return {
        ...stream,
        viewerCount,
      }
    })

    // Add test streams for frontend testing
    const testStreams = testStreamIds.map((id) => {
      const viewerCount = viewerCounts.find((vc) => vc.id === id)?.count || 0
      return {
        streamId: id,
        title: `Test Stream ${id}`,
        description: "This is a test stream for development",
        thumbnailUrl: "/placeholder.svg?height=300&width=400",
        status: "active",
        viewerCount,
        broadcaster: {
          _id: "test-user",
          username: "Test User",
          profilePicture: "/placeholder.svg?height=100&width=100",
        },
      }
    })

    return res.status(200).json({
      success: true,
      streams: [...streamsWithViewerCounts, ...testStreams],
    })
  } catch (error) {
    console.error("Error getting active streams:", error)
    return res.status(500).json({ error: "Failed to get active streams" })
  }
}

exports.getStreamStats = async (req, res) => {
  try {
    const { streamId } = req.params

    // Check if streamId is a valid ObjectId
    if (!isValidObjectId(streamId)) {
      // For non-ObjectId streamIds, return dummy stats
      const viewerCount = await viewerCounter.getViewerCount(streamId)
      return res.status(200).json({
        success: true,
        stats: {
          streamId,
          viewerCount,
          peakViewers: viewerCount,
          totalViewers: viewerCount * 2, // Just a dummy calculation
          duration: 3600, // 1 hour in seconds
        },
      })
    }

    // Get stream stats from WebRTC service
    const result = await WebRTCService.getStreamStats(streamId)

    if (!result.success) {
      return res.status(404).json({ error: result.error })
    }

    return res.status(200).json({
      success: true,
      stats: result.stats,
    })
  } catch (error) {
    console.error("Error getting stream stats:", error)
    return res.status(500).json({ error: "Failed to get stream stats" })
  }
}

exports.getViewerCount = async (req, res) => {
  try {
    const { streamId } = req.params

    // Get viewer count from Redis
    const viewerCount = await viewerCounter.getViewerCount(streamId)

    return res.status(200).json({
      success: true,
      streamId,
      viewerCount,
    })
  } catch (error) {
    console.error("Error getting viewer count:", error)
    return res.status(500).json({ error: "Failed to get viewer count" })
  }
}

exports.getTopStreams = async (req, res) => {
  try {
    // Get limit from query params, default to 10
    const limit = Number.parseInt(req.query.limit) || 10

    // Get active streams from database
    const streams = await Stream.find({ status: "active" }).populate("broadcaster", "username profilePicture").lean()

    // Add test streams
    const testStreamIds = ["default-stream", "stream-1", "stream-2", "stream-3", "stream-4"]
    const testStreams = testStreamIds.map((id) => ({
      streamId: id,
      title: `Test Stream ${id}`,
      description: "This is a test stream for development",
      thumbnailUrl: "/placeholder.svg?height=300&width=400",
      status: "active",
      broadcaster: {
        _id: "test-user",
        username: "Test User",
        profilePicture: "/placeholder.svg?height=100&width=100",
      },
    }))

    const allStreams = [...streams, ...testStreams]

    // Get viewer counts from Redis
    const streamIds = allStreams.map((stream) => stream.streamId)
    const viewerCounts = await Promise.all(
      streamIds.map(async (id) => {
        return {
          id,
          count: await viewerCounter.getViewerCount(id),
        }
      }),
    )

    // Map viewer counts to streams
    const streamsWithViewerCounts = allStreams.map((stream) => {
      const viewerCount = viewerCounts.find((vc) => vc.id === stream.streamId)?.count || 0
      return {
        ...stream,
        viewerCount,
      }
    })

    // Sort by viewer count (descending) and limit
    const topStreams = streamsWithViewerCounts.sort((a, b) => b.viewerCount - a.viewerCount).slice(0, limit)

    return res.status(200).json({
      success: true,
      streams: topStreams,
    })
  } catch (error) {
    console.error("Error getting top streams:", error)
    return res.status(500).json({ error: "Failed to get top streams" })
  }
}

exports.getStreamAnalytics = async (req, res) => {
  try {
    const userId = req.user.id
    const { timeframe } = req.query // 'day', 'week', 'month', 'all'

    // Define date range based on timeframe
    let startDate = new Date()
    switch (timeframe) {
      case "day":
        startDate.setDate(startDate.getDate() - 1)
        break
      case "week":
        startDate.setDate(startDate.getDate() - 7)
        break
      case "month":
        startDate.setMonth(startDate.getMonth() - 1)
        break
      default:
        startDate = new Date(0) // Beginning of time
    }

    // Get streams for this user within the timeframe
    const streams = await Stream.find({
      broadcaster: userId,
      startTime: { $gte: startDate },
    }).lean()

    // Calculate analytics
    const totalStreams = streams.length
    const totalDuration = streams.reduce((total, stream) => {
      const endTime = stream.endTime || new Date()
      return total + (endTime - stream.startTime)
    }, 0)
    const totalViewers = streams.reduce((total, stream) => total + (stream.metrics?.totalViewers || 0), 0)
    const peakViewers = Math.max(...streams.map((stream) => stream.metrics?.peakViewers || 0), 0)
    const totalMessages = streams.reduce((total, stream) => total + (stream.metrics?.totalMessages || 0), 0)

    return res.status(200).json({
      success: true,
      analytics: {
        totalStreams,
        totalDuration: Math.floor(totalDuration / 1000), // Convert to seconds
        totalViewers,
        peakViewers,
        totalMessages,
        averageViewersPerStream: totalStreams > 0 ? Math.round(totalViewers / totalStreams) : 0,
        averageDurationPerStream: totalStreams > 0 ? Math.floor(totalDuration / totalStreams / 1000) : 0, // In seconds
      },
      streams,
    })
  } catch (error) {
    console.error("Error getting stream analytics:", error)
    return res.status(500).json({ error: "Failed to get stream analytics" })
  }
}

// Update metrics for a stream - used by socket-manager.js
exports.updateStreamMetrics = async (streamId, viewerCount) => {
  try {
    if (!isValidObjectId(streamId)) {
      return { success: false, error: "Invalid stream ID" }
    }

    // Use updateMany with streamId (metaField)
    await Stream.updateMany(
      { streamId: streamId }, // Query by metaField
      {
        $max: { "metrics.peakViewers": viewerCount },
        $inc: { "metrics.totalViewers": 1 },
      },
    )

    return { success: true }
  } catch (error) {
    console.error("Error updating stream metrics:", error)
    return { success: false, error: error.message }
  }
}

// Increment message count for a stream - used by socket-manager.js
exports.incrementMessageCount = async (streamId) => {
  try {
    if (!isValidObjectId(streamId)) {
      return { success: false, error: "Invalid stream ID" }
    }

    // Use updateMany with streamId (metaField)
    await Stream.updateMany(
      { streamId: streamId }, // Query by metaField
      { $inc: { "metrics.totalMessages": 1 } },
    )

    return { success: true }
  } catch (error) {
    console.error("Error incrementing message count:", error)
    return { success: false, error: error.message }
  }
}

exports.incrementViewerCount = async (req, res) => {
  try {
    const { streamId } = req.params

    // Get client ID from headers
    const clientId = req.headers["x-client-id"] || req.ip
    const viewerKey = `viewer:${streamId}:${clientId}`

    // Check if this client is already counted
    const isAlreadyCounted = await redisClient.get(viewerKey)

    if (!isAlreadyCounted) {
      // Mark this client as counted for this stream
      await redisClient.set(viewerKey, "1", "EX", 3600) // Expires in 1 hour

      // Increment viewer count in Redis
      const viewerCount = await viewerCounter.incrementViewers(streamId)

      // Broadcast the updated count to all connected clients
      if (req.io) {
        req.io.emit("viewer_count", { streamId, count: viewerCount })
      }

      // Update stream metrics in MongoDB only if streamId is a valid ObjectId
      if (isValidObjectId(streamId)) {
        await this.updateStreamMetrics(streamId, viewerCount)
      }

      return res.status(200).json({
        success: true,
        streamId,
        viewerCount,
      })
    } else {
      // Client already counted, just return current count
      const viewerCount = await viewerCounter.getViewerCount(streamId)
      return res.status(200).json({
        success: true,
        streamId,
        viewerCount,
      })
    }
  } catch (error) {
    console.error("Error incrementing viewer count:", error)
    return res.status(500).json({ error: "Failed to increment viewer count" })
  }
}

exports.decrementViewerCount = async (req, res) => {
  try {
    const { streamId } = req.params

    // Get client ID from headers
    const clientId = req.headers["x-client-id"] || req.ip
    const viewerKey = `viewer:${streamId}:${clientId}`

    // Check if this client was counted
    const wasCounted = await redisClient.get(viewerKey)

    if (wasCounted) {
      // Remove this client from counted viewers
      await redisClient.del(viewerKey)

      // Decrement viewer count in Redis
      const viewerCount = await viewerCounter.decrementViewers(streamId)

      // Broadcast the updated count to all connected clients
      if (req.io) {
        req.io.emit("viewer_count", { streamId, count: viewerCount })
      }

      return res.status(200).json({
        success: true,
        streamId,
        viewerCount,
      })
    } else {
      // Client wasn't counted, just return current count
      const viewerCount = await viewerCounter.getViewerCount(streamId)
      return res.status(200).json({
        success: true,
        streamId,
        viewerCount,
      })
    }
  } catch (error) {
    console.error("Error decrementing viewer count:", error)
    return res.status(500).json({ error: "Failed to decrement viewer count" })
  }
}

