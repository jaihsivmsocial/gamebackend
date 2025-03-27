
// const { Server } = require("socket.io")
// const { createAdapter } = require("@socket.io/redis-adapter")
// const { redisClient, redisPubClient, redisSubClient, viewerCounter, chatRateLimiter } = require("../config/redis")
// const Stream = require("../model/streamModel")
// // const { nanoid } = require("nanoid")
// const mongoose = require("mongoose")
// const streamController = require("../controller/stream-controller")
// // const chatRateLimiter = require("../utils/rateLimiter") // Import the rate limiter

// async function generateId() {
//   const { nanoid } = await import("nanoid")
//   console.log(nanoid())
// }

// // Helper function for default avatars
// function getDefaultAvatar(anonymousId, username) {
//   const styles = ["adventurer", "avataaars", "bottts", "jdenticon"]
//   const firstChar = (username || "a").charAt(0).toLowerCase()
//   const styleIndex = firstChar.charCodeAt(0) % styles.length
//   const style = styles[styleIndex]
//   return `https://avatars.dicebear.com/api/${style}/${username || anonymousId}.svg`
// }

// // Helper function to check if a string is a valid MongoDB ObjectId
// function isValidObjectId(id) {
//   return mongoose.Types.ObjectId.isValid(id)
// }



// module.exports = async function setupSocketIO(server) {
//   // Create Socket.IO server with Redis adapter for horizontal scaling
//   const io = new Server(server, {
//     cors: {
//       origin: process.env.FRONTEND_URL || "http://localhost:3000",
//       methods: ["GET", "POST"],
//       credentials: true,
//     },
//     adapter: createAdapter(redisPubClient, redisSubClient), // Use separate pub/sub clients
//     transports: ["websocket", "polling"],
//     pingTimeout: 60000,
//     pingInterval: 25000,
//     maxHttpBufferSize: 1e6,
//   })

//   // Set up Redis pub/sub for efficient message distribution
//   const chatSubscriber = setupRedisPubSub(io)

//   // Reset all viewer counts on server start
//   await resetAllViewerCounts()

//   // Set up a periodic cleanup task to remove stale viewers
//   setInterval(cleanupStaleViewers, 60 * 1000) // Run every minute for more frequent cleanup

//   // Middleware to set up user data
//   io.use((socket, next) => {
//     try {
//       const token = socket.handshake.auth.token
//       const anonymousId = socket.handshake.auth.anonymousId || `anon-${generateId(8)}`
//       const customUsername = socket.handshake.auth.customUsername || "Anonymous"
//       const customProfilePicture = socket.handshake.auth.customProfilePicture

//       // Set up user object
//       if (token) {
//         try {
//           // For authenticated users, verify token and get user info
//           // This is simplified - in production you would verify the JWT
//           socket.user = {
//             id: "user-id-from-token",
//             username: "username-from-token",
//             profilePicture: "/placeholder.svg?height=30&width=30", // Use a valid URL format
//             isAnonymous: false,
//           }
//         } catch (error) {
//           // Token verification failed, use custom profile
//           socket.user = {
//             id: anonymousId,
//             username: customUsername,
//             profilePicture: customProfilePicture || getDefaultAvatar(anonymousId, customUsername),
//             isAnonymous: true,
//           }
//         }
//       } else {
//         // For anonymous users, use their custom profile
//         socket.user = {
//           id: anonymousId,
//           username: customUsername,
//           profilePicture: customProfilePicture || getDefaultAvatar(anonymousId, customUsername),
//           isAnonymous: true,
//         }
//       }

//       next()
//     } catch (error) {
//       next(new Error("Authentication failed"))
//     }
//   })

//   // Handle connections
//   io.on("connection", (socket) => {
//     console.log(`User connected: ${socket.id}`)

//     // Track which streams this socket is watching
//     const watchingStreams = new Set()

//     // Heartbeat to verify active viewers
//     socket.on("heartbeat", async ({ streamIds }) => {
//       if (!Array.isArray(streamIds)) return

//       console.log(`Received heartbeat from ${socket.id} for streams:`, streamIds)

//       // Verify each stream this client claims to be watching
//       for (const streamId of streamIds) {
//         const viewerKey = `viewer:${streamId}:${socket.id}`
//         // Extend the TTL for this viewer
//         await redisClient.expire(viewerKey, 120) // 2 minutes
//       }
//     })

//     // Join stream room
//     socket.on("join_stream", async ({ streamId }) => {
//       try {
//         if (!streamId) return

//         console.log(`User ${socket.id} attempting to join stream: ${streamId}`)

//         // Join a single room for the stream
//         const roomName = `stream:${streamId}`

//         // Check if socket is already in this room to prevent duplicate counts
//         const isInRoom = Array.from(socket.rooms).includes(roomName)
//         if (isInRoom) {
//           console.log(`User ${socket.id} already in stream: ${streamId}`)
//           return
//         }

//         // First, leave any other streams this socket might be watching
//         // This ensures a user can only watch one stream at a time for accurate counting
//         for (const currentStreamId of watchingStreams) {
//           if (currentStreamId !== streamId) {
//             await leaveStream(socket, currentStreamId)
//           }
//         }

