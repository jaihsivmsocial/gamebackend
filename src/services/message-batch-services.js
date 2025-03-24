// const { getMongoClient }= require( "../config/mongodb")


const getMongoClient = async () => {
    const module = await import("../config/mongodb.js");
    return module.getMongoClient;
  };
  
class MessageBatchService {
  constructor() {
    this.batchSize = 1000 
    this.flushInterval = 5000 
    this.messageQueue = new Map() 
    this.timer = null
    this.isProcessing = false
  }

  initialize() {
    // Start the flush timer
    this.timer = setInterval(() => this.flush(), this.flushInterval)
    console.log("Message batch service initialized")
  }

  async queueMessage(message) {
    const streamId = message.streamId

    if (!this.messageQueue.has(streamId)) {
      this.messageQueue.set(streamId, [])
    }

    this.messageQueue.get(streamId).push(message)

    // If we've reached the batch size for this stream, flush immediately
    if (this.messageQueue.get(streamId).length >= this.batchSize) {
      this.flushStream(streamId)
    }
  }

  async flushStream(streamId) {
    if (this.isProcessing) return

    const messages = this.messageQueue.get(streamId)
    if (!messages || messages.length === 0) return

    this.isProcessing = true

    try {
      // Clear the queue first to avoid processing the same messages twice
      this.messageQueue.set(streamId, [])

      // Use the MongoDB driver directly for better performance
      const client = getMongoClient()
      const db = client.db()
      const collection = db.collection("messages")

      // Insert messages in bulk
      await collection.insertMany(messages, { ordered: false })

      console.log(`Flushed ${messages.length} messages for stream ${streamId}`)
    } catch (error) {
      console.error(`Error flushing messages for stream ${streamId}:`, error)
      // Put the messages back in the queue
      const currentMessages = this.messageQueue.get(streamId) || []
      this.messageQueue.set(streamId, [...messages, ...currentMessages])
    } finally {
      this.isProcessing = false
    }
  }

  async flush() {
    if (this.isProcessing) return

    const streamIds = Array.from(this.messageQueue.keys())
    for (const streamId of streamIds) {
      await this.flushStream(streamId)
    }
  }

  shutdown() {
    if (this.timer) {
      clearInterval(this.timer)
    }

    // Flush any remaining messages
    return this.flush()
  }
}

export default new MessageBatchService()

