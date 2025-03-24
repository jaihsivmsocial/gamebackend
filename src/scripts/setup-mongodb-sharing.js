// This script should be run on a MongoDB admin database to set up sharding
// Run with: mongo admin setup-mongodb-sharding.js

// Enable sharding for the database
sh.enableSharding("livestream_db")

// Shard the users collection by shardKey
db.adminCommand({
  shardCollection: "livestream_db.users",
  key: { shardKey: 1 },
})

// Shard the messages collection by streamId (for co-location of stream messages)
db.adminCommand({
  shardCollection: "livestream_db.messages",
  key: { streamId: 1, timestamp: -1 },
})

// Shard the streams collection by _id
db.adminCommand({
  shardCollection: "livestream_db.streams",
  key: { _id: 1 },
})

// Create indexes for the users collection
db.users.createIndex({ username: 1 }, { unique: true })
db.users.createIndex({ email: 1 }, { unique: true })
db.users.createIndex({ isStreaming: 1 })
db.users.createIndex({ lastSeen: 1 })
db.users.createIndex({ username: 1, email: 1 })
db.users.createIndex({ isStreaming: 1, lastSeen: -1 })
db.users.createIndex({ role: 1, isStreaming: 1 })

// Create indexes for the messages collection
db.messages.createIndex({ streamId: 1, timestamp: -1 })
db.messages.createIndex({ sender: 1, timestamp: -1 })
db.messages.createIndex({ timestamp: 1 }, { expireAfterSeconds: 604800 }) // 7 days TTL

// Create indexes for the streams collection
db.streams.createIndex({ streamer: 1 })
db.streams.createIndex({ isLive: 1 })
db.streams.createIndex({ tags: 1 })
db.streams.createIndex({ isLive: 1, viewCount: -1 })

// Configure chunk size (default is 64MB)
db.adminCommand({ setParameter: 1, chunkSize: 32 }) // 32MB chunks for better distribution

print("MongoDB sharding configuration completed")

