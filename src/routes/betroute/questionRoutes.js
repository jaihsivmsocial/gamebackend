const express = require("express")
const router = express.Router()
const authenticate = require("../../middleware/authMiddleware")
const BetQuestion= require("../../model/battingModel/BetQuestion")

const questionController = {
    generateBetQuestion: async (req, res) => {
      try {
        // Deactivate any existing active questions
        await BetQuestion.updateMany({ active: true, resolved: false }, { active: false })
  
        // Generate a new question
        const subjects = [
          "James5423",
          "Alex98",
          "NinjaWarrior",
          "StreamQueen",
          "ProGamer42",
          "MasterChief",
          "ShadowHunter",
          "DragonSlayer",
          "PixelPirate",
          "CyberNinja",
        ]
  
        const conditions = [
          "survive for 5 minutes",
          "defeat the boss",
          "reach the checkpoint",
          "collect 10 coins",
          "find the hidden treasure",
          "escape the dungeon",
          "win the next battle",
          "avoid damage for 2 minutes",
          "complete the mission",
          "reach level 10",
        ]
  
        const randomSubject = subjects[Math.floor(Math.random() * subjects.length)]
        const randomCondition = conditions[Math.floor(Math.random() * conditions.length)]
  
        const questionText = `Will ${randomSubject} ${randomCondition}?`
        const endTime = new Date(Date.now() + 30 * 1000) // 30 seconds from now
  
        // Get current stream ID from request or use default
        const streamId = req.body.streamId || "default-stream"
  
        // Create a new question in the database
        const newQuestion = new BetQuestion({
          question: questionText,
          subject: randomSubject,
          condition: randomCondition,
          startTime: new Date(),
          endTime,
          active: true,
          streamId: streamId,
        })
  
        // Save to database
        await newQuestion.save()
  
        console.log("Created new question:", newQuestion)
  
        // Emit socket event for new question
        if (req.io) {
          req.io.emit("new_question", {
            id: newQuestion._id,
            question: questionText,
            subject: randomSubject,
            condition: randomCondition,
            endTime,
            yesPercentage: 50,
            noPercentage: 50,
          })
        }
  
        res.status(201).json({
          success: true,
          question: newQuestion,
        })
      } catch (error) {
        console.error("Generate question error:", error)
        res.status(500).json({
          success: false,
          message: "Server error while generating question",
        })
      }
    },
  
    getCurrentQuestion: async (req, res) => {
      try {
        // Try to find an active question in the database
        let currentQuestion = await BetQuestion.findOne({
          active: true,
          resolved: false,
        })
  
        // If no active question found, create a new one
        if (!currentQuestion) {
          const subjects = ["James5423", "Alex98", "NinjaWarrior", "StreamQueen", "ProGamer42"]
          const conditions = [
            "survive for 5 minutes",
            "defeat the boss",
            "reach the checkpoint",
            "collect 10 coins",
            "find the hidden treasure",
          ]
  
          const randomSubject = subjects[Math.floor(Math.random() * subjects.length)]
          const randomCondition = conditions[Math.floor(Math.random() * conditions.length)]
          const questionText = `Will ${randomSubject} ${randomCondition}?`
          const endTime = new Date(Date.now() + 30 * 1000) // 30 seconds from now
  
          // Get stream ID from query params or use default
          const streamId = req.query.streamId || "default-stream"
  
          // Create and save a new question
          currentQuestion = new BetQuestion({
            question: questionText,
            subject: randomSubject,
            condition: randomCondition,
            startTime: new Date(),
            endTime,
            active: true,
            yesPercentage: 55,
            noPercentage: 45,
            totalBetAmount: 0,
            totalPlayers: 0,
            streamId: streamId,
          })
  
          await currentQuestion.save()
          console.log("Created new question on demand:", currentQuestion)
        }
  
        res.status(200).json({
          success: true,
          question: currentQuestion,
        })
      } catch (error) {
        console.error("Get current question error:", error)
        res.status(500).json({
          success: false,
          message: "Server error while fetching current question",
        })
      }
    },
  
    resolveQuestion: async (req, res) => {
      try {
        const { questionId, outcome } = req.body
  
        if (!["Yes", "No"].includes(outcome)) {
          return res.status(400).json({
            success: false,
            message: "Invalid outcome. Must be Yes or No",
          })
        }
  
        // Find the question by ID
        let question
        if (mongoose.Types.ObjectId.isValid(questionId)) {
          question = await BetQuestion.findById(questionId)
        }
  
        // If not found by ObjectId, try string ID
        if (!question) {
          question = await BetQuestion.findOne({
            $or: [{ id: questionId }, { _id: questionId }],
          })
        }
  
        if (!question) {
          return res.status(404).json({
            success: false,
            message: "Question not found",
          })
        }
  
        if (question.resolved) {
          return res.status(400).json({
            success: false,
            message: "Question already resolved",
          })
        }
  
        // Update question
        question.resolved = true
        question.outcome = outcome
        question.active = false
        await question.save()
  
        // Emit socket event for question resolution
        if (req.io) {
          req.io.emit("question_resolved", {
            questionId,
            outcome,
          })
        }
  
        res.status(200).json({
          success: true,
          message: `Question resolved with outcome: ${outcome}`,
        })
      } catch (error) {
        console.error("Resolve question error:", error)
        res.status(500).json({
          success: false,
          message: "Server error while resolving question",
        })
      }
    },
  
    // Add a debug endpoint to check what questions exist
    debugQuestions: async (req, res) => {
      try {
        const questions = await BetQuestion.find().sort({ createdAt: -1 }).limit(10)
        res.status(200).json({
          success: true,
          count: questions.length,
          questions: questions,
        })
      } catch (error) {
        console.error("Debug questions error:", error)
        res.status(500).json({
          success: false,
          message: "Server error while fetching questions",
        })
      }
    },
  
    // Create a test question for debugging
    createTestQuestion: async (req, res) => {
      try {
        const streamId = req.body.streamId || "default-stream"
  
        const testQuestion = new BetQuestion({
          question: "Will the test player win the game?",
          subject: "TestPlayer",
          condition: "win the game",
          startTime: new Date(),
          endTime: new Date(Date.now() + 60 * 1000), // 60 seconds from now
          active: true,
          yesPercentage: 50,
          noPercentage: 50,
          streamId: streamId,
        })
  
        await testQuestion.save()
        console.log("Created test question:", testQuestion)
  
        res.status(201).json({
          success: true,
          question: testQuestion,
        })
      } catch (error) {
        console.error("Create test question error:", error)
        res.status(500).json({
          success: false,
          message: "Server error while creating test question",
        })
      }
    },
  }
  
  // Generate a new bet question (admin only)
  router.post("/generate", authenticate, questionController.generateBetQuestion)
  
  // Get current active question
  router.get("/current", async (req, res) => {
    try {
      // Try to find an active question in the database
      let currentQuestion = await BetQuestion.findOne({
        active: true,
        resolved: false,
        endTime: { $gt: new Date() },
      })
  
      // If no active question found, check if there are expired questions that need to be deactivated
      if (!currentQuestion) {
        const expiredQuestions = await BetQuestion.find({
          active: true,
          resolved: false,
          endTime: { $lte: new Date() },
        })
  
        if (expiredQuestions.length > 0) {
          console.log(`Found ${expiredQuestions.length} expired questions to deactivate`)
          for (const question of expiredQuestions) {
            question.active = false
            await question.save()
            console.log(`Deactivated expired question: ${question._id}`)
          }
        }
  
        // Create a new question
        const subjects = ["James5423", "Alex98", "NinjaWarrior", "StreamQueen", "ProGamer42"]
        const conditions = [
          "survive for 5 minutes",
          "defeat the boss",
          "reach the checkpoint",
          "collect 10 coins",
          "find the hidden treasure",
        ]
  
        const randomSubject = subjects[Math.floor(Math.random() * subjects.length)]
        const randomCondition = conditions[Math.floor(Math.random() * conditions.length)]
        const questionText = `Will ${randomSubject} ${randomCondition}?`
        const endTime = new Date(Date.now() + 36 * 1000) // 36 seconds from now
  
        // Get stream ID from query params or use default
        const streamId = req.query.streamId || "default-stream"
  
        // Create and save a new question
        currentQuestion = new BetQuestion({
          id: `question-${Date.now()}`,
          question: questionText,
          subject: randomSubject,
          condition: randomCondition,
          startTime: new Date(),
          endTime,
          active: true,
          yesPercentage: 50,
          noPercentage: 50,
          totalBetAmount: 0,
          totalPlayers: 0,
          yesUserCount: 0,
          noUserCount: 0,
          streamId: streamId,
        })
  
        await currentQuestion.save()
        console.log("Created new question on demand:", currentQuestion)
  
        // Emit socket event for new question if io is available
        if (req.io) {
          req.io.emit("newQuestion", {
            id: currentQuestion._id,
            question: questionText,
            subject: randomSubject,
            condition: randomCondition,
            endTime,
            yesPercentage: 50,
            noPercentage: 50,
          })
        }
  
        // Schedule question resolution after 36 seconds
        setTimeout(async () => {
          try {
            const q = await BetQuestion.findById(currentQuestion._id)
            if (q && !q.resolved) {
              q.resolved = true
              q.outcome = Math.random() < 0.5 ? "Yes" : "No"
              q.active = false
              await q.save()
  
              if (req.io) {
                req.io.emit("questionResolved", {
                  questionId: q._id,
                  outcome: q.outcome,
                })
              }
            }
          } catch (err) {
            console.error("Error auto-resolving question:", err)
          }
        }, 36000)
      }
  
      res.status(200).json({
        success: true,
        question: currentQuestion,
      })
    } catch (error) {
      console.error("Get current question error:", error)
      res.status(500).json({
        success: false,
        message: "Server error while fetching current question",
      })
    }
  })
  
  // Resolve a question (admin only)
  router.post("/resolve", authenticate, questionController.resolveQuestion)
  
  // Debug endpoint to check what questions exist
  router.get("/debug", questionController.debugQuestions)
  
  // Create a test question for debugging
  router.post("/test", questionController.createTestQuestion)
  
  // Add a check question endpoint to verify if questions exist and are properly formatted
  
  // Add this new route at the end of the file, before module.exports
  router.get("/check/:questionId", async (req, res) => {
    try {
      const { questionId } = req.params
      console.log("Checking question with ID:", questionId)
  
      let question = null
  
      // Try to find by ObjectId
      if (mongoose.Types.ObjectId.isValid(questionId)) {
        question = await BetQuestion.findById(questionId)
      }
  
      // If not found, try by string ID
      if (!question) {
        question = await BetQuestion.findOne({ id: questionId })
      }
  
      // If still not found, try by regex on question text
      if (!question && questionId.startsWith("question-")) {
        question = await BetQuestion.findOne({
          question: { $regex: questionId.replace("question-", "") },
        })
      }
  
      if (!question) {
        // Get all questions to help debug
        const allQuestions = await BetQuestion.find().sort({ createdAt: -1 }).limit(5)
  
        return res.status(404).json({
          success: false,
          message: "Question not found",
          questionId,
          recentQuestions: allQuestions.map((q) => ({
            id: q.id,
            _id: q._id,
            question: q.question,
            active: q.active,
            resolved: q.resolved,
          })),
        })
      }
  
      res.status(200).json({
        success: true,
        question: {
          id: question.id,
          _id: question._id,
          question: question.question,
          subject: question.subject,
          condition: question.condition,
          active: question.active,
          resolved: question.resolved,
          endTime: question.endTime,
          yesPercentage: question.yesPercentage,
          noPercentage: question.noPercentage,
        },
      })
    } catch (error) {
      console.error("Check question error:", error)
      res.status(500).json({
        success: false,
        message: "Server error while checking question",
        error: error.message,
      })
    }
  })
  
  // Add a new endpoint to get the biggest win of the week
  router.get("/biggest-win", async (req, res) => {
    try {
      const now = new Date()
  
      // Calculate current week's start and end dates
      const startOfWeek = new Date(now)
      startOfWeek.setDate(now.getDate() - now.getDay()) // Start of week (Sunday)
      startOfWeek.setHours(0, 0, 0, 0)
  
      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(startOfWeek.getDate() + 6) // End of week (Saturday)
      endOfWeek.setHours(23, 59, 59, 999)
  
      // Try to find stats for current week
      const stats = await BetStats.findOne({
        weekStartDate: { $lte: now },
        weekEndDate: { $gte: now },
      })
  
      if (!stats) {
        return res.status(200).json({
          success: true,
          biggestWin: 0,
          weekStart: startOfWeek,
          weekEnd: endOfWeek,
        })
      }
  
      res.status(200).json({
        success: true,
        biggestWin: stats.biggestWinThisWeek,
        weekStart: stats.weekStartDate,
        weekEnd: stats.weekEndDate,
      })
    } catch (error) {
      console.error("Get biggest win error:", error)
      res.status(500).json({
        success: false,
        message: "Server error while fetching biggest win",
        error: error.message,
      })
    }
  })
  
  module.exports = router