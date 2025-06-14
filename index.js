
// const express = require("express")
// const http = require("http")
// const cors = require("cors")
// const dotenv = require("dotenv")
// const helmet = require("helmet")
// const compression = require("compression")
// const betRoutes = require("./src/routes/betroute/bet-routes.js")
// const { connectDB } = require("./src/config/mongodb.js")
// const authRoutes = require("./src/routes/userroute.js")
// const apiRoutes = require("./src/routes/api-routes.js")
// const setupSocketIO = require("./src/sockets/socket-manager.js")
// const streamRoutes = require("./src/routes/stream-routes.js")
// const messageRoutes = require("./src/routes/message-routes.js")
// const qualitySettingsRoutes = require("./src/routes/quality-routes.js")
// const playerRoutes = require("./src/routes/betroute/player-route.js")
// const paymentRoutes = require("./src/routes/paymentRoute/payment-routes.js")
// const webhookRoutes = require("./src/routes/paymentRoute/webhookRoutes")

// // Add video routes
// const videoRoutes = require("./src/routes/clipRoute/videoRoutes.js")

// require("./src/controller/CronJob/CheckAnswers.js")

// // Load environment variables
// dotenv.config()

// // Set a fallback JWT_SECRET if not provided
// if (!process.env.JWT_SECRET) {
//   console.warn("JWT_SECRET not found in environment variables. Using fallback secret for development.")
//   process.env.JWT_SECRET = "fallback_secret_for_development"
// }

// // Initialize Express app
// const app = express()
// app.use((req, res, next) => {
//   if (req.originalUrl === "/api/payments/webhook") {
//     let rawBody = ""
//     req.on("data", (chunk) => {
//       rawBody += chunk.toString()
//     })
//     req.on("end", () => {
//       req.rawBody = rawBody
//       next()
//     })
//   } else {
//     next()
//   }
// })
// const server = http.createServer(app)

// // Security middleware
// app.use(helmet())

// // Compression middleware
// app.use(compression())

// // CORS middleware
// app.use(
//   cors({
//     origin: (origin, callback) => {
//       const allowedOrigins = [
//         process.env.FRONTEND_URL || "http://localhost:3000",
//         "http://test.tribez.gg",
//         "http://www.test.tribez.gg",
//         "http://13.48.129.159",
//       ]
//       if (!origin || allowedOrigins.includes(origin)) {
//         callback(null, origin || "*")
//       } else {
//         callback(new Error("Not allowed by CORS"))
//       }
//     },
//     credentials: true,
//   }),
// )

// // Body parsing middleware
// app.use(express.json({ limit: "10mb" })) // Increased for video uploads
// app.use(express.urlencoded({ extended: true, limit: "10mb" }))

// // Initialize Socket.io
// let io
// const initializeSocketIO = async () => {
//   io = await setupSocketIO(server)
// }

// // Add io to request object for use in controllers
// app.use((req, res, next) => {
//   req.io = io
//   next()
// })

// // Routes
// app.use("/api", authRoutes)
// app.use("/api", apiRoutes)
// app.use("/api/bets", betRoutes)
// app.use("/api", streamRoutes)
// app.use("/api", messageRoutes)
// app.use("/api/quality-settings", qualitySettingsRoutes)
// app.use("/api/players", playerRoutes)
// app.use("/api/payments", paymentRoutes)
// app.use("/api/webhook", webhookRoutes)

// // Add video routes
// app.use("/api/videos", videoRoutes)

// // Health check route
// app.get("/health", (req, res) => {
//   res.status(200).json({
//     status: "ok",
//     timestamp: new Date().toISOString(),
//     uptime: process.uptime(),
//   })
// })

// // Error handling middleware
// app.use((err, req, res, next) => {
//   console.error(err.stack)
//   res.status(500).json({ message: "Something went wrong!" })
// })

// // Connect to MongoDB and start server
// const PORT = process.env.PORT || 5000

// const startServer = async () => {
//   try {
//     await connectDB()
//     await initializeSocketIO()
//     server.listen(PORT, () => {
//       console.log(`Server running on port ${PORT}`)
//     })
//   } catch (error) {
//     console.error(`Failed to start server: ${error.message}`)
//     process.exit(1)
//   }
// }

// startServer()

// // Handle graceful shutdown
// process.on("SIGINT", () => {
//   console.log("Shutting down server...")
//   server.close(() => process.exit(0))
// })

// process.on("SIGTERM", () => {
//   console.log("Shutting down server...")
//   server.close(() => process.exit(0))
// })

const express = require("express")
const http = require("http")
const cors = require("cors")
const dotenv = require("dotenv")
const helmet = require("helmet")
const compression = require("compression")
const betRoutes = require("./src/routes/betroute/bet-routes.js")
const { connectDB } = require("./src/config/mongodb.js")
const authRoutes = require("./src/routes/userroute.js")
const apiRoutes = require("./src/routes/api-routes.js")
const setupSocketIO = require("./src/sockets/socket-manager.js")
const streamRoutes = require("./src/routes/stream-routes.js")
const messageRoutes = require("./src/routes/message-routes.js")
const qualitySettingsRoutes = require("./src/routes/quality-routes.js")
const playerRoutes = require("./src/routes/betroute/player-route.js")
const paymentRoutes = require("./src/routes/paymentRoute/payment-routes.js")
const webhookRoutes = require("./src/routes/paymentRoute/webhookRoutes")

