const BetQuestion = require("../models/BetQuestion.js")
const { io } = require("../socketManager.js")

// Generate a new bet question
exports.generateBetQuestion = async (req, res) => {
  try {
    // Deactivate any existing active questions
    await BetQuestion.updateMany({ active: true, resolved: false }, { active: false })

    // Generate a new question
    const { subject, condition } = generateRandomQuestion()

    const questionText = `Will ${subject} ${condition}?`
    const endTime = new Date(Date.now() + 30 * 1000) // 30 seconds from now

    const newQuestion = new BetQuestion({
      question: questionText,
      subject,
      condition,
      startTime: new Date(),
      endTime,
      active: true,
    })

    await newQuestion.save()

    // Emit socket event for new question
    io.emit("newQuestion", {
      id: newQuestion._id,
      question: questionText,
      endTime,
      yesPercentage: 50,
      noPercentage: 50,
    })

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
}

// Helper function to generate random questions
const generateRandomQuestion = () => {
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

  return {
    subject: randomSubject,
    condition: randomCondition,
  }
}

// Get current active question
exports.getCurrentQuestion = async (req, res) => {
  try {
    const currentQuestion = await BetQuestion.findOne({
      active: true,
      resolved: false,
    })

    if (!currentQuestion) {
      return res.status(404).json({
        success: false,
        message: "No active question found",
      })
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
}

// Resolve a question (admin only)
exports.resolveQuestion = async (req, res) => {
  try {
    const { questionId, outcome } = req.body

    if (!["Yes", "No"].includes(outcome)) {
      return res.status(400).json({
        success: false,
        message: "Invalid outcome. Must be Yes or No",
      })
    }

    const question = await BetQuestion.findById(questionId)
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

    question.resolved = true
    question.outcome = outcome
    question.active = false

    await question.save()

    // Emit socket event for question resolution
    io.emit("questionResolved", {
      questionId: question._id,
      outcome,
    })

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
}
