// const { Server } = require("socket.io")
// const { createAdapter } = require("@socket.io/redis-adapter")
// const { redisClient, redisPubClient, redisSubClient, viewerCounter } = require("../config/redis")
// const Stream = require("../model/streamModel")
// // const { nanoid } = require("nanoid")
// const mongoose = require("mongoose")
// const streamController = require("../controller/stream-controller")


// async function generateId() {
//   const { nanoid } = await import('nanoid');
//   console.log(nanoid());
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

//   // Reset all viewer counts on server start
//   await resetAllViewerCounts()

//   // Set up a periodic cleanup task to remove stale viewers
//   setInterval(cleanupStaleViewers, 5 * 60 * 1000) // Run every 5 minutes

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
//             profilePicture: "profile-picture-from-token",
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

//         socket.join(roomName)
//         watchingStreams.add(streamId)
//         console.log(`User ${socket.id} joined stream: ${streamId}`)

//         // Store this connection in Redis to track unique viewers
//         const viewerKey = `viewer:${streamId}:${socket.id}`
//         await redisClient.set(viewerKey, "1", "EX", 120) // Expires in 2 minutes if no heartbeat

//         // Increment viewer count in Redis
//         const viewerCount = await incrementViewerCount(streamId)
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

//     // Handle leave stream
//     socket.on("leave_stream", async ({ streamId }) => {
//       try {
//         if (!streamId) return

//         console.log(`User ${socket.id} attempting to leave stream: ${streamId}`)

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

//         // Decrement viewer count
//         const viewerCount = await decrementViewerCount(streamId)
//         console.log(`Updated viewer count for ${streamId}: ${viewerCount}`)

//         // Broadcast to all clients (not just those in the room)
//         io.emit("viewer_count", { streamId, count: viewerCount })
//       } catch (error) {
//         console.error("Leave stream error:", error)
//       }
//     })

//     // Handle disconnection
//     socket.on("disconnect", async () => {
//       try {
//         console.log(`User disconnecting: ${socket.id}, was watching streams:`, Array.from(watchingStreams))

//         // Leave all streams this socket was watching
//         for (const streamId of watchingStreams) {
//           // Remove this connection from Redis
//           const viewerKey = `viewer:${streamId}:${socket.id}`
//           await redisClient.del(viewerKey)

//           // Decrement viewer count
//           const viewerCount = await decrementViewerCount(streamId)
//           console.log(`Updated viewer count for ${streamId}: ${viewerCount}`)

//           // Broadcast to all clients
//           io.emit("viewer_count", { streamId, count: viewerCount })
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

//         // Check rate limiting
//         const canSend = await checkRateLimit(socket.user.id, streamId)
//         if (!canSend) {
//           socket.emit("error", { message: "Rate limit exceeded" })
//           return
//         }

//         const messageId = `msg-${Date.now()}-${generateId(6)}`
//         const timestamp = Date.now()

//         // Create message object
//         const message = {
//           id: messageId,
//           content,
//           streamId,
//           timestamp,
//           sender: {
//             id: socket.user.id,
//             username: socket.user.username,
//             profilePicture: socket.user.profilePicture,
//             isAnonymous: socket.user.isAnonymous,
//           },
//         }

//         // Store in Redis for recent messages
//         await storeMessage(streamId, message)

//         // Broadcast to ALL clients in the stream room
//         io.to(`stream:${streamId}`).emit("new_message", message)

//         // Increment message count in stream metrics only if streamId is a valid ObjectId
//         if (isValidObjectId(streamId)) {
//           await streamController.incrementMessageCount(streamId)
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

//   // Helper functions for Redis operations
//   async function incrementViewerCount(streamId) {
//     const key = `viewers:${streamId}`
//     const count = await redisClient.incr(key)
//     await redisClient.expire(key, 3600) // 1 hour TTL
//     return Number.parseInt(count)
//   }

//   async function decrementViewerCount(streamId) {
//     const key = `viewers:${streamId}`
//     const count = await redisClient.decr(key)
//     // If count is 0 or negative, delete the key to clean up
//     if (count <= 0) {
//       await redisClient.del(key)
//       return 0
//     }
//     return Number.parseInt(count)
//   }

//   async function storeMessage(streamId, message) {
//     const key = `messages:${streamId}`
//     await redisClient
//       .multi()
//       .zadd(key, message.timestamp, JSON.stringify(message))
//       .zremrangebyrank(key, 0, -101) // Keep only the latest 100 messages
//       .expire(key, 86400) // 24 hours TTL
//       .exec()
//   }

//   async function getRecentMessages(streamId) {
//     const key = `messages:${streamId}`
//     const messages = await redisClient.zrevrange(key, 0, 49) // Get latest 50 messages
//     return messages.map((msg) => JSON.parse(msg)).reverse() // Oldest first
//   }

//   async function checkRateLimit(userId, streamId) {
//     const key = `ratelimit:chat:${userId}:${streamId}`
//     const count = await redisClient.incr(key)

//     if (count === 1) {
//       await redisClient.expire(key, 10) // 10 seconds window
//     }

//     return count <= 5 // 5 messages per 10 seconds
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

//       // For each stream, count active viewers and update the count
//       for (const streamId of streamIds) {
//         const streamViewerKeys = viewerKeys.filter((key) => key.startsWith(`viewer:${streamId}:`))
//         const activeViewers = streamViewerKeys.length

//         // Update the viewer count in Redis
//         const key = `viewers:${streamId}`
//         if (activeViewers === 0) {
//           // No active viewers, delete the key
//           await redisClient.del(key)
//         } else {
//           // Set the count to the number of active viewers
//           await redisClient.set(key, activeViewers.toString())
//           await redisClient.expire(key, 3600) // 1 hour TTL
//         }

