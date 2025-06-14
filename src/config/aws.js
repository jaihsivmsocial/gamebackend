
const AWS = require("aws-sdk")

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || "us-east-1",
})

const s3 = new AWS.S3()

// Helper function to sanitize filename
const sanitizeFilename = (filename) => {
  if (!filename) return "video"
  return filename
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_{2,}/g, "_")
    .toLowerCase()
}

const uploadToS3 = async (file, fileName, contentType) => {
  try {
    const sanitizedFileName = sanitizeFilename(fileName)
    const key = `videos/${Date.now()}-${Math.random().toString(36).substring(7)}-${sanitizedFileName}`

    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Body: file,
      ContentType: contentType,
      // No ACL - bucket policy will handle public access
      Metadata: {
        uploadedAt: new Date().toISOString().replace(/[^\w]/g, "_"),
        fileType: contentType.replace(/[^\w/]/g, "_"),
      },
      CacheControl: "max-age=31536000",
    }

    console.log("Uploading to S3...")
    const result = await s3.upload(params).promise()
    console.log(`File uploaded successfully: ${key}`)

    // If using CloudFront, replace the URL
    let publicUrl = result.Location
    if (process.env.CLOUDFRONT_DOMAIN) {
      publicUrl = `https://${process.env.CLOUDFRONT_DOMAIN}/${key}`
    }

    return {
      url: publicUrl,
      key: result.Key,
    }
  } catch (error) {
    console.error("S3 upload error:", error)
    throw new Error(`Failed to upload video: ${error.message}`)
  }
}

const deleteFromS3 = async (key) => {
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
  }

  try {
    await s3.deleteObject(params).promise()
    console.log(`File deleted successfully: ${key}`)
  } catch (error) {
    console.error("S3 delete error:", error)
    throw new Error(`Failed to delete video: ${error.message}`)
  }
}

const generatePresignedUrl = async (key, expiresIn = 3600) => {
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    Expires: expiresIn,
  }

  try {
    const url = await s3.getSignedUrlPromise("getObject", params)
    return url
  } catch (error) {
    console.error("Presigned URL generation error:", error)
    throw new Error("Failed to generate download URL")
  }
}

module.exports = { uploadToS3, deleteFromS3, generatePresignedUrl }
