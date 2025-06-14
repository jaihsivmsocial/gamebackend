const Joi = require("joi")

const videoUploadSchema = Joi.object({
  title: Joi.string().required().min(1).max(200).trim(),
  description: Joi.string().max(1000).trim().allow(""),
  tags: Joi.string().max(500).allow(""),
})

const commentSchema = Joi.object({
  text: Joi.string().required().min(1).max(500).trim(),
})

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
  sortBy: Joi.string().valid("createdAt", "views", "likes").default("createdAt"),
  sortOrder: Joi.string().valid("asc", "desc").default("desc"),
})

const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body)
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((detail) => detail.message),
      })
    }
    req.validatedData = value
    next()
  }
}

const validateQuery = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query)
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Query validation error",
        errors: error.details.map((detail) => detail.message),
      })
    }
    req.validatedQuery = value
    next()
  }
}

module.exports = {
  videoUploadSchema,
  commentSchema,
  paginationSchema,
  validateRequest,
  validateQuery,
}
