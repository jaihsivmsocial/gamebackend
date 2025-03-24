const rateLimit = require("express-rate-limit");

const chatLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 10, // Allow 10 messages per second
  message: "Too many messages sent, slow down!",
});

module.exports = chatLimiter;
