const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");

const {
  redisClient,
  redisPubClient,
  redisSubClient,
  viewerCounter,
  chatRateLimiter,
} = require("../config/redis");
const Stream = require("../model/streamModel");
const cron = require("node-cron");
const mongoose = require("mongoose");
const streamController = require("../controller/stream-controller");
const jwt = require("jsonwebtoken");
const User = require("../model/userModel");
const BetQuestion = require("../model/battingModel/BetQuestion");
const Bet = require("../model/battingModel/Bet");
const BetStats = require("../model/battingModel/BetStats");
const fetch = require("node-fetch");
const processOngoingBetQuestions = require("../controller/setCorrectAnswer/setCorrectAnswer");
const questionTimers = new Map();

// Add this near the top of the file with other variables
let lastCameraHolderName = null;
let currentCameraHolder = null;
const CAMERA_HOLDER_CHECK_INTERVAL = 2000; // Check every 2 seconds

// Helper function for default avatars
function getDefaultAvatar(anonymousId, username) {
  const styles = ["adventurer", "avataaars", "bottts", "jdenticon"];
  const firstChar = (username || "a").charAt(0).toLowerCase();
  const styleIndex = firstChar.charCodeAt(0) % styles.length;
  const style = styles[styleIndex];
  return `https://avatars.dicebear.com/api/${style}/${username || anonymousId}.svg`;
}

// Helper function to check if a string is a valid MongoDB ObjectId
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Replace the existing generateRandomQuestion function with this simplified version that only uses the camera holder name
const generateRandomQuestion = async () => {
  try {
    // Use the current camera holder data instead of fetching it again
    if (
      !currentCameraHolder ||
      !currentCameraHolder.CameraHolderName ||
      currentCameraHolder.CameraHolderName === "None"
    ) {
      throw new Error("No valid camera holder data found");
    }
    // Use the camera holder name as the subject
    const subject = currentCameraHolder.CameraHolderName;

    // let totalTime = 30

    const conditions = [
      "Will  be able to get  5 Kill in 30 sec",
      "Will  be able to get 3 Kill in 35 Sec",
      "Will  be able to get 5 Kill in 40 Sec",
    ];

    const randomCondition =
      conditions[Math.floor(Math.random() * conditions.length)];

    return {
      subject,
      condition: randomCondition,
    };
  } catch (error) {
    console.error("Error generating question with dynamic subject:", error);
    // Don't provide a fallback - if there's no valid camera holder, we shouldn't generate a question
    throw error;
  }
};

// Add this function near the top of the file, after the helper functions
// Function to check if questions should be generated based on camera holder
async function shouldGenerateQuestions() {
  try {
    // Use the current camera holder data instead of fetching it again
    if (!currentCameraHolder) {
      return false;
    }

    // Check if we have valid data
    console.log("Camera holder name:", currentCameraHolder.CameraHolderName);

    // Only generate questions if camera holder name is not empty and not "None"
    return (
      currentCameraHolder.CameraHolderName &&
      currentCameraHolder.CameraHolderName !== "None"
    );
  } catch (error) {
    console.error("Error checking if questions should be generated:", error);
    return false;
  }
}

// Global io instance
let io;

// IMPORTANT: Move the generateNewQuestion function definition here, before it's used
// Update the generateNewQuestion function to handle the async generateRandomQuestion
async function generateNewQuestion(specificStreamId = null) {
  try {
    // Check if questions should be generated
    const shouldGenerate = await shouldGenerateQuestions();
    if (!shouldGenerate) {
      console.log(
        "Skipping question generation - camera holder conditions not met"
      );
      return null;
    }

    // Get the dynamic question with camera holder name as subject
    const { subject, condition } = await generateRandomQuestion();
    // console.log("subject----", subject)
    const questionText = `Will ${subject} ${condition}?`;

    let match = questionText.match(/(\d+)\s*Sec/i);
    console.log("match --------------------------", match);

    let kills = questionText.match(/(\d+)\s*Kill/i);
    // console.log("kills --------------------------", kills)

    let competitionTime;

    console.log(
      "question Text-----------------------------------------------------------------------",
      questionText
    );

    const now = new Date();
    const endTime = new Date(now.getTime() + 36000); // 36 seconds countdown

    // Use provided streamId or default
    const streamId = specificStreamId || "default-stream";

    // Create a new question in the database
    const newQuestion = new BetQuestion({
      question: questionText,
      subject,
      condition,
      startTime: now,
      endTime,
      active: true,
      yesPercentage: 50,
      noPercentage: 50,
      totalBetAmount: 0,
      totalPlayers: 0,
      hasBets: false,
      streamId: streamId,
    });

    let newQuestions = await newQuestion.save();

    console.log("newQuestions-------------------------", newQuestions._id);

    if (match) {
      console.log("match------------------------------", match[1]); // "35"
      competitionTime = 36 + Number(match[1]) || 0;
      noOfKills = Number(kills[1]) || 0;

      // await processOngoingBetQuestions.processOngoingBetQuestions(newQuestions._id,subject, noOfKills )
      setTimeout(() => {
        processOngoingBetQuestions.processOngoingBetQuestions(
          newQuestions._id,
          subject,
          noOfKills
        );
      }, competitionTime * 1000); // Convert seconds to milliseconds
      // console.log(
      //   "compitationTime------------------------------",
      //   competitionTime
      // );
    } else {
      console.log("No number found before 'Sec'");
    }

    // Emit socket event for new question
    io.emit("new_question", {
      id: newQuestion._id,
      question: questionText,
      subject,
      condition,
      startTime: now,
      endTime,
      competitionTime,
      yesPercentage: 50,
      noPercentage: 50,
      totalBetAmount: 0,
      totalPlayers: 0,
    });
    // console.log("New betting question generated:", questionText);

    // Schedule question resolution after 36 seconds
    const timerId = setTimeout(() => resolveQuestion(newQuestion._id), 36000);

    // Store the timer ID
    questionTimers.set(newQuestion._id.toString(), timerId);

    return newQuestion;
  } catch (error) {
    console.error("Error generating new question:", error);
    return null;
  }
}