// Add video routes
const videoRoutes = require("./src/routes/clipRoute/videoRoutes.js")

require("./src/controller/CronJob/CheckAnswers.js")

// Load environment variables
dotenv.config()

// Set a fallback JWT_SECRET if not provided
if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET not found in environment variables. Using fallback secret for development.")
  process.env.JWT_SECRET = "fallback_secret_for_development"
}

// Initialize Express app
const app = express()

// Raw body middleware for webhooks (must be before other body parsers)
app.use((req, res, next) => {
  if (req.originalUrl === "/api/payments/webhook") {
    let rawBody = ""
    req.on("data", (chunk) => {
      rawBody += chunk.toString()
    })
    req.on("end", () => {
      req.rawBody = rawBody
      next()
    })
  } else {
    next()
  }
})

const server = http.createServer(app)

// Security middleware - UPDATED for video uploads
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  }),
)

// Compression middleware
app.use(compression())

// CORS middleware - FIXED
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        process.env.FRONTEND_URL || "http://localhost:3000",
        "http://localhost:3000",
        "https://localhost:3000",
        "http://test.tribez.gg",
        "http://www.test.tribez.gg",
        "http://13.48.129.159",
        "https://test.tribez.gg",
        "https://www.test.tribez.gg",

      ]

      console.log(`CORS check - Origin: ${origin}`)

      // Allow requests with no origin (mobile apps, curl, Postman, etc.)
      if (!origin) {
        console.log("No origin - allowing request")
        return callback(null, true)
      }

      if (allowedOrigins.includes(origin)) {
        console.log(`Origin ${origin} is allowed`)
        callback(null, true)
      } else {
        console.log(`Origin ${origin} is NOT allowed`)
        callback(new Error(`Not allowed by CORS: ${origin}`))
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "Origin",
      "X-Requested-With",
      "Access-Control-Allow-Origin",
      "Access-Control-Allow-Headers",
      "Access-Control-Allow-Methods",
    ],
    exposedHeaders: ["Content-Length", "Content-Type"],
    optionsSuccessStatus: 200,
  }),
)

// Handle preflight requests explicitly
app.options("*", cors())

// Body parsing middleware - UPDATED for larger video files
app.use(express.json({ limit: "100mb" })) // Increased for video uploads
app.use(express.urlencoded({ extended: true, limit: "100mb" }))

// Add request logging middleware for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
  console.log("Headers:", req.headers)
  if (req.method === "POST" && req.path.includes("upload")) {
    console.log("Upload request detected")
  }
  next()
})

// Initialize Socket.io
let io
const initializeSocketIO = async () => {
  io = await setupSocketIO(server)
}

// Add io to request object for use in controllers
app.use((req, res, next) => {
  req.io = io
  next()
})

// Routes
app.use("/api", authRoutes)
app.use("/api", apiRoutes)
app.use("/api/bets", betRoutes)
app.use("/api", streamRoutes)
app.use("/api", messageRoutes)
app.use("/api/quality-settings", qualitySettingsRoutes)
app.use("/api/players", playerRoutes)
app.use("/api/payments", paymentRoutes)
app.use("/api/webhook", webhookRoutes)

// Add video routes - MAKE SURE THIS IS WORKING
app.use("/api/videos", videoRoutes)

// Test route for debugging
app.get("/api/test", (req, res) => {
  res.json({
    message: "API is working",
    timestamp: new Date().toISOString(),
    origin: req.headers.origin,
  })
})

// Health check route
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

// Error handling middleware - IMPROVED
app.use((err, req, res, next) => {
  console.error("Error occurred:", err.stack)

  // CORS error
  if (err.message && err.message.includes("CORS")) {
    return res.status(403).json({
      success: false,
      message: "CORS error: Origin not allowed",
      error: err.message,
    })
  }

  // File upload errors
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      message: "File too large",
      error: "File size exceeds the limit",
    })
  }

  // Generic error
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "development" ? err.message : "Internal server error",
  })
})

// 404 handler
app.use("*", (req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`)
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  })
})

// Connect to MongoDB and start server
const PORT = process.env.PORT || 5000

const startServer = async () => {
  try {
    await connectDB()
    await initializeSocketIO()
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`)
      console.log(`Server accessible at:`)
      console.log(`- http://localhost:${PORT}`)
      console.log(`- http://apitest.tribez.gg:${PORT}`)
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`)
    })
  } catch (error) {
    console.error(`Failed to start server: ${error.message}`)
    process.exit(1)
  }
}

startServer()

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down server...")
  server.close(() => process.exit(0))
})

process.on("SIGTERM", () => {
  console.log("Shutting down server...")
  server.close(() => process.exit(0))
})
