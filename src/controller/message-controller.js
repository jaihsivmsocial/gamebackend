const Message = require("../model/messageModel.js");
const { redisClient, chatRateLimiter } = require("../config/redis.js");

const getDefaultAvatar = (anonymousId, username) => {
  const styles = ["adventurer", "avataaars", "bottts", "jdenticon"];
  const firstChar = (username || "a").charAt(0).toLowerCase();
  const styleIndex = firstChar.charCodeAt(0) % styles.length;
  const style = styles[styleIndex];
  return `https://avatars.dicebear.com/api/${style}/${username || anonymousId}.svg`;
};


exports.getMessages = async (req, res) => {
    try {
        const { streamId } = req.params
        const { before = Date.now(), limit = 50 } = req.query
    
        const recentMessagesKey = `recent_messages:${streamId}`
        const recentMessages = await redisClient.zrevrangebyscore(recentMessagesKey, before, "-inf", "LIMIT", 0, limit)
    
        if (recentMessages && recentMessages.length >= Number.parseInt(limit)) {
          const messages = recentMessages.map((msg) => JSON.parse(msg))
          return res.status(200).json({
            messages,
            hasMore: true,
            nextCursor: messages[messages.length - 1]?.timestamp,
          })
        }
    
        const messages = await Message.getStreamMessages(streamId, {
          limit: Number.parseInt(limit),
          before: Number.parseInt(before),
        })
        const formattedMessages = messages.map((msg) => ({
          id: msg._id.toString(),
          content: msg.content,
          streamId: msg.streamId,
          timestamp: msg.timestamp.getTime(),
          sender: {
            id: msg.senderInfo.anonymousId,
            username: msg.senderInfo.username,
            profilePicture: msg.senderInfo.profilePicture,
            isAnonymous: msg.senderInfo.isAnonymous,
          },
        }))
    
        res.status(200).json({
          messages: formattedMessages,
          hasMore: formattedMessages.length === Number.parseInt(limit),
          nextCursor: formattedMessages[formattedMessages.length - 1]?.timestamp,
        })
      } catch (error) {
        console.error("Get messages error:", error)
        res.status(500).json({ message: "Server error" })
      }
};



exports.sendChatMessage = async (req, res) => {
    try {
        const { nanoid } = await import("nanoid/non-secure")
        const { content, streamId, anonymousName, anonymousId, customProfilePicture } = req.body
    
        // Validate required fields
        if (!content || !streamId) {
          return res.status(400).json({ message: "Content and streamId are required" })
        }
    
        // Generate anonymous user details
        const anonId = anonymousId || nanoid(10)
        const username = anonymousName || "Anonymous"
        const profilePicture = customProfilePicture || getDefaultAvatar(anonId, username)
    
        // Rate limiting
        const canSend = await chatRateLimiter.checkLimit(anonId, streamId)
        if (!canSend) {
          return res.status(429).json({ message: "Rate limit exceeded" })
        }
    
        const messageId = `msg-${Date.now()}-${nanoid(10)}`
        const timestamp = Date.now()
    
        // Prepare message for broadcasting
        const message = {
          id: messageId,
          content,
          streamId,
          timestamp,
          sender: {
            id: anonId,
            username,
            profilePicture,
            isAnonymous: true,
          },
        }
    
        // Cache message in Redis
        const recentMessagesKey = `recent_messages:${streamId}`
        await redisClient
          .multi()
          .zadd(recentMessagesKey, timestamp, JSON.stringify(message))
          .zremrangebyscore(recentMessagesKey, "-inf", timestamp - 24 * 60 * 60 * 1000)
          .expire(recentMessagesKey, 24 * 60 * 60)
          .exec()
    
        // Persist to MongoDB
        const newMessage = new Message({
          content,
          streamId,
          timestamp: new Date(timestamp),
          senderInfo: {
            anonymousId: anonId,
            username,
            profilePicture,
            isAnonymous: true,
          },
        })
        await newMessage.save()
    
        // Broadcast to all users in the stream via Socket.IO
        if (req.io) {
          // Use a single room name for consistent broadcasting
          req.io.to(`stream:${streamId}`).emit("new_message", message)
        }
    
        res.status(201).json({
          message: "Chat message sent successfully",
          data: message,
        })
      } catch (error) {
        console.error("Send chat message error:", error)
        res.status(500).json({ message: "Server error" })
      }
};