//         // Broadcast the updated count
//         io.emit("viewer_count", { streamId, count: activeViewers })
//       }

//       console.log(`Cleaned up viewer counts for ${streamIds.size} streams`)
//     } catch (error) {
//       console.error("Error cleaning up stale viewers:", error)
//     }
//   }

//   return io
// }



const { Server } = require("socket.io")
const { createAdapter } = require("@socket.io/redis-adapter")
const { redisClient, redisPubClient, redisSubClient, viewerCounter } = require("../config/redis")
const Stream = require("../model/streamModel")
// const { nanoid } = require("nanoid")
const mongoose = require("mongoose")
const streamController = require("../controller/stream-controller")

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

  // Reset all viewer counts on server start
  await resetAllViewerCounts()

  // Set up a periodic cleanup task to remove stale viewers
  setInterval(cleanupStaleViewers, 5 * 60 * 1000) // Run every 5 minutes

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
            profilePicture: "profile-picture-from-token",
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

        socket.join(roomName)
        watchingStreams.add(streamId)
        console.log(`User ${socket.id} joined stream: ${streamId}`)

        // Store this connection in Redis to track unique viewers
        const viewerKey = `viewer:${streamId}:${socket.id}`
        await redisClient.set(viewerKey, "1", "EX", 120) // Expires in 2 minutes if no heartbeat

        // Increment viewer count in Redis
        const viewerCount = await incrementViewerCount(streamId)
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

    // Handle leave stream
    socket.on("leave_stream", async ({ streamId }) => {
      try {
        if (!streamId) return

        console.log(`User ${socket.id} attempting to leave stream: ${streamId}`)

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

        // Decrement viewer count
        const viewerCount = await decrementViewerCount(streamId)
        console.log(`Updated viewer count for ${streamId}: ${viewerCount}`)

        // Broadcast to all clients (not just those in the room)
        io.emit("viewer_count", { streamId, count: viewerCount })
      } catch (error) {
        console.error("Leave stream error:", error)
      }
    })

    // Handle disconnection
    socket.on("disconnect", async () => {
      try {
        console.log(`User disconnecting: ${socket.id}, was watching streams:`, Array.from(watchingStreams))

        // Leave all streams this socket was watching
        for (const streamId of watchingStreams) {
          // Remove this connection from Redis
          const viewerKey = `viewer:${streamId}:${socket.id}`
          await redisClient.del(viewerKey)

          // Decrement viewer count
          const viewerCount = await decrementViewerCount(streamId)
          console.log(`Updated viewer count for ${streamId}: ${viewerCount}`)

          // Broadcast to all clients
          io.emit("viewer_count", { streamId, count: viewerCount })
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
    socket.on("send_message", async ({ content, streamId }) => {
      try {
        if (!content.trim() || !streamId) return

        // Check rate limiting
        const canSend = await checkRateLimit(socket.user.id, streamId)
        if (!canSend) {
          socket.emit("error", { message: "Rate limit exceeded" })
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
        }

        // Store in Redis for recent messages
        await storeMessage(streamId, message)

        // Broadcast to ALL clients in the stream room
        io.to(`stream:${streamId}`).emit("new_message", message)

        // Increment message count in stream metrics only if streamId is a valid ObjectId
        if (isValidObjectId(streamId)) {
          await streamController.incrementMessageCount(streamId)
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

  // Helper functions for Redis operations
  async function incrementViewerCount(streamId) {
    const key = `viewers:${streamId}`
    const count = await redisClient.incr(key)
    await redisClient.expire(key, 3600) // 1 hour TTL
    return Number.parseInt(count)
  }

  async function decrementViewerCount(streamId) {
    const key = `viewers:${streamId}`
    const count = await redisClient.decr(key)
    // If count is 0 or negative, delete the key to clean up
    if (count <= 0) {
      await redisClient.del(key)
      return 0
    }
    return Number.parseInt(count)
  }

  async function storeMessage(streamId, message) {
    const key = `messages:${streamId}`
    await redisClient
      .multi()
      .zadd(key, message.timestamp, JSON.stringify(message))
      .zremrangebyrank(key, 0, -101) // Keep only the latest 100 messages
      .expire(key, 86400) // 24 hours TTL
      .exec()
  }

  async function getRecentMessages(streamId) {
    const key = `messages:${streamId}`
    const messages = await redisClient.zrevrange(key, 0, 49) // Get latest 50 messages
    return messages.map((msg) => JSON.parse(msg)).reverse() // Oldest first
  }

  async function checkRateLimit(userId, streamId) {
    const key = `ratelimit:chat:${userId}:${streamId}`
    const count = await redisClient.incr(key)

    if (count === 1) {
      await redisClient.expire(key, 10) // 10 seconds window
    }

    return count <= 5 // 5 messages per 10 seconds
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

      // For each stream, count active viewers and update the count
      for (const streamId of streamIds) {
        const streamViewerKeys = viewerKeys.filter((key) => key.startsWith(`viewer:${streamId}:`))
        const activeViewers = streamViewerKeys.length

        // Update the viewer count in Redis
        const key = `viewers:${streamId}`
        if (activeViewers === 0) {
          // No active viewers, delete the key
          await redisClient.del(key)
        } else {
          // Set the count to the number of active viewers
          await redisClient.set(key, activeViewers.toString())
          await redisClient.expire(key, 3600) // 1 hour TTL
        }

        // Broadcast the updated count
        io.emit("viewer_count", { streamId, count: activeViewers })
      }

      console.log(`Cleaned up viewer counts for ${streamIds.size} streams`)
    } catch (error) {
      console.error("Error cleaning up stale viewers:", error)
    }
  }

  return io
}

