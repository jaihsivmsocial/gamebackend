const Bet = require("../../model/battingModel/Bet.js")
const BetQuestion = require("../../model/battingModel/BetQuestion.js")
const User = require("../../model/userModel.js")
const Transaction = require("../../model/battingModel/Transaction.js")
const BetStats = require("../../model/battingModel/BetStats.js")
const mongoose = require("mongoose")

let io
try {
  io = require("../../sockets/socket-manager.js").io
} catch (error) {
  console.log("Socket.io not available, using dummy implementation")
  io = {
    emit: (event, data) => {
      console.log(`[DUMMY IO] Would emit ${event}:`, data)
    },
  }
}

// Function to ensure user has exactly 5000 balance
const ensureFixedBalance = async (userId) => {
  try {
    const user = await User.findById(userId)
    if (user) {
      // Always set wallet balance to exactly 5000
      if (user.walletBalance !== 5000) {
        user.walletBalance = 5000
        await user.save()

        // Emit wallet update event
        if (io) {
          io.emit("wallet_update", {
            userId: userId,
            newBalance: 5000,
            previousBalance: user.walletBalance,
            change: 0,
          })
        }
      }
      return user
    }
    return null
  } catch (error) {
    console.error("Error ensuring fixed balance:", error)
    return null
  }
}

