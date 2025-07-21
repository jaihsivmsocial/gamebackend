
const express = require("express")
const http = require("http")
const cors = require("cors")
const dotenv = require("dotenv")
const helmet = require("helmet")
const compression = require("compression")
const betRoutes = require("./src/routes/betroute/bet-routes.js")
const { connectDB } = require("./src/config/mongodb.js")
const authRoutes = require("./src/routes/authRoute/userroute.js")
const apiRoutes = require("./src/routes/api-routes.js")
const setupSocketIO = require("./src/sockets/socket-manager.js")
const streamRoutes = require("./src/routes/streamRoute/stream-routes.js")
const messageRoutes = require("./src/routes/messageRoute/message-routes.js")
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

// Security middleware
app.use(helmet())

// Compression middleware
app.use(compression())

// CORS middleware


app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        process.env.FRONTEND_URL || "http://localhost:3000",
        "http://5mof.gg.",
        "http://www.5mof.gg",
        "http://16.170.172.129",
      ]
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, origin || "*")
      } else {
        callback(new Error("Not allowed by CORS"))
      }
    },
    credentials: true,
  }),
)

// Body parsing middleware
app.use(express.json({ limit: "100mb" })) // Increased for video uploads
app.use(express.urlencoded({ extended: true, limit: "100mb" }))

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

// Add video routes
app.use("/api/videos", videoRoutes)

// Health check route
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ message: "Something went wrong!" })
})

// Connect to MongoDB and start server
const PORT = process.env.PORT || 5000

const startServer = async () => {
  try {
    await connectDB()
    await initializeSocketIO()
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
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