//         // Check if this viewer is already counted in Redis
//         const viewerKey = `viewer:${streamId}:${socket.id}`
//         const exists = await redisClient.exists(viewerKey)
//         if (exists) {
//           console.log(`User ${socket.id} already counted for stream: ${streamId}`)
//           // Just refresh the TTL without incrementing count
//           await redisClient.expire(viewerKey, 120) // Expires in 2 minutes if no heartbeat
//           return
//         }

//         socket.join(roomName)
//         watchingStreams.add(streamId)
//         console.log(`User ${socket.id} joined stream: ${streamId}`)

//         // Store this connection in Redis to track unique viewers
//         await redisClient.set(viewerKey, "1", "EX", 120) // Expires in 2 minutes if no heartbeat

//         // Increment viewer count using the viewerCounter utility
//         const viewerCount = await viewerCounter.incrementViewers(streamId)
//         console.log(`Updated viewer count for ${streamId}: ${viewerCount}`)

//         // Broadcast viewer count to all clients (not just those in the room)
//         io.emit("viewer_count", { streamId, count: viewerCount })

//         // Update stream metrics in MongoDB only if streamId is a valid ObjectId
//         if (isValidObjectId(streamId)) {
//           await streamController.updateStreamMetrics(streamId, viewerCount)
//         }

//         // Send recent messages from Redis to the newly connected client
//         const recentMessages = await getRecentMessages(streamId)
//         if (recentMessages.length > 0) {
//           socket.emit("recent_messages", recentMessages)
//         }
//       } catch (error) {
//         console.error("Join stream error:", error)
//         socket.emit("error", { message: "Failed to join stream" })
//       }
//     })

//     // Helper function to leave a stream
//     async function leaveStream(socket, streamId) {
//       try {
//         if (!streamId) return

//         console.log(`User ${socket.id} leaving stream: ${streamId}`)

//         const roomName = `stream:${streamId}`

//         // Check if socket is actually in this room
//         const isInRoom = Array.from(socket.rooms).includes(roomName)
//         if (!isInRoom) {
//           console.log(`User ${socket.id} not in stream: ${streamId}, skipping leave`)
//           return
//         }

//         socket.leave(roomName)
//         watchingStreams.delete(streamId)
//         console.log(`User ${socket.id} left stream: ${streamId}`)

//         // Remove this connection from Redis
//         const viewerKey = `viewer:${streamId}:${socket.id}`
//         await redisClient.del(viewerKey)

//         // Decrement viewer count using the viewerCounter utility
//         const viewerCount = await viewerCounter.decrementViewers(streamId)
//         console.log(`Updated viewer count for ${streamId}: ${viewerCount}`)

//         // Broadcast to all clients (not just those in the room)
//         io.emit("viewer_count", { streamId, count: viewerCount })
//       } catch (error) {
//         console.error("Leave stream error:", error)
//       }
//     }

//     // Handle leave stream
//     socket.on("leave_stream", async ({ streamId }) => {
//       await leaveStream(socket, streamId)
//     })

//     // Handle disconnection
//     socket.on("disconnect", async () => {
//       try {
//         console.log(`User disconnecting: ${socket.id}, was watching streams:`, Array.from(watchingStreams))

//         // Leave all streams this socket was watching
//         for (const streamId of watchingStreams) {
//           await leaveStream(socket, streamId)
//         }

//         console.log(`User disconnected: ${socket.id}`)
//       } catch (error) {
//         console.error("Disconnect error:", error)
//       }
//     })

//     // WebRTC signaling - Broadcaster offer
//     socket.on("broadcaster_offer", async ({ streamId, offer }) => {
//       try {
//         console.log(`Received broadcaster offer for stream: ${streamId}`)

//         // Forward the offer to all viewers in the room
//         socket.to(`stream:${streamId}`).emit("broadcaster_offer", { streamId, offer })

//         // Update stream status to active only if streamId is a valid ObjectId
//         if (isValidObjectId(streamId)) {
//           await Stream.updateMany({ streamId: streamId }, { $set: { status: "active" } })
//         }

//         // Notify all clients that the stream is active
//         io.emit("stream_active", { streamId })
//       } catch (error) {
//         console.error("Broadcaster offer error:", error)
//         socket.emit("error", { message: "Failed to process offer" })
//       }
//     })

//     // WebRTC signaling - Viewer request
//     socket.on("viewer_request", async ({ streamId }) => {
//       try {
//         console.log(`Received viewer request for stream: ${streamId}`)

//         // Forward the request to the broadcaster
//         socket.to(`stream:${streamId}`).emit("viewer_request", {
//           streamId,
//           viewerId: socket.id,
//         })
//       } catch (error) {
//         console.error("Viewer request error:", error)
//         socket.emit("error", { message: "Failed to connect to stream" })
//       }
//     })

//     // WebRTC signaling - Viewer offer
//     socket.on("viewer_offer", async ({ streamId, offer, viewerId }) => {
//       try {
//         console.log(`Received viewer offer for stream: ${streamId}`)

//         if (viewerId) {
//           // Forward the offer to the specific viewer
//           io.to(viewerId).emit("viewer_offer", {
//             streamId,
//             offer,
//           })
//         } else {
//           // Forward the offer to all viewers in the room
//           socket.to(`stream:${streamId}`).emit("viewer_offer", {
//             streamId,
//             offer,
//           })
//         }
//       } catch (error) {
//         console.error("Viewer offer error:", error)
//         socket.emit("error", { message: "Failed to process offer" })
//       }
//     })