// Automatically resolve a question
async function resolveQuestion(questionId) {
  try {
    // Find the question in the database
    const question = await BetQuestion.findById(questionId);

    if (!question || question.resolved) {
      console.log(`Question ${questionId} already resolved or not found`);
      return;
    }

    // Check if any bets were placed on this question
    const bets = await Bet.find({ questionId });

    if (!bets || bets.length === 0) {
      console.log(
        `No bets placed on question ${questionId}, skipping resolution`
      );

      // Mark the question as inactive and resolved without an outcome
      question.resolved = true;
      question.active = false;
      question.outcome = null; // Set outcome to null to indicate it was skipped
      await question.save();

      // Clear any timer for this question
      if (questionTimers.has(questionId.toString())) {
        clearTimeout(questionTimers.get(questionId.toString()));
        questionTimers.delete(questionId.toString());
      }

      // Emit socket event for question skipped
      io.emit("question_skipped", {
        questionId,
      });

      return;
    }

    // Randomly determine outcome (50/50 chance)
    const outcome = Math.random() < 0.5 ? "Yes" : "No";

    // Emit socket event for question resolution
    io.emit("question_resolved", {
      questionId,
      outcome,
    });

    console.log(`Question resolved: ${questionId} - Outcome: ${outcome}`);

    // Mark the question as resolved
    question.resolved = true;
    question.active = false;
    question.outcome = outcome;
    await question.save();

    // Clear any timer for this question
    if (questionTimers.has(questionId.toString())) {
      clearTimeout(questionTimers.get(questionId.toString()));
      questionTimers.delete(questionId.toString());
    }
  } catch (error) {}
}

// Add this function to check for camera holder changes
async function checkCameraHolderChanges() {
  try {
    // Fetch the camera holder data from the API
    const response = await fetch("http://apitest.tribez.gg/api/players/get");
    if (!response.ok) {
      console.error("Failed to fetch camera holder data:", response.status);
      return;
    }

    const data = await response.json();

    // Check if we have valid data
    if (!Array.isArray(data) || data.length === 0) {
      console.log("No camera holder data found");
      return;
    }

    // Store the current camera holder data
    currentCameraHolder = data[0];
    const currentCameraHolderName = data[0].CameraHolderName;
    // console.log(
    //   "Current camera holder name:",
    //   currentCameraHolderName,
    //   "Last camera holder name:",
    //   lastCameraHolderName
    // );

    // If camera holder changed from None/empty to a valid name, generate a question immediately
    if (
      (lastCameraHolderName === null ||
        lastCameraHolderName === "" ||
        lastCameraHolderName === "None") &&
      currentCameraHolderName &&
      currentCameraHolderName !== "None"
    ) {
      console.log(
        "Camera holder changed to a valid name, generating question immediately"
      );

      // Check if there's already an active question
      const activeQuestion = await BetQuestion.findOne({
        active: true,
        resolved: false,
        endTime: { $gt: new Date() },
      });

      // Only generate a new question if there's no active one
      if (!activeQuestion) {
        // Get all active streams
        const activeStreams = await Stream.find({ status: "active" }).distinct(
          "streamId"
        );

        // If no active streams, use default
        if (!activeStreams || activeStreams.length === 0) {
          await generateNewQuestion("default-stream");
        } else {
          // Generate a question for each active stream
          for (const streamId of activeStreams) {
            await generateNewQuestion(streamId);
          }
        }
      }
    }

    // If camera holder changed, broadcast the update to all clients
    if (currentCameraHolderName !== lastCameraHolderName) {
      // Broadcast the camera holder update to all clients
      if (io) {
        io.emit("camera_holder_update", { cameraHolder: currentCameraHolder });
      }
    }

    // Update the last camera holder name
    lastCameraHolderName = currentCameraHolderName;
  } catch (error) {
    console.error("Error checking camera holder changes:", error);
  }
}

// Add a function to get the current camera holder
function getCurrentCameraHolder() {
  return currentCameraHolder;
}

