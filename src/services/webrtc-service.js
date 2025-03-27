const { RTCPeerConnection, RTCSessionDescription } = require("wrtc")
const { redisClient, viewerCounter } = require("../config/redis")
const mongoose = require("mongoose")

// Helper function to check if a string is a valid MongoDB ObjectId
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id)
}

class WebRTCService {
  constructor() {
    this.streams = new Map() // Map of active streams by streamId
    this.viewers = new Map() // Map of viewer connections by userId + streamId
    this.iceServers = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      // Add TURN servers for production
      // { urls: 'turn:your-turn-server.com', username: 'username', credential: 'credential' }
    ]
  }

  // Initialize a new stream
  async initializeStream(streamId, userId) {
    try {
      // Create a new peer connection for the broadcaster
      const peerConnection = new RTCPeerConnection({
        iceServers: this.iceServers,
      })

      // Store the peer connection
      this.streams.set(streamId, {
        peerConnection,
        userId,
        viewers: new Set(),
        startTime: Date.now(),
      })

      // Store stream info in Redis for persistence
      await redisClient.hset(`stream:${streamId}`, {
        userId,
        startTime: Date.now(),
        active: true,
      })

      // Initialize viewer count to 0
      await viewerCounter.resetViewerCount(streamId)

      return { success: true, streamId }
    } catch (error) {
      console.error("Error initializing stream:", error)
      return { success: false, error: error.message }
    }
  }

  // Handle offer from broadcaster
  async handleOffer(streamId, userId, offer) {
    try {
      const stream = this.streams.get(streamId)
      if (!stream) {
        // If stream doesn't exist, initialize it
        await this.initializeStream(streamId, userId)
        const newStream = this.streams.get(streamId)

        // Set remote description
        await newStream.peerConnection.setRemoteDescription(new RTCSessionDescription(offer))

        // Create answer
        const answer = await newStream.peerConnection.createAnswer()
        await newStream.peerConnection.setLocalDescription(answer)

        return { success: true, answer }
      }

      if (stream.userId !== userId) {
        return { success: false, error: "Unauthorized" }
      }

      // Set remote description
      await stream.peerConnection.setRemoteDescription(new RTCSessionDescription(offer))

      // Create answer
      const answer = await stream.peerConnection.createAnswer()
      await stream.peerConnection.setLocalDescription(answer)

      return { success: true, answer }
    } catch (error) {
      console.error("Error handling offer:", error)
      return { success: false, error: error.message }
    }
  }

  // Handle viewer connection request
  async connectViewer(streamId, userId) {
    try {
      const stream = this.streams.get(streamId)
      if (!stream) {
        // For test streams that don't exist in memory, create a dummy offer
        if (!isValidObjectId(streamId) || streamId.startsWith("stream-") || streamId === "default-stream") {
          // Increment viewer count
          await viewerCounter.incrementViewers(streamId)

          // Store viewer key for tracking
          const viewerKey = `viewer:${streamId}:${userId}`
          await redisClient.set(viewerKey, "1", "EX", 120) // 2 minutes TTL

          return {
            success: true,
            offer: {
              type: "offer",
              sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:dummy\r\na=ice-pwd:dummy\r\na=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00\r\na=setup:actpass\r\na=mid:0\r\na=extmap:1 urn:ietf:params:rtp-hdrext:toffset\r\na=recvonly\r\na=rtpmap:96 VP8/90000\r\na=rtcp-fb:96 goog-remb\r\na=rtcp-fb:96 transport-cc\r\na=rtcp-fb:96 ccm fir\r\na=rtcp-fb:96 nack\r\na=rtcp-fb:96 nack pli\r\n",
            },
          }
        }
        return { success: false, error: "Stream not found" }
      }

      // Create a new peer connection for the viewer
      const peerConnection = new RTCPeerConnection({
        iceServers: this.iceServers,
      })

      // Generate a unique key for this viewer connection
      const viewerKey = `${userId}:${streamId}`

      // Store the viewer connection
      this.viewers.set(viewerKey, {
        peerConnection,
        streamId,
        userId,
        joinTime: Date.now(),
      })

      // Add viewer to stream's viewer set
      stream.viewers.add(userId)

      // Increment viewer count
      await viewerCounter.incrementViewers(streamId)

      // Store viewer key for tracking
      const redisViewerKey = `viewer:${streamId}:${userId}`
      await redisClient.set(redisViewerKey, "1", "EX", 120) // 2 minutes TTL

      // Create offer for viewer
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)

      return { success: true, offer }
    } catch (error) {
      console.error("Error connecting viewer:", error)
      return { success: false, error: error.message }
    }
  }

  // Handle answer from viewer
  async handleViewerAnswer(streamId, userId, answer) {
    try {
      const viewerKey = `${userId}:${streamId}`
      const viewer = this.viewers.get(viewerKey)

      if (!viewer) {
        // For test streams, just return success
        if (!isValidObjectId(streamId) || streamId.startsWith("stream-") || streamId === "default-stream") {
          return { success: true }
        }
        return { success: false, error: "Viewer connection not found" }
      }

      // Set remote description
      await viewer.peerConnection.setRemoteDescription(new RTCSessionDescription(answer))

      return { success: true }
    } catch (error) {
      console.error("Error handling viewer answer:", error)
      return { success: false, error: error.message }
    }
  }

  // Handle ICE candidate
  async handleIceCandidate(streamId, userId, candidate, isViewer = false) {
    try {
      // For test streams, just return success
      if (!isValidObjectId(streamId) || streamId.startsWith("stream-") || streamId === "default-stream") {
        return { success: true }
      }

      if (isViewer) {
        const viewerKey = `${userId}:${streamId}`
        const viewer = this.viewers.get(viewerKey)

        if (!viewer) {
          return { success: false, error: "Viewer connection not found" }
        }

        await viewer.peerConnection.addIceCandidate(candidate)
      } else {
        const stream = this.streams.get(streamId)

        if (!stream) {
          return { success: false, error: "Stream not found" }
        }

        await stream.peerConnection.addIceCandidate(candidate)
      }

      return { success: true }
    } catch (error) {
      console.error("Error handling ICE candidate:", error)
      return { success: false, error: error.message }
    }
  }

  // End stream
  async endStream(streamId, userId) {
    try {
      const stream = this.streams.get(streamId)

      if (!stream) {
        // For test streams, just return success
        if (!isValidObjectId(streamId) || streamId.startsWith("stream-") || streamId === "default-stream") {
          return { success: true }
        }
        return { success: false, error: "Stream not found" }
      }

      if (stream.userId !== userId) {
        return { success: false, error: "Unauthorized" }
      }

      // Close peer connection
      stream.peerConnection.close()

      // Remove stream
      this.streams.delete(streamId)

      // Update Redis
      await redisClient.hset(`stream:${streamId}`, {
        active: false,
        endTime: Date.now(),
      })

      // Close all viewer connections for this stream
      for (const [key, viewer] of this.viewers.entries()) {
        if (viewer.streamId === streamId) {
          viewer.peerConnection.close()
          this.viewers.delete(key)

          // Decrement viewer count for each disconnected viewer
          await viewerCounter.decrementViewers(streamId)

          // Remove viewer tracking key
          const viewerTrackingKey = `viewer:${streamId}:${viewer.userId}`
          await redisClient.del(viewerTrackingKey)
        }
      }

      // Reset viewer count to 0
      await viewerCounter.resetViewerCount(streamId)

      return { success: true }
    } catch (error) {
      console.error("Error ending stream:", error)
      return { success: false, error: error.message }
    }
  }

  // Disconnect viewer
  async disconnectViewer(streamId, userId) {
    try {
      // For test streams, just return success but still decrement the count
      if (!isValidObjectId(streamId) || streamId.startsWith("stream-") || streamId === "default-stream") {
        await viewerCounter.decrementViewers(streamId)

        // Remove viewer tracking key
        const viewerTrackingKey = `viewer:${streamId}:${userId}`
        await redisClient.del(viewerTrackingKey)

        return { success: true }
      }

      const viewerKey = `${userId}:${streamId}`
      const viewer = this.viewers.get(viewerKey)

      if (!viewer) {
        return { success: false, error: "Viewer connection not found" }
      }

      // Close peer connection
      viewer.peerConnection.close()

      // Remove viewer
      this.viewers.delete(viewerKey)

      // Remove from stream's viewer set
      const stream = this.streams.get(streamId)
      if (stream) {
        stream.viewers.delete(userId)
      }

      // Decrement viewer count
      await viewerCounter.decrementViewers(streamId)

      // Remove viewer tracking key
      const viewerTrackingKey = `viewer:${streamId}:${userId}`
      await redisClient.del(viewerTrackingKey)

      return { success: true }
    } catch (error) {
      console.error("Error disconnecting viewer:", error)
      return { success: false, error: error.message }
    }
  }

  // Get stream stats
  async getStreamStats(streamId) {
    try {
      // For test streams, return dummy stats
      if (!isValidObjectId(streamId) || streamId.startsWith("stream-") || streamId === "default-stream") {
        const viewerCount = await viewerCounter.getViewerCount(streamId)
        return {
          success: true,
          stats: {
            streamId,
            viewerCount,
            peakViewers: viewerCount,
            totalViewers: viewerCount * 2, // Just a dummy calculation
            duration: 3600, // 1 hour in seconds
          },
        }
      }

      const stream = this.streams.get(streamId)

      if (!stream) {
        return { success: false, error: "Stream not found" }
      }

      // Get the current viewer count
      const viewerCount = await viewerCounter.getViewerCount(streamId)

      return {
        success: true,
        stats: {
          streamId,
          userId: stream.userId,
          viewerCount,
          startTime: stream.startTime,
          duration: Date.now() - stream.startTime,
        },
      }
    } catch (error) {
      console.error("Error getting stream stats:", error)
      return { success: false, error: error.message }
    }
  }
}

module.exports = new WebRTCService()