//     // WebRTC signaling - Viewer answer
//     socket.on("viewer_answer", async ({ streamId, answer }) => {
//       try {
//         console.log(`Received viewer answer for stream: ${streamId}`)

//         // Forward the answer to the broadcaster
//         socket.to(`stream:${streamId}`).emit("viewer_answer", {
//           streamId,
//           answer,
//           viewerId: socket.id,
//         })
//       } catch (error) {
//         console.error("Viewer answer error:", error)
//         socket.emit("error", { message: "Failed to process answer" })
//       }
//     })

//     // WebRTC signaling - ICE candidate
//     socket.on("ice_candidate", async ({ streamId, candidate, isViewer, viewerId }) => {
//       try {
//         console.log(`Received ICE candidate for stream: ${streamId}, isViewer: ${isViewer}`)

//         if (viewerId) {
//           // Forward to specific viewer
//           io.to(viewerId).emit("ice_candidate", {
//             streamId,
//             candidate,
//             isViewer,
//           })
//         } else if (isViewer) {
//           // Forward viewer's ICE candidate to the broadcaster
//           socket.to(`stream:${streamId}`).emit("ice_candidate", {
//             streamId,
//             candidate,
//             viewerId: socket.id,
//             isViewer,
//           })
//         } else {
//           // Forward broadcaster's ICE candidate to all viewers
//           socket.to(`stream:${streamId}`).emit("ice_candidate", {
//             streamId,
//             candidate,
//             isViewer,
//           })
//         }
//       } catch (error) {
//         console.error("ICE candidate error:", error)
//         socket.emit("error", { message: "Failed to process ICE candidate" })
//       }
//     })

//     // Handle chat messages
//     socket.on("send_message", async ({ content, streamId }) => {
//       try {
//         if (!content.trim() || !streamId) return

//         // Check rate limiting - with enhanced feedback
//         const canSend = await checkRateLimit(socket.user.id, streamId)
//         if (!canSend) {
//           socket.emit("error", {
//             message: "Rate limit exceeded. Please wait before sending more messages.",
//             code: "RATE_LIMIT",
//             retryAfter: 2, // Suggest retry after 2 seconds
//           })
//           return
//         }

//         const messageId = `msg-${Date.now()}-${generateId(6)}`
//         const timestamp = Date.now()

//         // Get the real username from socket.handshake.auth if available
//         const realUsername = socket.handshake.auth.realUsername || socket.user.username

//         // Create message object with real username
//         const message = {
//           id: messageId,
//           content,
//           streamId,
//           timestamp,
//           sender: {
//             id: socket.user.id,
//             username: realUsername, // Use real username instead of anonymous
//             profilePicture: socket.user.profilePicture,
//             isAnonymous: socket.user.isAnonymous,
//           },
//         }

//         // For extremely high volume streams, use sharded message storage
//         // This helps distribute the load across Redis instances
//         const streamShard = getStreamShard(streamId)
//         const messageKey = `messages:${streamShard}:${streamId}`

//         // Store in Redis for recent messages - with optimized storage
//         await storeMessage(messageKey, message)

//         // For high-volume streams, use a pub/sub approach instead of room broadcasting
//         // This is more efficient for very large numbers of recipients
//         redisPubClient.publish(
//           `chat:${streamId}`,
//           JSON.stringify({
//             type: "new_message",
//             message,
//           }),
//         )

//         // Also emit to socket room for backward compatibility
//         socket.to(`stream:${streamId}`).emit("new_message", message)

//         // Increment message count in stream metrics only if streamId is a valid ObjectId
//         if (isValidObjectId(streamId)) {
//           // Use a more efficient counter increment for high volume
//           await incrementMessageCounter(streamId)
//         }
//       } catch (error) {
//         console.error("Send message error:", error)
//         socket.emit("error", { message: "Failed to send message" })
//       }
//     })

//     // Handle view mode change
//     socket.on("change_view_mode", ({ streamId, mode }) => {
//       // This is just for UI state, no backend processing needed
//       // But we can track analytics if desired
//       console.log(`User ${socket.id} changed view mode to ${mode} for stream ${streamId}`)
//     })

//     // Handle camera selection
//     socket.on("select_camera", ({ streamId, cameraId }) => {
//       // This is just for UI state, no backend processing needed
//       console.log(`User ${socket.id} selected camera ${cameraId} for stream ${streamId}`)
//     })
//   })

//   async function checkRateLimit(userId, streamId) {
//     return await chatRateLimiter.checkLimit(userId, streamId)
//   }

//   // Helper function to get a shard key for a stream
//   // This helps distribute data across Redis instances for high-volume streams
//   function getStreamShard(streamId) {
//     // Simple sharding based on the last character of the streamId
//     // In production, you would use a more sophisticated sharding strategy
//     return streamId.slice(-1).charCodeAt(0) % 10
//   }

//   // More efficient counter increment for high message volumes
//   async function incrementMessageCounter(streamId) {
//     // Use a batched counter approach to reduce Redis operations
//     const counterKey = `msgcount:${streamId}`
//     const batchKey = `msgcount:batch:${streamId}`

//     // Increment the batch counter
//     await redisClient.incr(batchKey)

//     // Every 100 messages, update the main counter and reset the batch
//     const batchCount = await redisClient.get(batchKey)
//     if (batchCount && Number.parseInt(batchCount) >= 100) {
//       await redisClient.incrby(counterKey, Number.parseInt(batchCount))
//       await redisClient.set(batchKey, 0)

