const { MongoClient } = require( "mongodb")
const fs =require( "fs")
const readline= require( "readline")
const dotenv= require= ("dotenv")
const { Worker, isMainThread, parentPort, workerData } = require( "worker_threads")
const os = require("os")

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI
const BATCH_SIZE = 10000
const NUM_WORKERS = os.cpus().length

// Worker thread function
if (!isMainThread) {
  const { batchData, collection } = workerData

  async function processBatch() {
    try {
      const client = new MongoClient(MONGODB_URI)
      await client.connect()
      const db = client.db()

      // Insert the batch
      const result = await db.collection(collection).insertMany(batchData, { ordered: false })

      await client.close()

      parentPort.postMessage({
        success: true,
        count: result.insertedCount,
      })
    } catch (error) {
      parentPort.postMessage({
        success: false,
        error: error.message,
      })
    }
  }

  processBatch()
}

// Main thread function
async function bulkImport(filePath, collection) {
  if (!isMainThread) return

  console.log(`Starting bulk import for ${collection} from ${filePath}`)
  console.log(`Using ${NUM_WORKERS} worker threads with batch size of ${BATCH_SIZE}`)

  const startTime = Date.now()
  let totalProcessed = 0
  let currentBatch = []
  let activeWorkers = 0
  let fileLineCount = 0

  // Count total lines in file
  const fileStream = fs.createReadStream(filePath)
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Number.POSITIVE_INFINITY,
  })

  for await (const line of rl) {
    fileLineCount++
  }

  console.log(`File contains ${fileLineCount} records to import`)

  // Process the file
  const fileStream2 = fs.createReadStream(filePath)
  const rl2 = readline.createInterface({
    input: fileStream2,
    crlfDelay: Number.POSITIVE_INFINITY,
  })

  // Function to create a worker for a batch
  const processBatchWithWorker = (batch) => {
    return new Promise((resolve) => {
      activeWorkers++

      const worker = new Worker(__filename, {
        workerData: {
          batchData: batch,
          collection,
        },
      })

      worker.on("message", (result) => {
        activeWorkers--

        if (result.success) {
          totalProcessed += result.count
          console.log(
            `Imported ${result.count} documents. Total: ${totalProcessed}/${fileLineCount} (${Math.round((totalProcessed / fileLineCount) * 100)}%)`,
          )
        } else {
          console.error(`Batch import error: ${result.error}`)
        }

        resolve()
      })

      worker.on("error", (err) => {
        activeWorkers--
        console.error(`Worker error: ${err}`)
        resolve()
      })
    })
  }

  // Process each line
  for await (const line of rl2) {
    try {
      const document = JSON.parse(line)
      currentBatch.push(document)

      if (currentBatch.length >= BATCH_SIZE) {
        // Wait if we have too many active workers
        while (activeWorkers >= NUM_WORKERS) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        const batchToProcess = [...currentBatch]
        currentBatch = []
        processBatchWithWorker(batchToProcess)
      }
    } catch (error) {
      console.error(`Error parsing line: ${error.message}`)
    }
  }

  // Process remaining documents
  if (currentBatch.length > 0) {
    await processBatchWithWorker(currentBatch)
  }

  // Wait for all workers to complete
  while (activeWorkers > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  const duration = (Date.now() - startTime) / 1000
  console.log(`Bulk import completed: ${totalProcessed} documents imported in ${duration.toFixed(2)} seconds`)
  console.log(`Average rate: ${Math.round(totalProcessed / duration)} documents per second`)
}

// Example usage
if (isMainThread && process.argv[2] && process.argv[3]) {
  const filePath = process.argv[2]
  const collection = process.argv[3]
  bulkImport(filePath, collection).catch(console.error)
} else if (isMainThread) {
  console.log("Usage: node bulk-import.js <file-path> <collection-name>")
  console.log("Example: node bulk-import.js ./data/users.jsonl users")
}

