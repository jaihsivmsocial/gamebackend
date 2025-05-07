const mongoose = require("mongoose")

/**
 * Middleware to validate that a parameter is a valid MongoDB ObjectId
 * @param {string} paramName - The name of the parameter to validate
 * @returns {Function} Express middleware function
 */
const validateObjectId = (paramName) => {
  return (req, res, next) => {
    const paramValue = req.params[paramName]

    if (!paramValue) {
      return res.status(400).json({
        success: false,
        message: `${paramName} parameter is required`,
      })
    }

    if (!mongoose.Types.ObjectId.isValid(paramValue)) {
      return res.status(400).json({
        success: false,
        message: `Invalid ${paramName} format`,
      })
    }

    next()
  }
}

module.exports = validateObjectId