//       // Update the stream metrics in MongoDB in batches
//       streamController
//         .incrementMessageCountBatch(streamId, Number.parseInt(batchCount))
//         .catch((err) => console.error(`Failed to update message count for ${streamId}:`, err))
//     }
//   }

//   async function storeMessage(key, message) {
//     // Use pipeline for better performance with high message volumes
//     await redisClient
//       .multi()
//       .zadd(key, message.timestamp, JSON.stringify(message))
//       .zremrangebyrank(key, 0, -101) // Keep only the latest 100 messages
//       .expire(key, 86400) // 24 hours TTL
//       .exec()

//     // For extremely high volume streams, we can also implement message archiving
//     // This would move older messages to a more permanent storage solution
//     if (Math.random() < 0.01) {
//       // 1% chance to check if archiving is needed
//       checkMessageArchiving(key).catch((err) => console.error(`Error checking message archiving for ${key}:`, err))
//     }
//   }

//   // Function to check if messages need to be archived
//   async function checkMessageArchiving(key) {
//     // Get count of messages in this stream
//     const count = await redisClient.zcard(key)

//     // If we have a lot of messages, archive the older ones
//     if (count > 1000) {
//       // In a real implementation, this would move older messages to a database
//       // For now, we'll just log that archiving would happen
//       console.log(`Would archive older messages for ${key}, current count: ${count}`)

//       // In production, you would:
//       // 1. Get the oldest messages
//       // 2. Store them in a database
//       // 3. Remove them from Redis
//     }
//   }

//   // Set up Redis pub/sub for chat messages
//   // This is more efficient than Socket.IO rooms for very high volumes
//   function setupRedisPubSub(io) {
//     const subscriber = redisSubClient.duplicate()

//     subscriber.on("message", (channel, message) => {
//       if (channel.startsWith("chat:")) {
//         const streamId = channel.split(":")[1]
//         const data = JSON.parse(message)

//         // Broadcast to all clients in the stream room
//         io.to(`stream:${streamId}`).emit(data.type, data.message)
//       }
//     })

//     // Subscribe to all chat channels
//     subscriber.psubscribe("chat:*")

//     return subscriber
//   }

//   async function getRecentMessages(streamId) {
//     const streamShard = getStreamShard(streamId)
//     const key = `messages:${streamShard}:${streamId}`
//     const messages = await redisClient.zrevrange(key, 0, 49) // Get latest 50 messages
//     return messages.map((msg) => JSON.parse(msg)).reverse() // Oldest first
//   }

//   // Reset all viewer counts
//   async function resetAllViewerCounts() {
//     try {
//       // Get all viewer count keys
//       const keys = await redisClient.keys("viewers:*")

//       // Delete all viewer count keys
//       if (keys.length > 0) {
//         await redisClient.del(...keys)
//         console.log(`Reset ${keys.length} viewer counts on server start`)
//       }

//       // Also delete all viewer tracking keys
//       const viewerKeys = await redisClient.keys("viewer:*")
//       if (viewerKeys.length > 0) {
//         // Delete in batches to avoid Redis command timeout
//         const batchSize = 1000
//         for (let i = 0; i < viewerKeys.length; i += batchSize) {
//           const batch = viewerKeys.slice(i, i + batchSize)
//           await redisClient.del(...batch)
//         }
//         console.log(`Reset ${viewerKeys.length} viewer tracking keys on server start`)
//       }

//       // Set all active streams to have 0 viewers
//       const streamIds = await Stream.distinct("streamId")
//       for (const streamId of streamIds) {
//         await viewerCounter.resetViewerCount(streamId)
//         // Broadcast the reset count
//         io.emit("viewer_count", { streamId, count: 0 })
//       }

//       // Also set test streams to 0
//       const testStreamIds = ["stream-1", "stream-2", "stream-3", "stream-4", "default-stream"]
//       for (const streamId of testStreamIds) {
//         await viewerCounter.resetViewerCount(streamId)
//         io.emit("viewer_count", { streamId, count: 0 })
//       }
//     } catch (error) {
//       console.error("Error resetting viewer counts:", error)
//     }
//   }

//   // Clean up stale viewers
//   async function cleanupStaleViewers() {
//     try {
//       // Get all viewer tracking keys
//       const viewerKeys = await redisClient.keys("viewer:*")

//       // Get all stream IDs
//       const streamIds = new Set()
//       for (const key of viewerKeys) {
//         const parts = key.split(":")
//         if (parts.length >= 2) {
//           streamIds.add(parts[1])
//         }
//       }

//       // For each stream, sync the viewer count with the actual number of active viewers
//       for (const streamId of streamIds) {
//         // Use the viewerCounter utility to sync the count
//         const activeViewers = await viewerCounter.syncViewerCount(streamId)

//         // Broadcast the updated count
//         io.emit("viewer_count", { streamId, count: activeViewers })

//         console.log(`Synced viewer count for ${streamId}: ${activeViewers}`)
//       }

//       console.log(`Cleaned up viewer counts for ${streamIds.size} streams`)
//     } catch (error) {
//       console.error("Error cleaning up stale viewers:", error)
//     }
//   }

