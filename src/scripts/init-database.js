const  mongoose = require( "mongoose")
const { MongoClient } = require( "mongodb")
const dotenv= require( "dotenv")

// Load environment variables
dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI

async function initializeDatabase() {
  try {
    console.log("Initializing database...")

    // Connect with Mongoose
    await mongoose.connect(MONGODB_URI)
    console.log("Connected to MongoDB with Mongoose")

    // Connect with MongoDB driver for advanced operations
    const client = new MongoClient(MONGODB_URI)
    await client.connect()
    console.log("Connected to MongoDB with native driver")

    const db = client.db()

    // Create collections with optimized settings
    await db.createCollection("users", {
      validator: {
        $jsonSchema: {
          bsonType: "object",
          required: ["username", "email", "password", "shardKey"],
          properties: {
            username: {
              bsonType: "string",
              description: "Username must be a string and is required",
            },
            email: {
              bsonType: "string",
              description: "Email must be a string and is required",
            },
            password: {
              bsonType: "string",
              description: "Password must be a string and is required",
            },
            shardKey: {
              bsonType: "string",
              description: "Shard key must be a string and is required",
            },
          },
        },
      },
      validationLevel: "moderate",
    })
    console.log("Created users collection")

    await db.createCollection("messages", {
      timeseries: {
        timeField: "timestamp",
        metaField: "streamId",
        granularity: "seconds",
      },
    })
    console.log("Created messages collection as a time series collection")

    // Create indexes
    await db
      .collection("users")
      .createIndexes([
        { key: { username: 1 }, unique: true },
        { key: { email: 1 }, unique: true },
        { key: { shardKey: 1 } },
        { key: { isStreaming: 1 } },
        { key: { lastSeen: 1 } },
        { key: { username: 1, email: 1 } },
        { key: { isStreaming: 1, lastSeen: -1 } },
      ])
    console.log("Created indexes for users collection")

    await db.collection("messages").createIndexes([
      { key: { streamId: 1, timestamp: -1 } },
      { key: { sender: 1, timestamp: -1 } },
      { key: { timestamp: 1 }, expireAfterSeconds: 604800 }, // 7 days TTL
    ])
    console.log("Created indexes for messages collection")

    // Create capped collection for active streams
    await db.createCollection("active_streams", {
      capped: true,
      size: 100000000, // 100MB
      max: 10000, // Maximum 10,000 documents
    })
    console.log("Created capped collection for active streams")

    // Create a collection for analytics with pre-aggregation
    await db.createCollection("stream_analytics")
    await db.collection("stream_analytics").createIndex({ streamId: 1, date: 1 }, { unique: true })
    console.log("Created analytics collection")

    console.log("Database initialization completed successfully")

    // Close connections
    await mongoose.disconnect()
    await client.close()
  } catch (error) {
    console.error("Database initialization failed:", error)
    process.exit(1)
  }
}

// Run the initialization
initializeDatabase()

