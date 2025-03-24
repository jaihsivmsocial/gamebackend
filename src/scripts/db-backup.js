const { exec }= require( "child_process")
const fs = require( "fs")
const path =require( "path")
const dotenv = require ("dotenv")
const { promisify } = require( "util")

dotenv.config()

const execPromise = promisify(exec)
const MONGODB_URI = process.env.MONGODB_URI
const BACKUP_DIR = path.join(process.cwd(), "backups")

// Parse MongoDB URI to get database name
function getDatabaseName(uri) {
  const parts = uri.split("/")
  const dbNameWithParams = parts[parts.length - 1]
  return dbNameWithParams.split("?")[0]
}

async function createBackup() {
  try {
    const dbName = getDatabaseName(MONGODB_URI)
    const timestamp = new Date().toISOString().replace(/:/g, "-")
    const backupPath = path.join(BACKUP_DIR, `${dbName}_${timestamp}`)

    // Create backup directory if it doesn't exist
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true })
    }

    console.log(`Creating backup of ${dbName} at ${backupPath}`)

    // Run mongodump
    const { stdout, stderr } = await execPromise(`mongodump --uri="${MONGODB_URI}" --out="${backupPath}"`)

    if (stderr && !stderr.includes("done dumping")) {
      throw new Error(stderr)
    }

    console.log(`Backup completed successfully: ${backupPath}`)
    console.log(stdout)

    // Compress the backup
    console.log("Compressing backup...")
    const compressedFile = `${backupPath}.tar.gz`
    await execPromise(`tar -czf "${compressedFile}" -C "${path.dirname(backupPath)}" "${path.basename(backupPath)}"`)

    console.log(`Backup compressed: ${compressedFile}`)

    // Remove the uncompressed backup
    await execPromise(`rm -rf "${backupPath}"`)

    return compressedFile
  } catch (error) {
    console.error("Backup failed:", error)
    throw error
  }
}

async function restoreBackup(backupFile) {
  try {
    console.log(`Restoring backup from ${backupFile}`)

    // Extract the compressed backup
    const extractPath = path.join(BACKUP_DIR, "temp_restore")
    if (fs.existsSync(extractPath)) {
      await execPromise(`rm -rf "${extractPath}"`)
    }

    fs.mkdirSync(extractPath, { recursive: true })

    await execPromise(`tar -xzf "${backupFile}" -C "${extractPath}"`)

    // Find the extracted directory
    const extractedDirs = fs.readdirSync(extractPath)
    if (extractedDirs.length === 0) {
      throw new Error("No backup found in the archive")
    }

    const extractedPath = path.join(extractPath, extractedDirs[0])

    // Run mongorestore
    const { stdout, stderr } = await execPromise(`mongorestore --uri="${MONGODB_URI}" --drop "${extractedPath}"`)

    if (stderr && !stderr.includes("done")) {
      throw new Error(stderr)
    }

    console.log("Restore completed successfully")
    console.log(stdout)

    // Clean up
    await execPromise(`rm -rf "${extractPath}"`)

    return true
  } catch (error) {
    console.error("Restore failed:", error)
    throw error
  }
}

// Command line interface
async function main() {
  const command = process.argv[2]

  if (command === "backup") {
    await createBackup()
  } else if (command === "restore" && process.argv[3]) {
    await restoreBackup(process.argv[3])
  } else {
    console.log("Usage:")
    console.log("  node db-backup.js backup")
    console.log("  node db-backup.js restore <backup-file>")
  }
}

if (require.main === module) {
  main().catch(console.error)
}

export { createBackup, restoreBackup }