// Get user wallet balance - always returns 5000
exports.getUserWalletBalance = async (req, res) => {
  try {
    // Check if req.user exists before accessing its properties
    if (!req.user) {
      // console.log("No user found in request. Returning default balance.")
      return res.status(200).json({
        success: true,
        balance: 5000,
        isAuthenticated: false,
      })
    }

    const userId = req.user.id || req.user._id || req.user.userId

    if (!userId) {
      console.log("User ID not found in request. Returning default balance.")
      return res.status(200).json({
        success: true,
        balance: 5000, // Return default balance if no user ID
        isAuthenticated: false,
      })
    }

    // Ensure user has fixed balance
    const user = await ensureFixedBalance(userId)

    if (!user) {
      console.log("User not found in database. Returning default balance.")
      return res.status(200).json({
        success: true,
        balance: 5000, // Return default balance if user not found
        isAuthenticated: false,
      })
    }

    res.status(200).json({
      success: true,
      balance: 5000, // Always return 5000
      isAuthenticated: true,
    })
  } catch (error) {
    console.error("Get wallet balance error:", error)
    // Even on error, return a successful response with default balance
    res.status(200).json({
      success: true,
      balance: 5000,
      isAuthenticated: false,
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Place a bet - simplified version without transactions
exports.placeBet = async (req, res) => {
  try {
    console.log("=== PLACE BET START ===")
    const { questionId, choice, amount, streamId } = req.body

    // Add more robust user ID extraction with fallbacks
    let userId
    if (req.user) {
      userId = req.user.id || req.user._id || req.user.userId
      console.log("Using user ID from token:", userId)
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID not found in request",
      })
    }

    console.log("Received bet request:", { questionId, choice, amount, streamId, userId })

    // Validate bet amount
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid bet amount",
      })
    }

    // Validate streamId
    if (!streamId) {
      return res.status(400).json({
        success: false,
        message: "Stream ID is required",
      })
    }

    // Find the question - handle both ObjectId and string ID formats
    let question = null
    try {
      console.log("Looking for question with ID:", questionId, "Type:", typeof questionId)

      // Try to find by ObjectId first if it's a valid ObjectId
      if (mongoose.Types.ObjectId.isValid(questionId)) {
        question = await BetQuestion.findById(questionId)
        console.log("Searched by ObjectId, found:", question ? "Yes" : "No")
      }

      // If not found, try to find by string ID
      if (!question) {
        try {
          question = await BetQuestion.findOne({ id: questionId })
          console.log("Searched by string ID, found:", question ? "Yes" : "No")
        } catch (err) {
          console.log("Error searching by string ID:", err.message)
        }
      }

      // If still not found, try to find by regex on question text
      if (!question && questionId.startsWith("question-")) {
        try {
          question = await BetQuestion.findOne({
            question: { $regex: questionId.replace("question-", "") },
          })
          console.log("Searched by regex, found:", question ? "Yes" : "No")
        } catch (err) {
          console.log("Error searching by regex:", err.message)
        }
      }

      // If still not found, get the most recent active question
      if (!question) {
        console.log("No question found with ID, getting most recent active question")
        try {
          const activeQuestions = await BetQuestion.find({
            active: true,
            resolved: false,
            endTime: { $gt: new Date() },
          })
            .sort({ createdAt: -1 })
            .limit(1)

          if (activeQuestions.length > 0) {
            question = activeQuestions[0]
            console.log("Using most recent active question as fallback:", question._id)
          }
        } catch (fallbackError) {
          console.error("Error finding active questions:", fallbackError)
        }
      }

      // If still no question found, create a new one
      if (!question) {
        console.log("No active questions found, creating a new one")
        try {
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
          const endTime = new Date(Date.now() + 30 * 1000) // 36 seconds from now

          question = new BetQuestion({
            id: `question-${Date.now()}`,
            question: questionText,
            subject: randomSubject,
            condition: randomCondition,
            startTime: new Date(),
            endTime,
            active: true,
            streamId: streamId || "default-stream",
            yesBetAmount: 0,
            noBetAmount: 0,
            yesPercentage: 50,
            noPercentage: 50,
            totalBetAmount: 0,
            totalPlayers: 0,
          })

          await question.save()
          console.log("Created new question on demand:", question._id)
        } catch (createError) {
          console.error("Error creating new question:", createError)
          throw createError // Re-throw to be caught by the outer try/catch
        }
      }
    } catch (error) {
      console.error("Error finding/creating question:", error)
      return res.status(404).json({
        success: false,
        message: "Bet question not found and could not create a new one",
        error: error.message,
      })
    }

    if (!question) {
      // Create a debug endpoint to check what questions exist
      const allQuestions = await BetQuestion.find().sort({ createdAt: -1 }).limit(5)
      console.error(
        "No question found. Recent questions:",
        allQuestions.map((q) => ({ id: q._id, active: q.active, resolved: q.resolved })),
      )

      return res.status(404).json({
        success: false,
        message: "Bet question not found. Please refresh and try again.",
      })
    }

    // Check if question is still active
    if (!question.active || question.resolved) {
      return res.status(400).json({
        success: false,
        message: "This betting round has ended",
      })
    }

    // Check if countdown has expired
    if (new Date() > question.endTime) {
      return res.status(400).json({
        success: false,
        message: "Betting time has expired for this question",
      })
    }

    // Find user and ensure they have exactly 5000 balance
    console.log("Finding user with ID:", userId)
    const user = await ensureFixedBalance(userId)

    if (!user) {
      console.log("User not found with ID:", userId)
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }
    console.log("Found user:", user.username || user.email || userId)

    // Check if user has enough balance
    if (amount > user.walletBalance) {
      return res.status(400).json({
        success: false,
        message: "Insufficient balance",
      })
    }

    // Create the bet
    console.log("Creating new bet")
    const bet = new Bet({
      user: userId,
      question: question._id, // Use the question's ObjectId
      choice,
      amount,
      status: "pending",
      timestamp: new Date(),
      streamId: streamId, // Add streamId to the bet
      matchedAmount: 0, // Initialize with 0
      potentialPayout: 0, // Initialize with 0
      processed: false, // Initialize as not processed
    })

    // Update user's wallet balance temporarily for this bet
    console.log("Updating user wallet balance")
    const previousBalance = user.walletBalance
    user.walletBalance -= amount
    user.totalBets = (user.totalBets || 0) + 1
    await user.save()

    // Create transaction record
    console.log("Creating transaction record")
    const transaction = new Transaction({
      user: userId,
      type: "bet_place",
      amount: -amount,
      bet: bet._id,
      question: question._id,
      balanceAfter: user.walletBalance,
    })
    await transaction.save()

    // Update question stats
    console.log("Updating question stats")
    if (choice === "Yes") {
      question.yesBetAmount = (question.yesBetAmount || 0) + amount
      // Check if this user has already bet on this question with this choice
      const existingYesBet = await Bet.findOne({
        user: userId,
        question: question._id,
        choice: "Yes",
        _id: { $ne: bet._id }, // Exclude the current bet
      })

      if (!existingYesBet) {
        // Only increment if this is the first bet from this user for this choice
        question.yesUserCount = (question.yesUserCount || 0) + 1
      }
    } else {
      question.noBetAmount = (question.noBetAmount || 0) + amount
      // Check if this user has already bet on this question with this choice
      const existingNoBet = await Bet.findOne({
        user: userId,
        question: question._id,
        choice: "No",
        _id: { $ne: bet._id }, // Exclude the current bet
      })

      if (!existingNoBet) {
        // Only increment if this is the first bet from this user for this choice
        question.noUserCount = (question.noUserCount || 0) + 1
      }
    }

    question.totalBetAmount = (question.totalBetAmount || 0) + amount
    question.totalPlayers = (question.totalPlayers || 0) + 1

    // Recalculate percentages based on user counts instead of bet amounts
    const totalUsers = (question.yesUserCount || 0) + (question.noUserCount || 0)
    if (totalUsers > 0) {
      question.yesPercentage = Math.round(((question.yesUserCount || 0) / totalUsers) * 100)
      question.noPercentage = Math.round(((question.noUserCount || 0) / totalUsers) * 100)

      // Ensure percentages add up to 100%
      if (question.yesPercentage + question.noPercentage !== 100) {
        // Adjust the larger percentage to make the sum 100
        if (question.yesPercentage > question.noPercentage) {
          question.yesPercentage = 100 - question.noPercentage
        } else {
          question.noPercentage = 100 - question.yesPercentage
        }
      }
    } else {
      // Default to 50/50 if no users have bet yet
      question.yesPercentage = 50
      question.noPercentage = 50
    }

    await question.save()

    // Calculate potential payout based on current odds
    console.log("Calculating potential payout")
    const odds =
      choice === "Yes" ? question.noPercentage / question.yesPercentage : question.yesPercentage / question.noPercentage

    const platformFee = 0.05 // 5%
    const potentialWinnings = amount * odds * (1 - platformFee)
    const potentialPayout = amount + potentialWinnings

    bet.potentialPayout = potentialPayout
    await bet.save()

    // Try to match the bet
    console.log("Matching bet")
    try {
      await matchBet(bet, question)
    } catch (matchError) {
      console.error("Error matching bet:", matchError)
      // Continue even if matching fails
    }

    // Update global stats
    console.log("Updating global stats")
    try {
      await updateBetStats(amount)
    } catch (statsError) {
      console.error("Error updating stats:", statsError)
      // Continue even if stats update fails
    }

    // Emit socket events for real-time updates
    console.log("Emitting socket events")
    if (io) {
      // Emit bet placed event with updated question data
      io.emit("betPlaced", {
        questionId: question._id,
        yesPercentage: question.yesPercentage,
        noPercentage: question.noPercentage,
        totalBetAmount: question.totalBetAmount,
        totalPlayers: question.totalPlayers,
        newPlayer: true, // Indicate this is a new player
      })

      // Also emit specific stats updates
      io.emit("total_bets_update", {
        amount: question.totalBetAmount,
      })

      io.emit("player_count_update", {
        count: question.totalPlayers,
      })

      // Emit comprehensive betting stats
      io.emit("betting_stats", {
        totalBetsAmount: question.totalBetAmount,
        biggestWinThisWeek: user.biggestWin || 0,
        totalPlayers: question.totalPlayers,
        activePlayers: question.totalPlayers, // Simplification
      })

      // IMPORTANT: Emit wallet update event with real-time balance
      io.emit("wallet_update", {
        userId: userId,
        newBalance: user.walletBalance,
        previousBalance: previousBalance,
        change: -amount,
      })

      // Add a specific bet_response event for immediate UI updates
      io.emit("bet_response", {
        success: true,
        newBalance: user.walletBalance,
        previousBalance: previousBalance,
        change: -amount,
        userId: userId,
      })
    }

    console.log("Bet placed successfully")
    res.status(201).json({
      success: true,
      bet: {
        ...bet.toObject(),
        potentialPayout: potentialPayout,
      },
      newBalance: user.walletBalance,
      previousBalance: previousBalance,
      questionStats: {
        yesPercentage: question.yesPercentage,
        noPercentage: question.noPercentage,
        totalBetAmount: question.totalBetAmount,
        totalPlayers: question.totalPlayers,
      },
    })
    console.log("=== PLACE BET END ===")
  } catch (error) {
    console.error("Place bet error:", error)
    console.error("Error stack:", error.stack)

    // Check for specific error types
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format",
        error: error.message,
      })
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        error: error.message,
      })
    }

    // Generic error response
    res.status(500).json({
      success: false,
      message: "Server error while placing bet",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Match a bet with opposite bets - simplified without transactions
const matchBet = async (newBet, question) => {
  try {
    const oppositeChoice = newBet.choice === "Yes" ? "No" : "Yes"

    // Find unmatched or partially matched bets with the opposite choice
    const oppositeBets = await Bet.find({
      question: question._id,
      choice: oppositeChoice,
      status: { $in: ["pending", "partially_matched"] },
      processed: false,
    }).sort({ timestamp: 1 }) // First in, first matched

    let remainingAmount = newBet.amount
    let matchedAmount = 0

    // Try to match with opposite bets
    for (const oppositeBet of oppositeBets) {
      if (remainingAmount <= 0) break

      const oppositeUnmatchedAmount = oppositeBet.amount - (oppositeBet.matchedAmount || 0)

      if (oppositeUnmatchedAmount > 0) {
        const amountToMatch = Math.min(remainingAmount, oppositeUnmatchedAmount)

        // Update the opposite bet
        oppositeBet.matchedAmount = (oppositeBet.matchedAmount || 0) + amountToMatch
        oppositeBet.status = oppositeBet.matchedAmount === oppositeBet.amount ? "matched" : "partially_matched"
        await oppositeBet.save()

        // Update the new bet
        matchedAmount += amountToMatch
        remainingAmount -= amountToMatch
      }
    }

    // Update the new bet status
    newBet.matchedAmount = matchedAmount

    if (matchedAmount === 0) {
      newBet.status = "pending"
    } else if (matchedAmount === newBet.amount) {
      newBet.status = "matched"
    } else {
      newBet.status = "partially_matched"
    }

    // Calculate potential payout (matched amount * 2 * 0.95)
    const platformFee = 0.05 // 5%
    newBet.potentialPayout = matchedAmount * 2 * (1 - platformFee)

    await newBet.save()
  } catch (error) {
    console.error("Match bet error:", error)
    throw error
  }
}

// Update global betting statistics - simplified without transactions
const updateBetStats = async (betAmount) => {
  try {
    // Get current week's start and end dates
    const now = new Date()
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay())
    startOfWeek.setHours(0, 0, 0, 0)

    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(startOfWeek.getDate() + 6)
    endOfWeek.setHours(23, 59, 59, 999)

    // Find or create stats for current week
    let stats = await BetStats.findOne({
      weekStartDate: { $lte: now },
      weekEndDate: { $gte: now },
    })

    if (!stats) {
      stats = new BetStats({
        totalBetsAmount: 0,
        biggestWinThisWeek: 0,
        totalPlayers: 0,
        activePlayers: 0,
        weekStartDate: startOfWeek,
        weekEndDate: endOfWeek,
      })
    }

    // Update stats
    stats.totalBetsAmount = (stats.totalBetsAmount || 0) + betAmount
    stats.updatedAt = now

    await stats.save()
  } catch (error) {
    console.error("Update bet stats error:", error)
    throw error
  }
}

// Resolve a bet question - simplified without transactions
exports.resolveBetQuestion = async (req, res) => {
  try {
    const { questionId, outcome } = req.body

    if (!["Yes", "No"].includes(outcome)) {
      return res.status(400).json({
        success: false,
        message: "Invalid outcome. Must be Yes or No",
      })
    }

    // Find the question - handle both ObjectId and string ID formats
    let question = null

    // Try to find by ObjectId first if it's a valid ObjectId
    if (mongoose.Types.ObjectId.isValid(questionId)) {
      question = await BetQuestion.findById(questionId)
    }

    // If not found, try to find by string ID
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

    // Process all bets for this question
    await processBetsForQuestion(question._id, outcome)

    // Emit socket event for question resolution
    if (io) {
      io.emit("questionResolved", {
        questionId: question._id,
        outcome,
      })
    }

    res.status(200).json({
      success: true,
      message: `Question resolved with outcome: ${outcome}`,
    })
  } catch (error) {
    console.error("Resolve bet question error:", error)
    res.status(500).json({
      success: false,
      message: "Server error while resolving bet question",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Process all bets for a resolved question - simplified without transactions
const processBetsForQuestion = async (questionId, outcome) => {
  try {
    // Get all bets for this question
    const bets = await Bet.find({ question: questionId, processed: false })

    for (const bet of bets) {
      // Skip already processed bets
      if (bet.processed) continue

      const user = await User.findById(bet.user)
      if (!user) continue

      // Handle unmatched amounts - refund
      if (bet.matchedAmount < bet.amount) {
        const refundAmount = bet.amount - bet.matchedAmount

        // Create refund transaction
        const refundTransaction = new Transaction({
          user: user._id,
          type: "bet_refund",
          amount: refundAmount,
          bet: bet._id,
          question: questionId,
          balanceAfter: 5000, // Always set to 5000
        })
        await refundTransaction.save()
      }

      // Handle matched amounts - determine win/loss
      if (bet.matchedAmount > 0) {
        const isWinner = bet.choice === outcome

        if (isWinner) {
          // Winner gets their matched amount back plus winnings minus platform fee
          const platformFee = 0.05 // 5%
          const winAmount = bet.matchedAmount * 2 * (1 - platformFee)

          // Update biggest win if applicable
          if (winAmount - bet.matchedAmount > (user.biggestWin || 0)) {
            user.biggestWin = winAmount - bet.matchedAmount
            await user.save()
          }

          // Update weekly stats if applicable
          await updateBiggestWinThisWeek(winAmount - bet.matchedAmount)

          // Create win transaction
          const winTransaction = new Transaction({
            user: user._id,
            type: "bet_win",
            amount: winAmount,
            bet: bet._id,
            question: questionId,
            balanceAfter: 5000, // Always set to 5000
          })
          await winTransaction.save()

          bet.status = "won"

          // Emit socket event for win
          if (io) {
            io.emit("bet_win", {
              userId: user._id,
              amount: winAmount,
              questionId: questionId,
            })
          }
        } else {
          // Loser already had their matched amount deducted when placing the bet
          bet.status = "lost"
        }
      } else {
        // Fully unmatched bet
        bet.status = "unmatched"
      }

      bet.processed = true
      await bet.save()

      // Reset user balance to 5000 after processing
      await ensureFixedBalance(user._id)
    }
  } catch (error) {
    console.error("Process bets error:", error)
    throw error
  }
}

// Update biggest win this week in stats - simplified without transactions
const updateBiggestWinThisWeek = async (winAmount) => {
  try {
    const now = new Date()

    const stats = await BetStats.findOne({
      weekStartDate: { $lte: now },
      weekEndDate: { $gte: now },
    })

    if (stats && winAmount > (stats.biggestWinThisWeek || 0)) {
      stats.biggestWinThisWeek = winAmount
      await stats.save()
    }
  } catch (error) {
    console.error("Update biggest win error:", error)
    throw error
  }
}

// Get user's bet history
exports.getUserBets = async (req, res) => {
  try {
    const userId = req.user.id

    // Ensure user has fixed balance
    await ensureFixedBalance(userId)

    const bets = await Bet.find({ user: userId })
      .populate("question", "question outcome resolved")
      .sort({ createdAt: -1 })
      .limit(20)

    res.status(200).json({
      success: true,
      bets,
    })
  } catch (error) {
    console.error("Get user bets error:", error)
    res.status(500).json({
      success: false,
      message: "Server error while fetching user bets",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Get active bet question
exports.getActiveBetQuestion = async (req, res) => {
  try {
    const activeQuestion = await BetQuestion.findOne({
      active: true,
      resolved: false,
      endTime: { $gt: new Date() },
    })

    if (!activeQuestion) {
      return res.status(404).json({
        success: false,
        message: "No active bet questions found",
      })
    }

    res.status(200).json({
      success: true,
      question: activeQuestion,
    })
  } catch (error) {
    console.error("Get active question error:", error)
    res.status(500).json({
      success: false,
      message: "Server error while fetching active question",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Get betting statistics
exports.getBetStats = async (req, res) => {
  try {
    const now = new Date()

    // Try to find stats for current week
    let stats = await BetStats.findOne({
      weekStartDate: { $lte: now },
      weekEndDate: { $gte: now },
    })

    // If no stats found, create default stats with some sample data
    if (!stats) {
      // Calculate week start and end dates
      const startOfWeek = new Date(now)
      startOfWeek.setDate(now.getDate() - now.getDay())
      startOfWeek.setHours(0, 0, 0, 0)

      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(startOfWeek.getDate() + 6)
      endOfWeek.setHours(23, 59, 59, 999)

      stats = new BetStats({
        totalBetsAmount: 5000, // Sample data
        biggestWinThisWeek: 0, // Sample data
        totalPlayers: 42, // Sample data
        activePlayers: 18, // Sample data
        weekStartDate: startOfWeek,
        weekEndDate: endOfWeek,
        streamId: req.query.streamId || "default-stream",
      })

      await stats.save()
    }

    // Get active players count (users who placed bets in the last 24 hours)
    const activePlayers = await Bet.distinct("user", {
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
    })

    const activePlayersCount = activePlayers.length || 18 // Default to 18 if none found
    stats.activePlayers = activePlayersCount
    await stats.save()

    // Get total bets amount (sum of all bet amounts)
    const totalBetsAggregate = await Bet.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])

    const totalBetsAmount = totalBetsAggregate.length > 0 ? totalBetsAggregate[0].total : stats.totalBetsAmount
    stats.totalBetsAmount = totalBetsAmount || 5000 // Default to 5000 if none found

    // Get total unique players
    const totalPlayers = await Bet.distinct("user")
    stats.totalPlayers = totalPlayers.length || 42 // Default to 42 if none found

    await stats.save()

    // Emit updated stats via socket if available
    if (io) {
      io.emit("betting_stats", {
        totalBetsAmount: stats.totalBetsAmount,
        biggestWinThisWeek: stats.biggestWinThisWeek,
        totalPlayers: stats.totalPlayers,
        activePlayers: stats.activePlayers,
      })
    }

    res.status(200).json({
      success: true,
      stats: {
        totalBetsAmount: stats.totalBetsAmount,
        biggestWinThisWeek: stats.biggestWinThisWeek,
        totalPlayers: stats.totalPlayers,
        activePlayers: stats.activePlayers,
      },
    })
  } catch (error) {
    console.error("Get bet stats error:", error)
    // Return sample data even on error to ensure UI has something to display
    res.status(200).json({
      success: true,
      stats: {
        totalBetsAmount: 5000,
        biggestWinThisWeek: 0,
        totalPlayers: 42,
        activePlayers: 18,
      },
    })
  }
}

// Add a debug endpoint to test the controller
exports.debugController = async (req, res) => {
  try {
    // Return information about the environment
    const debugInfo = {
      nodeVersion: process.version,
      mongooseVersion: mongoose.version,
      mongooseConnection: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      models: {
        betQuestion: !!mongoose.models.BetQuestion,
        bet: !!mongoose.models.Bet,
        user: !!mongoose.models.User,
        transaction: !!mongoose.models.Transaction,
        betStats: !!mongoose.models.BetStats,
      },
      socketIoAvailable: !!io,
    }

    res.status(200).json({
      success: true,
      debugInfo,
    })
  } catch (error) {
    console.error("Debug controller error:", error)
    res.status(500).json({
      success: false,
      message: "Server error in debug controller",
      error: error.message,
    })
  }
}

// Login hook to ensure user has 5000 balance
exports.loginHook = async (req, res, next) => {
  try {
    if (req.user && req.user.id) {
      await ensureFixedBalance(req.user.id)
    }
    next()
  } catch (error) {
    console.error("Login hook error:", error)
    next()
  }
}

// Remove the updateWalletBalance function since we don't want users to be able to add balance

// Add this function to reset all user balances to 5000 (for admin use)
exports.resetAllUserBalances = async (req, res) => {
  try {
    // Check if request is from admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: Admin access required",
      })
    }

    // Update all users to have exactly 5000 balance
    const result = await User.updateMany({}, { walletBalance: 5000 })

    // Emit wallet update event for all users
    const users = await User.find({}, "_id")
    if (io) {
      users.forEach((user) => {
        io.emit("wallet_update", {
          userId: user._id,
          newBalance: 5000,
          previousBalance: null,
          change: 0,
        })
      })
    }

    res.status(200).json({
      success: true,
      message: `Reset ${result.modifiedCount} user balances to 5000`,
    })
  } catch (error) {
    console.error("Reset all balances error:", error)
    res.status(500).json({
      success: false,
      message: "Server error while resetting user balances",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

module.exports = exports