//   // Create API endpoint for synchronous decrements (for beforeunload events)
//   server.on("request", async (req, res) => {
//     if (req.method === "POST" && req.url.startsWith("/api/viewer/decrement/")) {
//       try {
//         const streamId = req.url.split("/").pop()
//         if (!streamId) {
//           res.writeHead(400)
//           res.end(JSON.stringify({ success: false, message: "Stream ID required" }))
//           return
//         }

//         // Decrement the viewer count using the viewerCounter utility
//         const newCount = await viewerCounter.decrementViewers(streamId)

//         // Broadcast the updated count
//         io.emit("viewer_count", { streamId, count: newCount })

//         res.writeHead(200, { "Content-Type": "application/json" })
//         res.end(JSON.stringify({ success: true, viewerCount: newCount }))
//       } catch (error) {
//         console.error("Error in sync decrement:", error)
//         res.writeHead(500)
//         res.end(JSON.stringify({ success: false, message: "Server error" }))
//       }
//     }
//   })

//   // Make sure to clean up the subscriber when the server shuts down
//   process.on("SIGTERM", () => {
//     chatSubscriber.punsubscribe()
//     chatSubscriber.quit()
//   })

//   return io
// }

const { Server } = require("socket.io")
const { createAdapter } = require("@socket.io/redis-adapter")
const { redisClient, redisPubClient, redisSubClient, viewerCounter, chatRateLimiter } = require("../config/redis")
const Stream = require("../model/streamModel")
// const { nanoid } = require("nanoid")
const mongoose = require("mongoose")
const streamController = require("../controller/stream-controller")
// const chatRateLimiter = require("../utils/rateLimiter") // Import the rate limiter

async function generateId() {
  const { nanoid } = await import("nanoid")
  console.log(nanoid())
}

// Helper function for default avatars
function getDefaultAvatar(anonymousId, username) {
  const styles = ["adventurer", "avataaars", "bottts", "jdenticon"]
  const firstChar = (username || "a").charAt(0).toLowerCase()
  const styleIndex = firstChar.charCodeAt(0) % styles.length
  const style = styles[styleIndex]
  return `https://avatars.dicebear.com/api/${style}/${username || anonymousId}.svg`
}

// Helper function to check if a string is a valid MongoDB ObjectId
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id)
}

