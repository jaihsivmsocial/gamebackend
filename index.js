
const express = require("express")
const http = require("http")
const cors = require("cors")
const dotenv = require("dotenv")
const helmet = require("helmet")
const compression = require("compression")
const { connectDB } = require("./src/config/mongodb.js")
const authRoutes = require("./src/routes/userroute.js")
const apiRoutes = require("./src/routes/api-routes.js")
const setupSocketIO = require("./src/sockets/socket-manager.js")
const streamRoutes= require( "./src/routes/stream-routes.js")
const  messageRoutes = require( "./src/routes/message-routes.js")
const qualitySettingsRoutes = require("./src/routes/quality-routes.js")
// Load environment variables
dotenv.config()

// Initialize Express app
const app = express()
const server = http.createServer(app)

// Security middleware
app.use(helmet())

// Compression middleware
app.use(compression())

// CORS middleware
app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL || "http://localhost:3000",
      "http://test.tribez.gg",
      "http://www.test.tribez.gg",
      "http://13.48.129.159",
    ],
    credentials: true, 
  })
);
// Body parsing middleware
app.use(express.json({ limit: "1mb" }))
app.use(express.urlencoded({ extended: true, limit: "1mb" }))

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
app.use("/api", streamRoutes)
app.use("/api", messageRoutes)
app.use("/api/quality-settings", qualitySettingsRoutes)
// Health check route
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" })
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
    // Connect to MongoDB
    await connectDB()

    // Initialize Socket.IO
    await initializeSocketIO()

    // Start HTTP server
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

