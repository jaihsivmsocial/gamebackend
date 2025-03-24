const mongoose = require("mongoose");
const { MongoClient } = require("mongodb");
// Connection pooling configuration
const connectionOptions = {
  maxPoolSize: 100,
  minPoolSize: 10,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 30000,
  heartbeatFrequencyMS: 10000,
  retryWrites: true,
  retryReads: true,
  w: "majority",
  wtimeoutMS: 10000,
  readPreference: "secondaryPreferred",
  readConcern: { level: "majority" },
};

let mongoClient = null;

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URL, connectionOptions);
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    mongoClient = new MongoClient(process.env.MONGO_URL, connectionOptions);
    await mongoClient.connect();
    console.log("MongoDB Client Connected for bulk operations");

    return conn;
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

const getMongoClient = () => {
  if (!mongoClient) {
    throw new Error("MongoDB client not initialized");
  }
  return mongoClient;
};

const closeConnections = async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("Mongoose connection closed");
    }

    if (mongoClient) {
      await mongoClient.close();
      console.log("MongoDB client connection closed");
    }
  } catch (error) {
    console.error(`Error closing MongoDB connections: ${error.message}`);
  }
};

process.on("SIGINT", async () => {
  await closeConnections();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeConnections();
  process.exit(0);
});

// Use `module.exports` instead of `export`
module.exports = { connectDB, getMongoClient, closeConnections };