module.exports = async function setupSocketIO(server) {
  // Create Socket.IO server with Redis adapter for horizontal scaling
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
    adapter: createAdapter(redisPubClient, redisSubClient), // Use separate pub/sub clients
    transports: ["websocket", "polling"],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
  })

  // Set up Redis pub/sub for efficient message distribution
  const chatSubscriber = setupRedisPubSub(io)

  // Reset all viewer counts on server start
  await resetAllViewerCounts()

  // Set up a periodic cleanup task to remove stale viewers
  setInterval(cleanupStaleViewers, 60 * 1000) // Run every minute for more frequent cleanup

  // Middleware to set up user data
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token
      const anonymousId = socket.handshake.auth.anonymousId || `anon-${generateId(8)}`
      const customUsername = socket.handshake.auth.customUsername || "Anonymous"
      const customProfilePicture = socket.handshake.auth.customProfilePicture

      // Set up user object
      if (token) {
        try {
          // For authenticated users, verify token and get user info
          // This is simplified - in production you would verify the JWT
          socket.user = {
            id: "user-id-from-token",
            username: "username-from-token",
            profilePicture: "/placeholder.svg?height=30&width=30", // Use a valid URL format
            isAnonymous: false,
          }
        } catch (error) {
          // Token verification failed, use custom profile
          socket.user = {
            id: anonymousId,
            username: customUsername,
            profilePicture: customProfilePicture || getDefaultAvatar(anonymousId, customUsername),
            isAnonymous: true,
          }
        }
      } else {
        // For anonymous users, use their custom profile
        socket.user = {
          id: anonymousId,
          username: customUsername,
          profilePicture: customProfilePicture || getDefaultAvatar(anonymousId, customUsername),
          isAnonymous: true,
        }
      }

      next()
    } catch (error) {
      next(new Error("Authentication failed"))
    }
  })

  // Handle connections
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`)

    // Track which streams this socket is watching
    const watchingStreams = new Set()

    // Heartbeat to verify active viewers
    socket.on("heartbeat", async ({ streamIds }) => {
      if (!Array.isArray(streamIds)) return

      console.log(`Received heartbeat from ${socket.id} for streams:`, streamIds)

      // Verify each stream this client claims to be watching
      for (const streamId of streamIds) {
        const viewerKey = `viewer:${streamId}:${socket.id}`
        // Extend the TTL for this viewer
        await redisClient.expire(viewerKey, 120) // 2 minutes
      }
    })

    // Join stream room
    socket.on("join_stream", async ({ streamId }) => {
      try {
        if (!streamId) return

        console.log(`User ${socket.id} attempting to join stream: ${streamId}`)

        // Join a single room for the stream
        const roomName = `stream:${streamId}`

        // Check if socket is already in this room to prevent duplicate counts
        const isInRoom = Array.from(socket.rooms).includes(roomName)
        if (isInRoom) {
          console.log(`User ${socket.id} already in stream: ${streamId}`)
          return
        }

        // First, leave any other streams this socket might be watching
        // This ensures a user can only watch one stream at a time for accurate counting
        for (const currentStreamId of watchingStreams) {
          if (currentStreamId !== streamId) {
            await leaveStream(socket, currentStreamId)
          }
        }

        // Check if this viewer is already counted in Redis
        const viewerKey = `viewer:${streamId}:${socket.id}`
        const exists = await redisClient.exists(viewerKey)
        if (exists) {
          console.log(`User ${socket.id} already counted for stream: ${streamId}`)
          // Just refresh the TTL without incrementing count
          await redisClient.expire(viewerKey, 120) // Expires in 2 minutes if no heartbeat
          return
        }

        socket.join(roomName)
        watchingStreams.add(streamId)
        console.log(`User ${socket.id} joined stream: ${streamId}`)

        // Store this connection in Redis to track unique viewers
        await redisClient.set(viewerKey, "1", "EX", 120) // Expires in 2 minutes if no heartbeat

        // Increment viewer count using the viewerCounter utility
        const viewerCount = await viewerCounter.incrementViewers(streamId)
        console.log(`Updated viewer count for ${streamId}: ${viewerCount}`)

        // Broadcast viewer count to all clients (not just those in the room)
        io.emit("viewer_count", { streamId, count: viewerCount })

        // Update stream metrics in MongoDB only if streamId is a valid ObjectId
        if (isValidObjectId(streamId)) {
          await streamController.updateStreamMetrics(streamId, viewerCount)
        }

        // Send recent messages from Redis to the newly connected client
        const recentMessages = await getRecentMessages(streamId)
        if (recentMessages.length > 0) {
          socket.emit("recent_messages", recentMessages)
        }
      } catch (error) {
        console.error("Join stream error:", error)
        socket.emit("error", { message: "Failed to join stream" })
      }
    })

    // Helper function to leave a stream
    async function leaveStream(socket, streamId) {
      try {
        if (!streamId) return

        console.log(`User ${socket.id} leaving stream: ${streamId}`)

        const roomName = `stream:${streamId}`

        // Check if socket is actually in this room
        const isInRoom = Array.from(socket.rooms).includes(roomName)
        if (!isInRoom) {
          console.log(`User ${socket.id} not in stream: ${streamId}, skipping leave`)
          return
        }

        socket.leave(roomName)
        watchingStreams.delete(streamId)
        console.log(`User ${socket.id} left stream: ${streamId}`)

        // Remove this connection from Redis
        const viewerKey = `viewer:${streamId}:${socket.id}`
        await redisClient.del(viewerKey)

        // Decrement viewer count using the viewerCounter utility
        const viewerCount = await viewerCounter.decrementViewers(streamId)
        console.log(`Updated viewer count for ${streamId}: ${viewerCount}`)

        // Broadcast to all clients (not just those in the room)
        io.emit("viewer_count", { streamId, count: viewerCount })
      } catch (error) {
        console.error("Leave stream error:", error)
      }
    }

    // Handle leave stream
    socket.on("leave_stream", async ({ streamId }) => {
      await leaveStream(socket, streamId)
    })

    // Handle disconnection
    socket.on("disconnect", async () => {
      try {
        console.log(`User disconnecting: ${socket.id}, was watching streams:`, Array.from(watchingStreams))

        // Leave all streams this socket was watching
        for (const streamId of watchingStreams) {
          await leaveStream(socket, streamId)
        }

        console.log(`User disconnected: ${socket.id}`)
      } catch (error) {
        console.error("Disconnect error:", error)
      }
    })

    // WebRTC signaling - Broadcaster offer
    socket.on("broadcaster_offer", async ({ streamId, offer }) => {
      try {
        console.log(`Received broadcaster offer for stream: ${streamId}`)

        // Forward the offer to all viewers in the room
        socket.to(`stream:${streamId}`).emit("broadcaster_offer", { streamId, offer })

        // Update stream status to active only if streamId is a valid ObjectId
        if (isValidObjectId(streamId)) {
          await Stream.updateMany({ streamId: streamId }, { $set: { status: "active" } })
        }

        // Notify all clients that the stream is active
        io.emit("stream_active", { streamId })
      } catch (error) {
        console.error("Broadcaster offer error:", error)
        socket.emit("error", { message: "Failed to process offer" })
      }
    })

    // WebRTC signaling - Viewer request
    socket.on("viewer_request", async ({ streamId }) => {
      try {
        console.log(`Received viewer request for stream: ${streamId}`)

        // Forward the request to the broadcaster
        socket.to(`stream:${streamId}`).emit("viewer_request", {
          streamId,
          viewerId: socket.id,
        })
      } catch (error) {
        console.error("Viewer request error:", error)
        socket.emit("error", { message: "Failed to connect to stream" })
      }
    })

    // WebRTC signaling - Viewer offer
    socket.on("viewer_offer", async ({ streamId, offer, viewerId }) => {
      try {
        console.log(`Received viewer offer for stream: ${streamId}`)

        if (viewerId) {
          // Forward the offer to the specific viewer
          io.to(viewerId).emit("viewer_offer", {
            streamId,
            offer,
          })
        } else {
          // Forward the offer to all viewers in the room
          socket.to(`stream:${streamId}`).emit("viewer_offer", {
            streamId,
            offer,
          })
        }
      } catch (error) {
        console.error("Viewer offer error:", error)
        socket.emit("error", { message: "Failed to process offer" })
      }
    })

    // WebRTC signaling - Viewer answer
    socket.on("viewer_answer", async ({ streamId, answer }) => {
      try {
        console.log(`Received viewer answer for stream: ${streamId}`)

        // Forward the answer to the broadcaster
        socket.to(`stream:${streamId}`).emit("viewer_answer", {
          streamId,
          answer,
          viewerId: socket.id,
        })
      } catch (error) {
        console.error("Viewer answer error:", error)
        socket.emit("error", { message: "Failed to process answer" })
      }
    })

    // WebRTC signaling - ICE candidate
    socket.on("ice_candidate", async ({ streamId, candidate, isViewer, viewerId }) => {
      try {
        console.log(`Received ICE candidate for stream: ${streamId}, isViewer: ${isViewer}`)

        if (viewerId) {
          // Forward to specific viewer
          io.to(viewerId).emit("ice_candidate", {
            streamId,
            candidate,
            isViewer,
          })
        } else if (isViewer) {
          // Forward viewer's ICE candidate to the broadcaster
          socket.to(`stream:${streamId}`).emit("ice_candidate", {
            streamId,
            candidate,
            viewerId: socket.id,
            isViewer,
          })
        } else {
          // Forward broadcaster's ICE candidate to all viewers
          socket.to(`stream:${streamId}`).emit("ice_candidate", {
            streamId,
            candidate,
            isViewer,
          })
        }
      } catch (error) {
        console.error("ICE candidate error:", error)
        socket.emit("error", { message: "Failed to process ICE candidate" })
      }
    })

    // Handle chat messages
    socket.on("send_message", async ({ content, streamId, replyTo }) => {
      try {
        if (!content.trim() || !streamId) return

        // Check rate limiting - with enhanced feedback
        const canSend = await checkRateLimit(socket.user.id, streamId)
        if (!canSend) {
          socket.emit("error", {
            message: "Rate limit exceeded. Please wait before sending more messages.",
            code: "RATE_LIMIT",
            retryAfter: 2, // Suggest retry after 2 seconds
          })
          return
        }

        const messageId = `msg-${Date.now()}-${generateId(6)}`
        const timestamp = Date.now()

        // Get the real username from socket.handshake.auth if available
        const realUsername = socket.handshake.auth.realUsername || socket.user.username

        // Create message object with real username
        const message = {
          id: messageId,
          content,
          streamId,
          timestamp,
          sender: {
            id: socket.user.id,
            username: realUsername, // Use real username instead of anonymous
            profilePicture: socket.user.profilePicture,
            isAnonymous: socket.user.isAnonymous,
          },
          replyTo: replyTo || null,
        }

        // For extremely high volume streams, use sharded message storage
        // This helps distribute the load across Redis instances
        const streamShard = getStreamShard(streamId)
        const messageKey = `messages:${streamShard}:${streamId}`

        // Store in Redis for recent messages - with optimized storage
        await storeMessage(messageKey, message)

        // For high-volume streams, use a pub/sub approach instead of room broadcasting
        // This is more efficient for very large numbers of recipients
        redisPubClient.publish(
          `chat:${streamId}`,
          JSON.stringify({
            type: "new_message",
            message,
          }),
        )

        // Also emit to socket room for backward compatibility
        socket.to(`stream:${streamId}`).emit("new_message", message)

        // Increment message count in stream metrics only if streamId is a valid ObjectId
        if (isValidObjectId(streamId)) {
          // Use a more efficient counter increment for high volume
          await incrementMessageCounter(streamId)
        }
      } catch (error) {
        console.error("Send message error:", error)
        socket.emit("error", { message: "Failed to send message" })
      }
    })

    // Handle view mode change
    socket.on("change_view_mode", ({ streamId, mode }) => {
      // This is just for UI state, no backend processing needed
      // But we can track analytics if desired
      console.log(`User ${socket.id} changed view mode to ${mode} for stream ${streamId}`)
    })

    // Handle camera selection
    socket.on("select_camera", ({ streamId, cameraId }) => {
      // This is just for UI state, no backend processing needed
      console.log(`User ${socket.id} selected camera ${cameraId} for stream ${streamId}`)
    })
  })

  async function checkRateLimit(userId, streamId) {
    return await chatRateLimiter.checkLimit(userId, streamId)
  }

  // Helper function to get a shard key for a stream
  // This helps distribute data across Redis instances for high-volume streams
  function getStreamShard(streamId) {
    // Simple sharding based on the last character of the streamId
    // In production, you would use a more sophisticated sharding strategy
    return streamId.slice(-1).charCodeAt(0) % 10
  }

  // More efficient counter increment for high message volumes
  async function incrementMessageCounter(streamId) {
    // Use a batched counter approach to reduce Redis operations
    const counterKey = `msgcount:${streamId}`
    const batchKey = `msgcount:batch:${streamId}`

    // Increment the batch counter
    await redisClient.incr(batchKey)

    // Every 100 messages, update the main counter and reset the batch
    const batchCount = await redisClient.get(batchKey)
    if (batchCount && Number.parseInt(batchCount) >= 100) {
      await redisClient.incrby(counterKey, Number.parseInt(batchCount))
      await redisClient.set(batchKey, 0)

      // Update the stream metrics in MongoDB in batches
      streamController
        .incrementMessageCountBatch(streamId, Number.parseInt(batchCount))
        .catch((err) => console.error(`Failed to update message count for ${streamId}:`, err))
    }
  }

  async function storeMessage(key, message) {
    // Use pipeline for better performance with high message volumes
    await redisClient
      .multi()
      .zadd(key, message.timestamp, JSON.stringify(message))
      .zremrangebyrank(key, 0, -101) // Keep only the latest 100 messages
      .expire(key, 86400) // 24 hours TTL
      .exec()

    // For extremely high volume streams, we can also implement message archiving
    // This would move older messages to a more permanent storage solution
    if (Math.random() < 0.01) {
      // 1% chance to check if archiving is needed
      checkMessageArchiving(key).catch((err) => console.error(`Error checking message archiving for ${key}:`, err))
    }
  }

  // Function to check if messages need to be archived
  async function checkMessageArchiving(key) {
    // Get count of messages in this stream
    const count = await redisClient.zcard(key)

    // If we have a lot of messages, archive the older ones
    if (count > 1000) {
      // In a real implementation, this would move older messages to a database
      // For now, we'll just log that archiving would happen
      console.log(`Would archive older messages for ${key}, current count: ${count}`)

      // In production, you would:
      // 1. Get the oldest messages
      // 2. Store them in a database
      // 3. Remove them from Redis
    }
  }

  // Set up Redis pub/sub for chat messages
  // This is more efficient than Socket.IO rooms for very high volumes
  function setupRedisPubSub(io) {
    const subscriber = redisSubClient.duplicate()

    subscriber.on("message", (channel, message) => {
      if (channel.startsWith("chat:")) {
        const streamId = channel.split(":")[1]
        const data = JSON.parse(message)

        // Broadcast to all clients in the stream room
        io.to(`stream:${streamId}`).emit(data.type, data.message)
      }
    })

    // Subscribe to all chat channels
    subscriber.psubscribe("chat:*")

    return subscriber
  }

  async function getRecentMessages(streamId) {
    const streamShard = getStreamShard(streamId)
    const key = `messages:${streamShard}:${streamId}`
    const messages = await redisClient.zrevrange(key, 0, 49) // Get latest 50 messages
    return messages.map((msg) => JSON.parse(msg)).reverse() // Oldest first
  }

  // Reset all viewer counts
  async function resetAllViewerCounts() {
    try {
      // Get all viewer count keys
      const keys = await redisClient.keys("viewers:*")

      // Delete all viewer count keys
      if (keys.length > 0) {
        await redisClient.del(...keys)
        console.log(`Reset ${keys.length} viewer counts on server start`)
      }

      // Also delete all viewer tracking keys
      const viewerKeys = await redisClient.keys("viewer:*")
      if (viewerKeys.length > 0) {
        // Delete in batches to avoid Redis command timeout
        const batchSize = 1000
        for (let i = 0; i < viewerKeys.length; i += batchSize) {
          const batch = viewerKeys.slice(i, i + batchSize)
          await redisClient.del(...batch)
        }
        console.log(`Reset ${viewerKeys.length} viewer tracking keys on server start`)
      }

      // Set all active streams to have 0 viewers
      const streamIds = await Stream.distinct("streamId")
      for (const streamId of streamIds) {
        await viewerCounter.resetViewerCount(streamId)
        // Broadcast the reset count
        io.emit("viewer_count", { streamId, count: 0 })
      }

      // Also set test streams to 0
      const testStreamIds = ["stream-1", "stream-2", "stream-3", "stream-4", "default-stream"]
      for (const streamId of testStreamIds) {
        await viewerCounter.resetViewerCount(streamId)
        io.emit("viewer_count", { streamId, count: 0 })
      }
    } catch (error) {
      console.error("Error resetting viewer counts:", error)
    }
  }

  // Clean up stale viewers
  async function cleanupStaleViewers() {
    try {
      // Get all viewer tracking keys
      const viewerKeys = await redisClient.keys("viewer:*")

      // Get all stream IDs
      const streamIds = new Set()
      for (const key of viewerKeys) {
        const parts = key.split(":")
        if (parts.length >= 2) {
          streamIds.add(parts[1])
        }
      }

      // For each stream, sync the viewer count with the actual number of active viewers
      for (const streamId of streamIds) {
        // Use the viewerCounter utility to sync the count
        const activeViewers = await viewerCounter.syncViewerCount(streamId)

        // Broadcast the updated count
        io.emit("viewer_count", { streamId, count: activeViewers })

        console.log(`Synced viewer count for ${streamId}: ${activeViewers}`)
      }

      console.log(`Cleaned up viewer counts for ${streamIds.size} streams`)
    } catch (error) {
      console.error("Error cleaning up stale viewers:", error)
    }
  }

  // Create API endpoint for synchronous decrements (for beforeunload events)
  server.on("request", async (req, res) => {
    if (req.method === "POST" && req.url.startsWith("/api/viewer/decrement/")) {
      try {
        const streamId = req.url.split("/").pop()
        if (!streamId) {
          res.writeHead(400)
          res.end(JSON.stringify({ success: false, message: "Stream ID required" }))
          return
        }

        // Decrement the viewer count using the viewerCounter utility
        const newCount = await viewerCounter.decrementViewers(streamId)

        // Broadcast the updated count
        io.emit("viewer_count", { streamId, count: newCount })

        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ success: true, viewerCount: newCount }))
      } catch (error) {
        console.error("Error in sync decrement:", error)
        res.writeHead(500)
        res.end(JSON.stringify({ success: false, message: "Server error" }))
      }
    }
  })

  // Make sure to clean up the subscriber when the server shuts down
  process.on("SIGTERM", () => {
    chatSubscriber.punsubscribe()
    chatSubscriber.quit()
  })

  return io
}