module.exports = async function setupSocketIO(server) {
  // Create Socket.IO server with Redis adapter for horizontal scaling
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://apitest.tribez.gg",
      methods: ["GET", "POST"],
      credentials: true,
    },
    adapter: createAdapter(redisPubClient, redisSubClient),
    transports: ["websocket", "polling"],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
  });

  // Set up Redis pub/sub for efficient message distribution
  const chatSubscriber = setupRedisPubSub(io);

  // Reset all viewer counts on server start
  await resetAllViewerCounts();

  // Set up a periodic cleanup task to remove stale viewers
  setInterval(cleanupStaleViewers, 60 * 1000);

  // Setup automated question generation for betting
  setupQuestionGenerator();

  // Start polling for camera holder changes
  setInterval(checkCameraHolderChanges, CAMERA_HOLDER_CHECK_INTERVAL);

  // Middleware to set up user data
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      const anonymousId =
        socket.handshake.auth.anonymousId ||
        `anon-${Math.random().toString(36).substring(2, 10)}`;
      const customUsername =
        socket.handshake.auth.customUsername || "Anonymous";
      const customProfilePicture = socket.handshake.auth.customProfilePicture;

      // Set up user object
      if (token) {
        try {
          // Verify JWT token using the same method as your auth middleware
          const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET || "fallback_secret_for_development"
          );

          // Find user in database
          const user = await User.findById(decoded.id).select("-password");

          if (user) {
            // For authenticated users, use their actual user data
            socket.user = {
              id: user._id.toString(), // Convert ObjectId to string
              username: user.username,
              profilePicture:
                user.profilePicture || "/placeholder.svg?height=30&width=30",
              isAnonymous: false,
              isAuthenticated: true,
            };
          } else {
            // Token valid but user not found, use custom profile
            socket.user = {
              id: anonymousId,
              username: customUsername,
              profilePicture:
                customProfilePicture ||
                getDefaultAvatar(anonymousId, customUsername),
              isAnonymous: true,
              isAuthenticated: false,
            };
          }
        } catch (error) {
          console.error("Socket auth error:", error.message);
          // Token verification failed, use custom profile
          socket.user = {
            id: anonymousId,
            username: customUsername,
            profilePicture:
              customProfilePicture ||
              getDefaultAvatar(anonymousId, customUsername),
            isAnonymous: true,
            isAuthenticated: false,
          };
        }
      } else {
        // For anonymous users, use their custom profile
        socket.user = {
          id: anonymousId,
          username: customUsername,
          profilePicture:
            customProfilePicture ||
            getDefaultAvatar(anonymousId, customUsername),
          isAnonymous: true,
          isAuthenticated: false,
        };
      }

      next();
    } catch (error) {
      console.error("Socket authentication error:", error);
      next(new Error("Authentication failed"));
    }
  });

  // Handle connections
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Track which streams this socket is watching
    const watchingStreams = new Set();

    // Heartbeat to verify active viewers
    socket.on("heartbeat", async ({ streamIds }) => {
      if (!Array.isArray(streamIds)) return;

      console.log(
        `Received heartbeat from ${socket.id} for streams:`,
        streamIds
      );

      // Verify each stream this client claims to be watching
      for (const streamId of streamIds) {
        const viewerKey = `viewer:${streamId}:${socket.id}`;
        // Extend the TTL for this viewer
        await redisClient.expire(viewerKey, 120); // 2 minutes
      }
    });

    // Join stream room
    socket.on("join_stream", async ({ streamId }) => {
      try {
        if (!streamId) return;

        console.log(`User ${socket.id} attempting to join stream: ${streamId}`);

        // Join a single room for the stream
        const roomName = `stream:${streamId}`;

        // Check if socket is already in this room to prevent duplicate counts
        const isInRoom = Array.from(socket.rooms).includes(roomName);
        if (isInRoom) {
          console.log(`User ${socket.id} already in stream: ${streamId}`);
          return;
        }

        // First, leave any other streams this socket might be watching
        // This ensures a user can only watch one stream at a time for accurate counting
        for (const currentStreamId of watchingStreams) {
          if (currentStreamId !== streamId) {
            await leaveStream(socket, currentStreamId);
          }
        }

        // Check if this viewer is already counted in Redis
        const viewerKey = `viewer:${streamId}:${socket.id}`;
        const exists = await redisClient.exists(viewerKey);
        if (exists) {
          console.log(
            `User ${socket.id} already counted for stream: ${streamId}`
          );
          // Just refresh the TTL without incrementing count
          await redisClient.expire(viewerKey, 120); // Expires in 2 minutes if no heartbeat
          return;
        }

        socket.join(roomName);
        watchingStreams.add(streamId);
        console.log(`User ${socket.id} joined stream: ${streamId}`);

        // Store this connection in Redis to track unique viewers
        await redisClient.set(viewerKey, "1", "EX", 120); // Expires in 2 minutes if no heartbeat

        // Increment viewer count using the viewerCounter utility
        const viewerCount = await viewerCounter.incrementViewers(streamId);
        console.log(`Updated viewer count for ${streamId}: ${viewerCount}`);

        // Broadcast viewer count to all clients (not just those in the room)
        io.emit("viewer_count", { streamId, count: viewerCount });

        // Update stream metrics in MongoDB only if streamId is a valid ObjectId
        if (isValidObjectId(streamId)) {
          await streamController.updateStreamMetrics(streamId, viewerCount);
        }

        // Send recent messages from Redis to the newly connected client
        const recentMessages = await getRecentMessages(streamId);
        if (recentMessages.length > 0) {
          socket.emit("recent_messages", recentMessages);
        }

        // Send current active betting question if available
        sendActiveQuestion(socket, streamId);

        // Send current camera holder to the newly connected client
        if (currentCameraHolder) {
          socket.emit("camera_holder_update", {
            cameraHolder: currentCameraHolder,
          });
        }
      } catch (error) {
        console.error("Join stream error:", error);
        socket.emit("error", { message: "Failed to join stream" });
      }
    });

    // Helper function to leave a stream
    async function leaveStream(socket, streamId) {
      try {
        if (!streamId) return;

        console.log(`User ${socket.id} leaving stream: ${streamId}`);

        const roomName = `stream:${streamId}`;

        // Check if socket is actually in this room
        const isInRoom = Array.from(socket.rooms).includes(roomName);
        if (!isInRoom) {
          console.log(
            `User ${socket.id} not in stream: ${streamId}, skipping leave`
          );
          return;
        }

        socket.leave(roomName);
        watchingStreams.delete(streamId);
        console.log(`User ${socket.id} left stream: ${streamId}`);

        // Remove this connection from Redis
        const viewerKey = `viewer:${streamId}:${socket.id}`;
        await redisClient.del(viewerKey);

        // Decrement viewer count using the viewerCounter utility
        const viewerCount = await viewerCounter.decrementViewers(streamId);
        console.log(`Updated viewer count for ${streamId}: ${viewerCount}`);

        // Broadcast to all clients (not just those in the room)
        io.emit("viewer_count", { streamId, count: viewerCount });
      } catch (error) {
        console.error("Leave stream error:", error);
      }
    }

    // Handle leave stream
    socket.on("leave_stream", async ({ streamId }) => {
      await leaveStream(socket, streamId);
    });

    // Handle disconnection
    socket.on("disconnect", async () => {
      try {
        console.log(
          `User disconnecting: ${socket.id}, was watching streams:`,
          Array.from(watchingStreams)
        );

        // Leave all streams this socket was watching
        for (const streamId of watchingStreams) {
          await leaveStream(socket, streamId);
        }

        console.log(`User disconnected: ${socket.id}`);
      } catch (error) {
        console.error("Disconnect error:", error);
      }
    });

    // WebRTC signaling - Broadcaster offer
    socket.on("broadcaster_offer", async ({ streamId, offer }) => {
      try {
        console.log(`Received broadcaster offer for stream: ${streamId}`);

        // Forward the offer to all viewers in the room
        socket
          .to(`stream:${streamId}`)
          .emit("broadcaster_offer", { streamId, offer });

        // Update stream status to active only if streamId is a valid ObjectId
        if (isValidObjectId(streamId)) {
          await Stream.updateMany(
            { streamId: streamId },
            { $set: { status: "active" } }
          );
        }

        // Notify all clients that the stream is active
        io.emit("stream_active", { streamId });
      } catch (error) {
        console.error("Broadcaster offer error:", error);
        socket.emit("error", { message: "Failed to process offer" });
      }
    });

    // WebRTC signaling - Viewer request
    socket.on("viewer_request", async ({ streamId }) => {
      try {
        console.log(`Received viewer request for stream: ${streamId}`);

        // Forward the request to the broadcaster
        socket.to(`stream:${streamId}`).emit("viewer_request", {
          streamId,
          viewerId: socket.id,
        });
      } catch (error) {
        console.error("Viewer request error:", error);
        socket.emit("error", { message: "Failed to connect to stream" });
      }
    });

    // WebRTC signaling - Viewer offer
    socket.on("viewer_offer", async ({ streamId, offer, viewerId }) => {
      try {
        console.log(`Received viewer offer for stream: ${streamId}`);

        if (viewerId) {
          // Forward the offer to the specific viewer
          io.to(viewerId).emit("viewer_offer", {
            streamId,
            offer,
          });
        } else {
          // Forward the offer to all viewers in the room
          socket.to(`stream:${streamId}`).emit("viewer_offer", {
            streamId,
            offer,
          });
        }
      } catch (error) {
        console.error("Viewer offer error:", error);
        socket.emit("error", { message: "Failed to process offer" });
      }
    });

    // WebRTC signaling - Viewer answer
    socket.on("viewer_answer", async ({ streamId, answer }) => {
      try {
        console.log(`Received viewer answer for stream: ${streamId}`);

        // Forward the answer to the broadcaster
        socket.to(`stream:${streamId}`).emit("viewer_answer", {
          streamId,
          answer,
          viewerId: socket.id,
        });
      } catch (error) {
        console.error("Viewer answer error:", error);
        socket.emit("error", { message: "Failed to process answer" });
      }
    });

    // WebRTC signaling - ICE candidate
    socket.on(
      "ice_candidate",
      async ({ streamId, candidate, isViewer, viewerId }) => {
        try {
          console.log(
            `Received ICE candidate for stream: ${streamId}, isViewer: ${isViewer}`
          );

          if (viewerId) {
            // Forward to specific viewer
            io.to(viewerId).emit("ice_candidate", {
              streamId,
              candidate,
              isViewer,
            });
          } else if (isViewer) {
            // Forward viewer's ICE candidate to the broadcaster
            socket.to(`stream:${streamId}`).emit("ice_candidate", {
              streamId,
              candidate,
              viewerId: socket.id,
              isViewer,
            });
          } else {
            // Forward broadcaster's ICE candidate to all viewers
            socket.to(`stream:${streamId}`).emit("ice_candidate", {
              streamId,
              candidate,
              isViewer,
            });
          }
        } catch (error) {
          console.error("ICE candidate error:", error);
          socket.emit("error", { message: "Failed to process ICE candidate" });
        }
      }
    );

    // Handle chat messages
    // socket.on("send_message", async ({ content, streamId, replyTo }) => {
    //   try {
    //     if (!content.trim() || !streamId) return;

    //     // Check rate limiting - with enhanced feedback
    //     const canSend = await checkRateLimit(socket.user.id, streamId);
    //     if (!canSend) {
    //       socket.emit("error", {
    //         message:
    //           "Rate limit exceeded. Please wait before sending more messages.",
    //         code: "RATE_LIMIT",
    //         retryAfter: 2, // Suggest retry after 2 seconds
    //       });
    //       return;
    //     }

    //     const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    //     const timestamp = Date.now();

    //     // Get the real username from socket.handshake.auth if available
    //     const realUsername =
    //       socket.handshake.auth.realUsername || socket.user.username;

    //     // Create message object with real username
    //     const message = {
    //       id: messageId,
    //       content,
    //       streamId,
    //       timestamp,
    //       sender: {
    //         id: socket.user.id,
    //         username: realUsername, // Use real username instead of anonymous
    //         profilePicture: socket.user.profilePicture,
    //         isAnonymous: socket.user.isAnonymous,
    //       },
    //       replyTo: replyTo || null,
    //     };

    //     // For extremely high volume streams, use sharded message storage
    //     // This helps distribute the load across Redis instances
    //     const streamShard = getStreamShard(streamId);
    //     const messageKey = `messages:${streamShard}:${streamId}`;

    //     // Store in Redis for recent messages - with optimized storage
    //     await storeMessage(messageKey, message);

    //     // For high-volume streams, use a pub/sub approach instead of room broadcasting
    //     // This is more efficient for very large numbers of recipients
    //     redisPubClient.publish(
    //       `chat:${streamId}`,
    //       JSON.stringify({
    //         type: "new_message",
    //         message,
    //       })
    //     );

    //     // Also emit to socket room for backward compatibility
    //     socket.to(`stream:${streamId}`).emit("new_message", message);

    //     // Increment message count in stream metrics only if streamId is a valid ObjectId
    //     if (isValidObjectId(streamId)) {
    //       // Use a more efficient counter increment for high volume
    //       await incrementMessageCounter(streamId);
    //     }
    //   } catch (error) {
    //     console.error("Send message error:", error);
    //     socket.emit("error", { message: "Failed to send message" });
    //   }
    // });
    // Handle chat messages
socket.on("send_message", async ({ content, streamId, replyTo }) => {
  try {
    if (!content.trim() || !streamId) return;

    // Check rate limiting - with enhanced feedback
    const canSend = await checkRateLimit(socket.user.id, streamId);
    if (!canSend) {
      socket.emit("error", {
        message:
          "Rate limit exceeded. Please wait before sending more messages.",
        code: "RATE_LIMIT",
        retryAfter: 2, // Suggest retry after 2 seconds
      });
      return;
    }

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const timestamp = Date.now();

    // CHANGE: Get the real username from socket.handshake.auth if available
    const realUsername =
      socket.handshake.auth.realUsername || socket.user.username;

    // Create message object with real username
    const message = {
      id: messageId,
      content,
      streamId,
      timestamp,
      sender: {
        id: socket.user.id,
        username: realUsername, // CHANGE: Use real username instead of anonymous
        profilePicture: socket.user.profilePicture,
        isAnonymous: socket.user.isAnonymous,
      },
      replyTo: replyTo || null,
    };

    // For extremely high volume streams, use sharded message storage
    // This helps distribute the load across Redis instances
    const streamShard = getStreamShard(streamId);
    const messageKey = `messages:${streamShard}:${streamId}`;

    // Store in Redis for recent messages - with optimized storage
    await storeMessage(messageKey, message);

    // CHANGE: Broadcast to ALL clients, not just room members
    // This ensures everyone gets the message regardless of room membership
    io.emit("new_message", message);
    
    // Also use the pub/sub approach for redundancy
    redisPubClient.publish(
      `chat:${streamId}`,
      JSON.stringify({
        type: "new_message",
        message,
      })
    );

    // Increment message count in stream metrics only if streamId is a valid ObjectId
    if (isValidObjectId(streamId)) {
      // Use a more efficient counter increment for high volume
      await incrementMessageCounter(streamId);
    }
  } catch (error) {
    console.error("Send message error:", error);
    socket.emit("error", { message: "Failed to send message" });
  }
});

    // Handle view mode change
    socket.on("change_view_mode", ({ streamId, mode }) => {
      // This is just for UI state, no backend processing needed
      // But we can track analytics if desired
      console.log(
        `User ${socket.id} changed view mode to ${mode} for stream ${streamId}`
      );
    });

    // Handle camera selection
    socket.on("select_camera", ({ streamId, cameraId }) => {
      // This is just for UI state, no backend processing needed
      console.log(
        `User ${socket.id} selected camera ${cameraId} for stream ${streamId}`
      );
    });

    // ==================== BETTING SYSTEM SOCKET EVENTS ====================

    // Place a bet
    socket.on("place_bet", async ({ questionId, choice, amount }) => {
      try {
        console.log(
          `User ${socket.id} placing bet on question ${questionId}: ${choice} for ${amount}`
        );

        // Check if user is authenticated
        if (!socket.user.isAuthenticated) {
          socket.emit("error", {
            message: "Authentication required to place bets",
            code: "AUTH_REQUIRED",
          });
          return;
        }

        // Find the question
        const question = await BetQuestion.findById(questionId);
        if (!question) {
          socket.emit("error", { message: "Question not found" });
          return;
        }

        // Calculate new percentages based on this bet
        let totalYesAmount = 0;
        let totalNoAmount = 0;

        // Get all existing bets for this question
        const existingBets = await Bet.find({ questionId });

        // Sum up existing bets by choice
        existingBets.forEach((bet) => {
          if (bet.choice === "Yes") {
            totalYesAmount += bet.amount;
          } else if (bet.choice === "No") {
            totalNoAmount += bet.amount;
          }
        });

        // Add the new bet
        if (choice === "Yes") {
          totalYesAmount += amount;
        } else if (choice === "No") {
          totalNoAmount += amount;
        }

        // Calculate new percentages
        const totalAmount = totalYesAmount + totalNoAmount;
        let yesPercentage = 50;
        let noPercentage = 50;

        if (totalAmount > 0) {
          yesPercentage = Math.round((totalYesAmount / totalAmount) * 100);
          noPercentage = Math.round((totalNoAmount / totalAmount) * 100);

          // Ensure percentages add up to 100%
          if (yesPercentage + noPercentage !== 100) {
            // Adjust to make sure they add up to 100%
            if (yesPercentage > noPercentage) {
              yesPercentage = 100 - noPercentage;
            } else {
              noPercentage = 100 - yesPercentage;
            }
          }
        }

        // Update the question with new percentages
        question.yesPercentage = yesPercentage;
        question.noPercentage = noPercentage;
        question.totalBetAmount = (question.totalBetAmount || 0) + amount;
        question.totalPlayers = existingBets.length + 1;

        // Set a flag to indicate a bet was placed on this question
        question.hasBets = true;

        await question.save();

        // Emit confirmation to the user who placed the bet
        socket.emit("bet_placed", {
          success: true,
          questionId,
          choice,
          amount,
          timestamp: Date.now(),
        });

        // Broadcast bet update to all viewers with the new calculated percentages
        io.emit("bet_update", {
          questionId,
          yesPercentage,
          noPercentage,
          totalBetAmount: question.totalBetAmount,
          totalPlayers: question.totalPlayers,
        });

        // IMPORTANT: Immediately resolve the question after a bet is placed
        console.log(`Bet placed, immediately resolving question ${questionId}`);

        // Clear any existing timer for this question
        if (questionTimers.has(questionId.toString())) {
          clearTimeout(questionTimers.get(questionId.toString()));
          questionTimers.delete(questionId.toString());
        }

        // Resolve the question immediately
        await resolveQuestion(questionId);

        // Generate a new question immediately
        await generateNewQuestion(question.streamId);
      } catch (error) {
        console.error("Place bet error:", error);
        socket.emit("error", { message: "Failed to place bet" });
      }
    });

    // Request current betting question
    socket.on("get_active_question", () => {
      // Get streamId from socket rooms
      const streamId =
        Array.from(socket.rooms)
          .find((room) => room.startsWith("stream:"))
          ?.split(":")[1] || "default-stream";

      sendActiveQuestion(socket, streamId);
    });

    // Request betting stats
    socket.on("get_betting_stats", () => {
      sendBettingStats(socket);
    });

    // Add a handler for getting the current camera holder
    socket.on("get_camera_holder", () => {
      if (currentCameraHolder) {
        socket.emit("camera_holder_update", {
          cameraHolder: currentCameraHolder,
        });
      }
    });
  });

  async function checkRateLimit(userId, streamId) {
    return await chatRateLimiter.checkLimit(userId, streamId);
  }

  // Helper function to get a shard key for a stream
  // This helps distribute data across Redis instances for high-volume streams
  function getStreamShard(streamId) {
    // Simple sharding based on the last character of the streamId
    // In production, you would use a more sophisticated sharding strategy
    return streamId.slice(-1).charCodeAt(0) % 10;
  }

  // More efficient counter increment for high message volumes
  async function incrementMessageCounter(streamId) {
    // Use a batched counter approach to reduce Redis operations
    const counterKey = `msgcount:${streamId}`;
    const batchKey = `msgcount:batch:${streamId}`;

    // Increment the batch counter
    await redisClient.incr(batchKey);

    // Every 100 messages, update the main counter and reset the batch
    const batchCount = await redisClient.get(batchKey);
    if (batchCount && Number.parseInt(batchCount) >= 100) {
      await redisClient.incrby(counterKey, Number.parseInt(batchCount));
      await redisClient.set(batchKey, 0);

      // Update the stream metrics in MongoDB in batches
      streamController
        .incrementMessageCountBatch(streamId, Number.parseInt(batchCount))
        .catch((err) =>
          console.error(`Failed to update message count for ${streamId}:`, err)
        );
    }
  }

  async function storeMessage(key, message) {
    // Use pipeline for better performance with high message volumes
    await redisClient
      .multi()
      .zadd(key, message.timestamp, JSON.stringify(message))
      .zremrangebyrank(key, 0, -101) // Keep only the latest 100 messages
      .expire(key, 86400) // 24 hours TTL
      .exec();

    // For extremely high volume streams, we can also implement message archiving
    // This would move older messages to a more permanent storage solution
    if (Math.random() < 0.01) {
      // 1% chance to check if archiving is needed
      checkMessageArchiving(key).catch((err) =>
        console.error(`Error checking message archiving for ${key}:`, err)
      );
    }
  }
  // Function to check if messages need to be archived
  async function checkMessageArchiving(key) {
    // Get count of messages in this stream
    const count = await redisClient.zcard(key);

    // If we have a lot of messages, archive the older ones
    if (count > 1000) {
      // In a real implementation, this would move older messages to a database
      // For now, we'll just log that archiving would happen
      console.log(
        `Would archive older messages for ${key}, current count: ${count}`
      );

      // In production, you would:
      // 1. Get the oldest messages
      // 2. Store them in a database
      // 3. Remove them from Redis
    }
  }

  // Set up Redis pub/sub for chat messages
  // This is more efficient than Socket.IO rooms for very high volumes
  function setupRedisPubSub(io) {
    const subscriber = redisSubClient.duplicate();

    subscriber.on("message", (channel, message) => {
      if (channel.startsWith("chat:")) {
        const streamId = channel.split(":")[1];
        const data = JSON.parse(message);

        // Broadcast to all clients in the stream room
        io.to(`stream:${streamId}`).emit(data.type, data.message);
      }
    });

    // Subscribe to all chat channels
    subscriber.psubscribe("chat:*");

    return subscriber;
  }

  async function getRecentMessages(streamId) {
    const streamShard = getStreamShard(streamId);
    const key = `messages:${streamShard}:${streamId}`;
    const messages = await redisClient.zrevrange(key, 0, 49); // Get latest 50 messages
    return messages.map((msg) => JSON.parse(msg)).reverse(); // Oldest first
  }

  // Reset all viewer counts
  async function resetAllViewerCounts() {
    try {
      // Get all viewer count keys
      const keys = await redisClient.keys("viewers:*");

      // Delete all viewer count keys
      if (keys.length > 0) {
        await redisClient.del(...keys);
        console.log(`Reset ${keys.length} viewer counts on server start`);
      }

      // Also delete all viewer tracking keys
      const viewerKeys = await redisClient.keys("viewer:*");
      if (viewerKeys.length > 0) {
        // Delete in batches to avoid Redis command timeout
        const batchSize = 1000;
        for (let i = 0; i < viewerKeys.length; i += batchSize) {
          const batch = viewerKeys.slice(i, i + batchSize);
          await redisClient.del(...batch);
        }
        console.log(
          `Reset ${viewerKeys.length} viewer tracking keys on server start`
        );
      }

      // Set all active streams to have 0 viewers
      const streamIds = await Stream.distinct("streamId");
      for (const streamId of streamIds) {
        await viewerCounter.resetViewerCount(streamId);
        // Broadcast the reset count
        io.emit("viewer_count", { streamId, count: 0 });
      }

      // Also set test streams to 0
      const testStreamIds = [
        "stream-1",
        "stream-2",
        "stream-3",
        "stream-4",
        "default-stream",
      ];
      for (const streamId of testStreamIds) {
        await viewerCounter.resetViewerCount(streamId);
        io.emit("viewer_count", { streamId, count: 0 });
      }
    } catch (error) {
      console.error("Error resetting viewer counts:", error);
    }
  }

  // Clean up stale viewers
  async function cleanupStaleViewers() {
    try {
      // Get all viewer tracking keys
      const viewerKeys = await redisClient.keys("viewer:*");

      // Get all stream IDs
      const streamIds = new Set();
      for (const key of viewerKeys) {
        const parts = key.split(":");
        if (parts.length >= 2) {
          streamIds.add(parts[1]);
        }
      }

      // For each stream, sync the viewer count with the actual number of active viewers
      for (const streamId of streamIds) {
        // Use the viewerCounter utility to sync the count
        const activeViewers = await viewerCounter.syncViewerCount(streamId);

        // Broadcast the updated count
        io.emit("viewer_count", { streamId, count: activeViewers });

        console.log(`Synced viewer count for ${streamId}: ${activeViewers}`);
      }

      console.log(`Cleaned up viewer counts for ${streamIds.size} streams`);
    } catch (error) {
      console.error("Error cleaning up stale viewers:", error);
    }
  }

  // ==================== BETTING SYSTEM FUNCTIONS ====================

  // Send active question to client
  async function sendActiveQuestion(socket, streamId = "default-stream") {
    try {
      // Try to find an active question in the database for this stream
      const activeQuestion = await BetQuestion.findOne({
        active: true,
        resolved: false,
        endTime: { $gt: new Date() },
        streamId: streamId,
      });

      if (activeQuestion) {
        // Calculate actual percentages based on bets placed
        let yesPercentage = 50;
        let noPercentage = 50;

        // If there are bets, calculate the actual percentages
        if (activeQuestion.totalBetAmount > 0) {
          // Find all bets for this question
          const bets = await Bet.find({ questionId: activeQuestion._id });

          if (bets && bets.length > 0) {
            // Calculate total amount bet on Yes and No
            let totalYesAmount = 0;
            let totalNoAmount = 0;

            bets.forEach((bet) => {
              if (bet.choice === "Yes") {
                totalYesAmount += bet.amount;
              } else if (bet.choice === "No") {
                totalNoAmount += bet.amount;
              }
            });

            const totalAmount = totalYesAmount + totalNoAmount;

            // Calculate percentages if there are bets
            if (totalAmount > 0) {
              yesPercentage = Math.round((totalYesAmount / totalAmount) * 100);
              noPercentage = Math.round((totalNoAmount / totalAmount) * 100);

              // Ensure percentages add up to 100%
              if (yesPercentage + noPercentage !== 100) {
                // Adjust to make sure they add up to 100%
                if (yesPercentage > noPercentage) {
                  yesPercentage = 100 - noPercentage;
                } else {
                  noPercentage = 100 - yesPercentage;
                }
              }
            }
          }

          // Update the question with the new percentages
          activeQuestion.yesPercentage = yesPercentage;
          activeQuestion.noPercentage = noPercentage;
          await activeQuestion.save();
        }

        // Get the current camera holder name
        const subject =
          currentCameraHolder?.CameraHolderName ||
          activeQuestion.subject ||
          "Player";

        // Send the real active question from the database with calculated percentages
        socket.emit("current_question", {
          id: activeQuestion._id,
          question: activeQuestion.question,
          subject: subject, // Use the current camera holder name
          condition: activeQuestion.condition,
          endTime: activeQuestion.endTime,
          yesPercentage: yesPercentage,
          noPercentage: noPercentage,
          totalBetAmount: activeQuestion.totalBetAmount || 0,
          totalPlayers: activeQuestion.totalPlayers || 0,
        });

        // Set a timer to resolve this question when it expires
        const now = new Date();
        const timeUntilEnd = activeQuestion.endTime - now;

        if (timeUntilEnd > 0) {
          // Clear any existing timer for this question
          if (questionTimers.has(activeQuestion._id.toString())) {
            clearTimeout(questionTimers.get(activeQuestion._id.toString()));
          }

          // Set a new timer
          const timerId = setTimeout(() => {
            resolveQuestion(activeQuestion._id);
          }, timeUntilEnd);

          // Store the timer ID
          questionTimers.set(activeQuestion._id.toString(), timerId);
        }
      } else {
        // Check if we should generate a new question
        const shouldGenerate = await shouldGenerateQuestions();
        if (!shouldGenerate) {
          console.log(
            "Skipping question generation - camera holder conditions not met"
          );
          socket.emit("no_questions_available", {
            message: "No questions available at this time",
          });
          return;
        }

        // No active question found, create a new one
        const now = new Date();
        const endTime = new Date(now.getTime() + 36000); // 36 seconds from now

        // Get the dynamic question with camera holder name as subject
        const { subject, condition } = await generateRandomQuestion();
        const questionText = `Will ${subject} ${condition}?`;

        // Create a new question in the database with initial 50/50 split
        const newQuestion = new BetQuestion({
          question: questionText,
          subject,
          condition,
          startTime: now,
          endTime,
          active: true,
          yesPercentage: 50,
          noPercentage: 50,
          totalBetAmount: 0,
          totalPlayers: 0,
          hasBets: false,
          streamId: streamId, // Use the provided streamId
        });

        await newQuestion.save();

        // Send the newly created question
        socket.emit("current_question", {
          id: newQuestion._id,
          question: questionText,
          subject: newQuestion.subject,
          condition: newQuestion.condition,
          endTime: newQuestion.endTime,
          yesPercentage: 50, // Default for new question is fine
          noPercentage: 50, // Default for new question is fine
          totalBetAmount: 0,
          totalPlayers: 0,
        });

        // Also broadcast to all clients
        io.emit("new_question", {
          id: newQuestion._id,
          question: questionText,
          subject: newQuestion.subject,
          condition: newQuestion.condition,
          endTime: newQuestion.endTime,
          yesPercentage: 50,
          noPercentage: 50,
          totalBetAmount: 0,
          totalPlayers: 0,
        });

        console.log("Created new question on demand:", questionText);

        // Schedule question resolution after 36 seconds
        const timerId = setTimeout(
          () => resolveQuestion(newQuestion._id),
          36000
        );

        // Store the timer ID
        questionTimers.set(newQuestion._id.toString(), timerId);
      }
    } catch (error) {
      console.error("Error sending active question:", error);

      // Check if we should generate a fallback question
      const shouldGenerate = await shouldGenerateQuestions();
      if (!shouldGenerate) {
        console.log(
          "Skipping fallback question - camera holder conditions not met"
        );
        socket.emit("no_questions_available", {
          message: "No questions available at this time",
        });
        return;
      }

      // Even if there's an error, send a fallback question
      const now = new Date();
      const endTime = new Date(now.getTime() + 36000); // 36 seconds from now

      // Get the dynamic question with camera holder name as subject
      const { subject, condition } = await generateRandomQuestion();
      const questionText = `Will ${subject} ${condition}?`;

      const fallbackQuestion = {
        id: `question-${Date.now()}`,
        question: questionText,
        subject,
        condition,
        endTime,
        yesPercentage: 50,
        noPercentage: 50,
        totalBetAmount: 0,
        totalPlayers: 0,
      };

      socket.emit("current_question", fallbackQuestion);
    }
  }

  // Send betting stats to client
  async function sendBettingStats(socket) {
    try {
      // Get current week's start and end dates
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      // Try to find stats for current week
      let stats = await BetStats.findOne({
        weekStartDate: { $lte: now },
        weekEndDate: { $gte: now },
      });

      // If no stats found, create default stats with ZERO values (not mock data)
      if (!stats) {
        stats = {
          totalBetsAmount: 0,
          biggestWinThisWeek: 0,
          totalPlayers: 0,
          activePlayers: 0,
        };
      }

      // Send the real stats to the client
      socket.emit("betting_stats", stats);

      console.log("Sent betting stats to client:", stats);
    } catch (error) {
      console.error("Error sending betting stats:", error);

      // Even on error, send zero values instead of mock data
      socket.emit("betting_stats", {
        totalBetsAmount: 0,
        biggestWinThisWeek: 0,
        totalPlayers: 0,
        activePlayers: 0,
      });
    }
  }

  // Setup automated question generation
  function setupQuestionGenerator() {
    // Run every 36 seconds
    cron.schedule("*/36 * * * * *", async () => {
      try {
        // First check if questions should be generated at all
        const shouldGenerate = await shouldGenerateQuestions();
        if (!shouldGenerate) {
          console.log(
            "Skipping question generation - camera holder conditions not met"
          );
          return;
        }

        // Check if there's an active question
        const activeQuestion = await BetQuestion.findOne({
          active: true,
          resolved: false,
          endTime: { $gt: new Date() },
        });

        // Only generate a new question if there's no active one
        if (!activeQuestion) {
          // Get all active streams
          const activeStreams = await Stream.find({
            status: "active",
          }).distinct("streamId");

          // If no active streams, use default
          if (!activeStreams || activeStreams.length === 0) {
            await generateNewQuestion("default-stream");
          } else {
            // Generate a question for each active stream
            for (const streamId of activeStreams) {
              await generateNewQuestion(streamId);
            }
          }
        } else {
          console.log("Active question exists, skipping generation");
        }
      } catch (error) {
        console.error("Error in question generator cron job:", error);
        // Even if there's an error, try to generate a question with default streamId
        try {
          await generateNewQuestion("default-stream");
        } catch (fallbackError) {
          console.error("Failed to generate fallback question:", fallbackError);
        }
      }
    });
  }

  // Create API endpoint for synchronous decrements (for beforeunload events)
  server.on("request", async (req, res) => {
    if (req.method === "POST" && req.url.startsWith("/api/viewer/decrement/")) {
      try {
        const streamId = req.url.split("/").pop();
        if (!streamId) {
          res.writeHead(400);
          res.end(
            JSON.stringify({ success: false, message: "Stream ID required" })
          );
          return;
        }

        // Decrement the viewer count using the viewerCounter utility
        const newCount = await viewerCounter.decrementViewers(streamId);

        // Broadcast the updated count
        io.emit("viewer_count", { streamId, count: newCount });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, viewerCount: newCount }));
      } catch (error) {
        console.error("Error in sync decrement:", error);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, message: "Server error" }));
      }
    }
  });

  // Make sure to clean up the subscriber when the server shuts down
  process.on("SIGTERM", () => {
    chatSubscriber.punsubscribe();
    chatSubscriber.quit();
  });

  return io;
};

// Export the io instance and the getCurrentCameraHolder function
module.exports.io = io;
module.exports.getCurrentCameraHolder = getCurrentCameraHolder;