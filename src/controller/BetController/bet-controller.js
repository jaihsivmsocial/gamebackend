
const Bet = require("../../model/battingModel/Bet.js")
const BetQuestion = require("../../model/battingModel/BetQuestion.js")
const User = require("../../model/userModel.js")
const Transaction = require("../../model/battingModel/Transaction.js")
const BetStats = require("../../model/battingModel/BetStats.js")
const mongoose = require("mongoose")

let io
let socketManager
try {
  socketManager = require("../socket/socket-manager.js")
  io = socketManager.io
} catch (error) {
  console.log("Socket.io not available, using dummy implementation")
  io = {
    emit: (event, data) => {
      console.log(`[DUMMY IO] Would emit ${event}:`, data)
    },
  }
  socketManager = {
    getCurrentCameraHolder: () => null,
  }
}

// Find the ensureFixedBalance function and replace it with this dynamic balance function
const ensureUserBalance = async (userId) => {
  try {
    const user = await User.findById(userId)
    if (user) {
      // No longer setting a fixed balance - using the actual user balance
      return user
    }
    return null
  } catch (error) {
    console.error("Error ensuring user balance:", error)
    return null
  }
}

// Replace the getUserWalletBalance function with this dynamic version
exports.getUserWalletBalance = async (req, res) => {
  try {
    // Check if req.user exists before accessing its properties
    if (!req.user) {
      console.log("No user found in request. Returning default balance.")
      return res.status(200).json({
        success: true,
        balance: 0,
        isAuthenticated: false,
      })
    }

    const userId = req.user.id || req.user._id || req.user.userId

    if (!userId) {
      console.log("User ID not found in request. Returning default balance.")
      return res.status(200).json({
        success: true,
        balance: 0,
        isAuthenticated: false,
      })
    }

    // Find user with actual balance
    const user = await User.findById(userId)

    if (!user) {
      console.log("User not found in database. Returning default balance.")
      return res.status(200).json({
        success: true,
        balance: 0,
        isAuthenticated: false,
      })
    }

    console.log("Returning actual wallet balance:", user.walletBalance || 0)

    // Return actual user balance
    res.status(200).json({
      success: true,
      balance: user.walletBalance || 0,
      isAuthenticated: true,
    })
  } catch (error) {
    console.error("Get wallet balance error:", error)
    // Even on error, return a successful response with default balance
    res.status(200).json({
      success: true,
      balance: 0,
      isAuthenticated: false,
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Update the placeBet function to properly check wallet balance
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

    console.log("Received bet request:", {
      questionId,
      choice,
      amount,
      streamId,
      userId,
    })

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

    // Find user with actual balance
    console.log("Finding user with ID:", userId)
    const user = await User.findById(userId)

    if (!user) {
      console.log("User not found with ID:", userId)
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }
    console.log("Found user:", user.username || user.email || userId)
    console.log("Current wallet balance:", user.walletBalance || 0)

    // Check if user has enough balance
    if ((user.walletBalance || 0) < amount) {
      // Return insufficient balance with the exact amount needed
      return res.status(400).json({
        success: false,
        message: "Insufficient balance",
        insufficientFunds: true,
        currentBalance: user.walletBalance || 0,
        amountNeeded: amount - (user.walletBalance || 0),
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
          // Use the generateNewQuestion function from socket-manager
          question = await socketManager.generateNewQuestion(streamId || "default-stream")

          if (!question) {
            return res.status(400).json({
              success: false,
              message: "No active camera holder available for betting",
            })
          }

          console.log("Created new question on demand:", question._id)
        } catch (createError) {
          console.error("Error creating new question:", createError)
          throw createError
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
        allQuestions.map((q) => ({
          id: q._id,
          active: q.active,
          resolved: q.resolved,
        })),
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

    // Calculate platform fee (5% of bet amount)
    const platformFeePercentage = 0.05
    const platformFee = Math.round(amount * platformFeePercentage)
    const betAmountAfterFee = amount - platformFee

    console.log(`Calculating platform fee: ${platformFee} (${platformFeePercentage * 100}% of ${amount})`)
    console.log(`Bet amount after fee: ${betAmountAfterFee}`)

    // Create the bet with the amount after fee
    console.log("Creating new bet")
    const bet = new Bet({
      user: userId,
      question: question._id,
      choice,
      amount: betAmountAfterFee,
      originalAmount: amount, // Store the original amount
      platformFee: platformFee, // Store the platform fee
      status: "pending",
      timestamp: new Date(),
      streamId: streamId,
      matchedAmount: 0,
      potentialPayout: 0,
      processed: false,
    })

    // Store the previous balance for response
    const previousBalance = user.walletBalance || 0

    // Update user's wallet balance
    console.log("Updating user wallet balance from", previousBalance, "to", previousBalance - amount)
    user.walletBalance = previousBalance - amount
    user.totalBets = (user.totalBets || 0) + 1
    await user.save()

    // Create transaction record for the bet
    console.log("Creating bet transaction record")
    const betTransaction = new Transaction({
      user: userId,
      type: "bet_place",
      amount: -betAmountAfterFee, // Record the bet amount after fee
      bet: bet._id,
      question: question._id,
      balanceAfter: user.walletBalance + platformFee, // Temporary balance after just the bet
    })
    await betTransaction.save()

    // Create transaction record for the platform fee
    console.log("Creating platform fee transaction record")
    const feeTransaction = new Transaction({
      user: userId,
      type: "platform_fee",
      amount: -platformFee, // Record the platform fee as a separate transaction
      bet: bet._id,
      question: question._id,
      balanceAfter: user.walletBalance, // Final balance after both bet and fee
    })
    await feeTransaction.save()

    // Update question stats with the bet amount after fee
    console.log("Updating question stats")
    if (choice === "Yes") {
      question.yesBetAmount = (question.yesBetAmount || 0) + betAmountAfterFee
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
      question.noBetAmount = (question.noBetAmount || 0) + betAmountAfterFee
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

    question.totalBetAmount = (question.totalBetAmount || 0) + betAmountAfterFee

    // Check if this user has already bet on this question (regardless of choice)
    const existingBet = await Bet.findOne({
      user: userId,
      question: question._id,
      _id: { $ne: bet._id }, // Exclude the current bet
    })

    if (!existingBet) {
      // Only increment if this is the first bet from this user on this question
      question.totalPlayers = (question.totalPlayers || 0) + 1
    }

    question.totalPlatformFees = (question.totalPlatformFees || 0) + platformFee

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

    // Calculate potential winnings with 5% platform fee
    // Formula: payout = bet * 2 * 0.95
    const platformFeePercentageOnWinnings = 0.05
    const grossPotentialWinnings = betAmountAfterFee * odds
    const platformFeeOnWinnings = (betAmountAfterFee + grossPotentialWinnings) * platformFeePercentageOnWinnings
    const potentialPayout = betAmountAfterFee + grossPotentialWinnings - platformFeeOnWinnings

    console.log(`Potential payout calculation:`)
    console.log(`- Bet amount after initial fee: ${betAmountAfterFee}`)
    console.log(`- Odds: ${odds}`)
    console.log(`- Gross potential winnings: ${grossPotentialWinnings}`)
    console.log(`- Platform fee (${platformFeePercentageOnWinnings * 100}%): ${platformFeeOnWinnings}`)
    console.log(`- Net potential payout: ${potentialPayout}`)

    bet.potentialPayout = potentialPayout
    bet.grossPotentialPayout = betAmountAfterFee + grossPotentialWinnings
    bet.platformFeeOnWinnings = platformFeeOnWinnings
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
      await updateBetStats(betAmountAfterFee, platformFee)
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
        totalPlatformFees: question.totalPlatformFees || 0,
      })

      // IMPORTANT: Emit wallet update event with real-time balance
      io.emit("wallet_update", {
        userId: userId,
        newBalance: user.walletBalance,
        previousBalance: previousBalance,
        change: -amount,
        platformFee: platformFee,
      })

      // Add a specific bet_response event for immediate UI updates
      io.emit("bet_response", {
        success: true,
        newBalance: user.walletBalance,
        previousBalance: previousBalance,
        change: -amount,
        platformFee: platformFee,
        userId: userId,
      })
    }

    console.log("Bet placed successfully")
    console.log("New balance:", user.walletBalance)
    console.log("Previous balance:", previousBalance)

    res.status(201).json({
      success: true,
      bet: {
        ...bet.toObject(),
        potentialPayout: potentialPayout,
        originalAmount: amount,
        platformFee: platformFee,
      },
      newBalance: user.walletBalance,
      previousBalance: previousBalance,
      platformFee: platformFee,
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

// Update the resetBalance function to accept a custom amount
exports.resetBalance = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      })
    }

    const userId = req.user.id || req.user._id || req.user.userId

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID not found in request",
      })
    }

    // Find the user
    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }

    // Store previous balance for response
    const previousBalance = user.walletBalance || 0

    // Get the amount from request body or use 0 as default
    const resetAmount = req.body.amount !== undefined ? Number(req.body.amount) : 0

    console.log(`Resetting wallet balance for user ${userId} from ${previousBalance} to ${resetAmount}`)

    // Reset the balance to the specified amount or 0
    user.walletBalance = resetAmount
    await user.save()

    // Emit wallet update event
    if (io) {
      io.emit("wallet_update", {
        userId: userId,
        newBalance: resetAmount,
        previousBalance: previousBalance,
        change: resetAmount - previousBalance,
      })
    }

    res.status(200).json({
      success: true,
      message: `Wallet balance reset to ${resetAmount}`,
      newBalance: resetAmount,
      previousBalance: previousBalance,
    })
  } catch (error) {
    console.error("Reset balance error:", error)
    res.status(500).json({
      success: false,
      message: "Server error while resetting wallet balance",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Add a new API endpoint to update wallet balance
exports.updateWalletBalance = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      })
    }

    const userId = req.user.id || req.user._id || req.user.userId

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID not found in request",
      })
    }

    const { amount } = req.body

    if (amount === undefined) {
      return res.status(400).json({
        success: false,
        message: "Amount is required",
      })
    }

    // Find the user
    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }

    // Store previous balance for response
    const previousBalance = user.walletBalance || 0

    // Update the balance with the provided amount
    user.walletBalance = Number(amount)
    await user.save()

    console.log(`Updated wallet balance for user ${userId} from ${previousBalance} to ${user.walletBalance}`)

    // Emit wallet update event
    if (io) {
      io.emit("wallet_update", {
        userId: userId,
        newBalance: user.walletBalance,
        previousBalance: previousBalance,
        change: user.walletBalance - previousBalance,
      })
    }

    res.status(200).json({
      success: true,
      newBalance: user.walletBalance,
      previousBalance: previousBalance,
    })
  } catch (error) {
    console.error("Update wallet balance error:", error)
    res.status(500).json({
      success: false,
      message: "Server error while updating wallet balance",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Match a bet with opposite bets - updated to handle bet amount after fee
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

    let remainingAmount = newBet.amount // This is already the amount after fee
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

    // Calculate potential payout based on matched amount and odds
    // Get total amounts bet on Yes and No
    const totalYesBets = question.yesBetAmount || 0
    const totalNoBets = question.noBetAmount || 0

    // Calculate odds based on actual bet amounts
    let odds = 1.0 // Default to 1:1 odds
    if (newBet.choice === "Yes" && totalNoBets > 0) {
      odds = totalNoBets / totalYesBets
    } else if (newBet.choice === "No" && totalYesBets > 0) {
      odds = totalYesBets / totalNoBets
    }

    // Calculate potential payout with platform fee
    const platformFeePercentageOnWinnings = 0.05
    const grossPotentialWinnings = matchedAmount * odds
    const potentialPayout = matchedAmount + grossPotentialWinnings * (1 - platformFeePercentageOnWinnings)

    console.log(`Potential payout calculation for matched bet:`)
    console.log(`- Matched amount: ${matchedAmount}`)
    console.log(`- Odds: ${odds}`)
    console.log(`- Gross potential winnings: ${grossPotentialWinnings}`)
    console.log(`- Potential payout: ${potentialPayout}`)

    newBet.potentialPayout = potentialPayout

    await newBet.save()
  } catch (error) {
    console.error("Match bet error:", error)
    throw error
  }
}

// Update global betting statistics - updated to track platform fees
const updateBetStats = async (betAmount, platformFee) => {
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
        totalPlatformFees: 0,
        biggestWinThisWeek: 0,
        totalPlayers: 0,
        activePlayers: 0,
        weekStartDate: startOfWeek,
        weekEndDate: endOfWeek,
      })
    }

    // Update stats
    stats.totalBetsAmount = (stats.totalBetsAmount || 0) + betAmount
    stats.totalPlatformFees = (stats.totalPlatformFees || 0) + platformFee
    stats.updatedAt = now

    await stats.save()
  } catch (error) {
    console.error("Update bet stats error:", error)
    throw error
  }
}

// Resolve a bet question - updated to handle platform fees
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
    question.correctChoice = outcome
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

// Process all bets for a resolved question - updated to handle platform fees
// Process all bets for a resolved question - updated to handle platform fees
const processBetsForQuestion = async (questionId, outcome) => {
  try {
    console.log(`========== PROCESSING BETS FOR QUESTION ${questionId} ==========`)
    console.log(`Outcome: ${outcome}`)

    // Get all bets for this question
    const bets = await Bet.find({ question: questionId, processed: false })
    console.log(`Processing ${bets.length} bets for question ${questionId} with outcome ${outcome}`)

    // First, check if there are both Yes and No bets
    const yesBets = bets.filter((bet) => bet.choice === "Yes")
    const noBets = bets.filter((bet) => bet.choice === "No")

    console.log(`Found ${yesBets.length} Yes bets and ${noBets.length} No bets`)

    // If there are only Yes bets or only No bets, refund all bets
    if (yesBets.length === 0 || noBets.length === 0) {
      console.log(`Only ${yesBets.length === 0 ? "No" : "Yes"} bets found. Refunding all bets.`)

      for (const bet of bets) {
        const user = await User.findById(bet.user)
        if (!user) {
          console.log(`User not found for bet ${bet._id}, skipping`)
          continue
        }

        // Refund the full original amount
        const refundAmount = bet.amount
        console.log(`Refunding ${refundAmount} to user ${user._id} for unmatched bet`)

        // Create refund transaction
        const refundTransaction = new Transaction({
          user: user._id,
          type: "bet_refund",
          amount: refundAmount,
          bet: bet._id,
          question: questionId,
          balanceAfter: user.walletBalance + refundAmount,
          description: "Refund for unmatched bet (no opposing bets)",
        })
        await refundTransaction.save()

        // Update user balance with refund
        const previousBalance = user.walletBalance
        user.walletBalance += refundAmount
        await user.save()
        console.log(`Updated user ${user._id} wallet balance from ${previousBalance} to ${user.walletBalance}`)

        // Update bet status
        bet.status = "refunded"
        bet.processed = true
        await bet.save()

        // Emit wallet update event
        if (io) {
          io.emit("wallet_update", {
            userId: user._id,
            newBalance: user.walletBalance,
            previousBalance: previousBalance,
            change: refundAmount,
            reason: "bet_refund",
          })
        }
      }

      return // Exit early as all bets have been refunded
    }

    // Calculate total amounts for Yes and No bets
    const totalYesAmount = yesBets.reduce((sum, bet) => sum + bet.amount, 0)
    const totalNoAmount = noBets.reduce((sum, bet) => sum + bet.amount, 0)

    console.log(`Total Yes amount: ${totalYesAmount}, Total No amount: ${totalNoAmount}`)

    // Process each bet
    for (const bet of bets) {
      // Skip already processed bets
      if (bet.processed) {
        console.log(`Bet ${bet._id} already processed, skipping`)
        continue
      }

      const user = await User.findById(bet.user)
      if (!user) {
        console.log(`User not found for bet ${bet._id}, skipping`)
        continue
      }

      // IMPORTANT: Log the bet choice and outcome for debugging
      console.log(`Bet ${bet._id}: User chose ${bet.choice}, outcome is ${outcome}`)

      // Determine if this bet is a winner
      const isWinner = String(bet.choice).toLowerCase() === String(outcome).toLowerCase()
      console.log(`Bet ${bet._id} is winner? ${isWinner}`)

      if (isWinner) {
        // Calculate the winning amount based on the proportion of this bet to total winning bets
        const winningBets = bet.choice === "Yes" ? yesBets : noBets
        const losingBets = bet.choice === "Yes" ? noBets : yesBets
        const totalWinningAmount = bet.choice === "Yes" ? totalYesAmount : totalNoAmount
        const totalLosingAmount = bet.choice === "Yes" ? totalNoAmount : totalYesAmount

        // Calculate this bet's proportion of the total winning bets
        const betProportion = bet.amount / totalWinningAmount

        // Calculate winnings based on proportion of losing pool
        const platformFeePercentageOnWin = 0.05
        const grossWinAmount = totalLosingAmount * betProportion + bet.amount // Original bet + proportion of losing pool
        const platformFee = grossWinAmount * platformFeePercentageOnWin
        const winAmount = grossWinAmount - platformFee

        console.log(`Win calculation for bet ${bet._id}:`)
        console.log(`- Bet amount: ${bet.amount}`)
        console.log(`- Bet proportion of winning pool: ${betProportion}`)
        console.log(`- Proportion of losing pool: ${totalLosingAmount * betProportion}`)
        console.log(`- Gross win amount: ${grossWinAmount}`)
        console.log(`- Platform fee (${platformFeePercentageOnWin * 100}%): ${platformFee}`)
        console.log(`- Net win amount: ${winAmount}`)

        // Calculate the actual profit (winnings minus the original bet amount)
        const profit = winAmount - bet.amount

        // Update potential payout to reflect actual winnings
        bet.potentialPayout = winAmount
        bet.grossWinAmount = grossWinAmount
        bet.netWinAmount = winAmount
        bet.platformFeeOnWin = platformFee
        bet.profit = profit

        // Update biggest win if applicable
        if (profit > (user.biggestWin || 0)) {
          user.biggestWin = profit
          console.log(`New biggest win for user ${user._id}: ${profit}`)
        }

        // Update weekly stats if applicable
        await updateBiggestWinThisWeek(profit)

        // Create win transaction
        const winTransaction = new Transaction({
          user: user._id,
          type: "bet_win",
          amount: winAmount,
          bet: bet._id,
          question: questionId,
          balanceAfter: user.walletBalance + winAmount,
          profit: profit, // Store the profit for easier querying
        })
        await winTransaction.save()

        // Create platform fee transaction
        const feeTransaction = new Transaction({
          user: user._id,
          type: "platform_fee",
          amount: -platformFee,
          bet: bet._id,
          question: questionId,
          balanceAfter: user.walletBalance + winAmount,
          description: "Platform fee on winnings",
        })
        await feeTransaction.save()

        try {
          // CRITICAL FIX: Update user balance with winnings and SAVE THE USER
          const previousBalance = user.walletBalance
          user.walletBalance += winAmount

          // Use a transaction to ensure the update is atomic
          const session = await mongoose.startSession()
          await session.withTransaction(async () => {
            await user.save({ session })
          })
          session.endSession()

          console.log(
            `Updated user ${user._id} wallet balance from ${previousBalance} to ${user.walletBalance} after win of ${winAmount}`,
          )

          // Double-check that the update was successful
          const updatedUser = await User.findById(user._id)
          if (updatedUser.walletBalance !== user.walletBalance) {
            console.error(
              `ERROR: User balance update verification failed. Expected: ${user.walletBalance}, Actual: ${updatedUser.walletBalance}`,
            )
            // Try again with a different approach
            await User.updateOne({ _id: user._id }, { $inc: { walletBalance: winAmount } })
            console.log(`Attempted alternative update method for user ${user._id}`)
          }
        } catch (saveError) {
          console.error(`ERROR saving user balance update: ${saveError.message}`)
          console.error(saveError.stack)
          // Try again with a different approach
          await User.updateOne({ _id: user._id }, { $inc: { walletBalance: winAmount } })
          console.log(`Attempted alternative update method for user ${user._id}`)
        }

        bet.status = "won"

        // Emit socket event for win
        if (io) {
          io.emit("bet_win", {
            userId: user._id,
            amount: winAmount,
            profit: profit,
            grossAmount: grossWinAmount,
            platformFee: platformFee,
            questionId: questionId,
          })

          // Also emit wallet update
          io.emit("wallet_update", {
            userId: user._id,
            newBalance: user.walletBalance,
            previousBalance: user.walletBalance - winAmount,
            change: winAmount,
            platformFee: platformFee,
            grossWinAmount: grossWinAmount,
          })
        }
      } else {
        // Loser already had their amount deducted when placing the bet
        bet.status = "lost"
        bet.potentialPayout = 0 // Ensure losers have zero potential payout
        console.log(`Bet ${bet._id} marked as lost`)
      }

      bet.processed = true
      await bet.save()
    }
  } catch (error) {
    console.error("Process bets error:", error)
    throw error
  }
}

// Update biggest win this week in stats
const updateBiggestWinThisWeek = async (winAmount) => {
  try {
    const now = new Date()

    // Find or create stats for the current week
    let stats = await BetStats.findOne({
      weekStartDate: { $lte: now },
      weekEndDate: { $gte: now },
    })

    if (!stats) {
      // Calculate week start and end dates
      const startOfWeek = new Date(now)
      startOfWeek.setDate(now.getDate() - now.getDay())
      startOfWeek.setHours(0, 0, 0, 0)

      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(startOfWeek.getDate() + 6)
      endOfWeek.setHours(23, 59, 59, 999)

      stats = new BetStats({
        totalBetsAmount: 0,
        totalPlatformFees: 0,
        biggestWinThisWeek: 0,
        totalPlayers: 0,
        activePlayers: 0,
        weekStartDate: startOfWeek,
        weekEndDate: endOfWeek,
        streamId: "default-stream",
      })
    }

    // Update biggest win if the new win is larger
    if (winAmount > (stats.biggestWinThisWeek || 0)) {
      console.log(`New biggest win this week: ${winAmount} (previous: ${stats.biggestWinThisWeek || 0})`)
      stats.biggestWinThisWeek = winAmount
      console.log(`New biggest win this week: ${winAmount} (previous: ${stats.biggestWinThisWeek || 0})`)
      await stats.save()

      // Broadcast the new biggest win to all clients
      if (io) {
        io.emit("biggest_win_update", {
          biggestWinThisWeek: winAmount,
        })
      }
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
    // Get the current camera holder from the socket manager
    const cameraHolder = socketManager.getCurrentCameraHolder()

    // Only return a question if there's a valid camera holder
    if (!cameraHolder || !cameraHolder.CameraHolderName || cameraHolder.CameraHolderName === "None") {
      return res.status(404).json({
        success: false,
        message: "No active camera holder available for betting",
      })
    }

    const activeQuestion = await BetQuestion.findOne({
      active: true,
      resolved: false,
      endTime: { $gt: new Date() },
    })

    if (!activeQuestion) {
      // If no active question is found but we have a camera holder, create a new one using socket-manager
      const streamId = req.query.streamId || "default-stream"
      const newQuestion = await socketManager.generateNewQuestion(streamId)

      if (!newQuestion) {
        return res.status(404).json({
          success: false,
          message: "Could not generate a new question",
        })
      }

      // Return the new question
      return res.status(200).json({
        success: true,
        question: newQuestion,
      })
    }

    // Update the response to include the current camera holder
    const questionResponse = {
      ...activeQuestion.toObject(),
      subject: cameraHolder.CameraHolderName,
      question: activeQuestion.question,
    }

    res.status(200).json({
      success: true,
      question: questionResponse,
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

// Get betting statistics - updated to include platform fees
exports.getBetStats = async (req, res) => {
  try {
    const now = new Date()

    // Try to find stats for current week
    let stats = await BetStats.findOne({
      weekStartDate: { $lte: now },
      weekEndDate: { $gte: now },
    })

    // If no stats found, create default stats with zero values
    if (!stats) {
      // Calculate week start and end dates
      const startOfWeek = new Date(now)
      startOfWeek.setDate(now.getDate() - now.getDay())
      startOfWeek.setHours(0, 0, 0, 0)

      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(startOfWeek.getDate() + 6)
      endOfWeek.setHours(23, 59, 59, 999)

      stats = new BetStats({
        totalBetsAmount: 0, // Zero instead of sample data
        totalPlatformFees: 0,
        biggestWinThisWeek: 0, // Zero instead of sample data
        totalPlayers: 0, // Zero instead of sample data
        activePlayers: 0, // Zero instead of sample data
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

    const activePlayersCount = activePlayers.length
    stats.activePlayers = activePlayersCount

    // Get total unique players
    const totalPlayers = await Bet.distinct("user")
    stats.totalPlayers = totalPlayers.length

    // Get total bets amount (sum of all bet amounts)
    const totalBetsAggregate = await Bet.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
    const totalBetsAmount = totalBetsAggregate.length > 0 ? totalBetsAggregate[0].total : 0
    stats.totalBetsAmount = totalBetsAmount

    // Get total platform fees (sum of all platform fees)
    const totalFeesAggregate = await Transaction.aggregate([
      { $match: { type: "platform_fee" } },
      { $group: { _id: null, total: { $sum: { $abs: "$amount" } } } },
    ])
    const totalPlatformFees = totalFeesAggregate.length > 0 ? totalFeesAggregate[0].total : 0
    stats.totalPlatformFees = totalPlatformFees

    await stats.save()

    // Emit updated stats via socket if available
    if (io) {
      console.log("Emitting betting stats with biggestWinThisWeek:", stats.biggestWinThisWeek)
      io.emit("betting_stats", {
        totalBetsAmount: stats.totalBetsAmount,
        totalPlatformFees: stats.totalPlatformFees,
        biggestWinThisWeek: stats.biggestWinThisWeek,
        totalPlayers: stats.totalPlayers,
        activePlayers: stats.activePlayers,
      })
    }

    console.log("Sending betting stats with biggestWinThisWeek:", stats.biggestWinThisWeek)
    res.status(200).json({
      success: true,
      stats: {
        totalBetsAmount: stats.totalBetsAmount,
        totalPlatformFees: stats.totalPlatformFees,
        biggestWinThisWeek: stats.biggestWinThisWeek,
        totalPlayers: stats.totalPlayers,
        activePlayers: stats.activePlayers,
      },
    })
  } catch (error) {
    console.error("Get bet stats error:", error)
    // Return zero values even on error to ensure UI has something to display
    res.status(200).json({
      success: true,
      stats: {
        totalBetsAmount: 0,
        totalPlatformFees: 0,
        biggestWinThisWeek: 0,
        totalPlayers: 0,
        activePlayers: 0,
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
      platformFeePercentage: "5%",
      cameraHolderAvailable: !!socketManager.getCurrentCameraHolder,
      currentCameraHolder: socketManager.getCurrentCameraHolder(),
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
      const user = await ensureUserBalance(req.user.id)
      if (!user) {
        console.error("User not found during login hook")
      }
    }
    next()
  } catch (error) {
    console.error("Login hook error:", error)
    next()
  }
}

// Get platform fee statistics
exports.getPlatformFeeStats = async (req, res) => {
  try {
    // Get total platform fees collected
    const totalFeesAggregate = await Transaction.aggregate([
      { $match: { type: "platform_fee" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])

    const totalFees = totalFeesAggregate.length > 0 ? Math.abs(totalFeesAggregate[0].total) : 0

    // Get platform fees by day for the last 7 days
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const feesByDay = await Transaction.aggregate([
      {
        $match: {
          type: "platform_fee",
          createdAt: { $gte: sevenDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          total: { $sum: { $abs: "$amount" } },
        },
      },
      { $sort: { _id: 1 } },
    ])

    res.status(200).json({
      success: true,
      stats: {
        totalPlatformFees: totalFees,
        feesByDay: feesByDay,
        platformFeePercentage: 5,
      },
    })
  } catch (error) {
    console.error("Get platform fee stats error:", error)
    res.status(500).json({
      success: false,
      message: "Server error while fetching platform fee statistics",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Add a new function to handle camera holder changes
exports.handleCameraHolderChange = async (req, res) => {
  try {
    const { previousHolder, newHolder } = req.body

    console.log(`Camera holder changed from ${previousHolder} to ${newHolder}`)

    // If the camera holder changed to None or empty, resolve all active questions with "No" outcome
    if (!newHolder || newHolder === "None") {
      // Find all active questions
      const activeQuestions = await BetQuestion.find({
        active: true,
        resolved: false,
      })

      // Resolve each question
      for (const question of activeQuestions) {
        question.resolved = true
        question.outcome = "No" // Player died or left, so outcome is No
        question.active = false
        question.resolvedReason = "Camera holder died or changed"
        await question.save()

        // Process all bets for this question
        await processBetsForQuestion(question._id, "No")

        // Emit socket event for question resolution
        if (io) {
          io.emit("questionResolved", {
            questionId: question._id,
            outcome: "No",
            reason: "Camera holder died or changed",
          })
        }
      }
    }

    // Update the camera holder in the socket manager if available
    if (socketManager && typeof socketManager.updateCameraHolder === "function") {
      socketManager.updateCameraHolder({
        CameraHolderName: newHolder || "None",
      })
    }

    res.status(200).json({
      success: true,
      message: "Camera holder change processed successfully",
      previousHolder,
      newHolder,
    })
  } catch (error) {
    console.error("Handle camera holder change error:", error)
    res.status(500).json({
      success: false,
      message: "Server error while handling camera holder change",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Create a new bet question with 36-second timer
exports.createBetQuestion = async (req, res) => {
  try {
    const { streamId } = req.body || { streamId: "default-stream" }

    // Use the generateNewQuestion function from socket-manager
    const newQuestion = await socketManager.generateNewQuestion(streamId)

    if (!newQuestion) {
      return res.status(400).json({
        success: false,
        message: "Could not generate a new question. No active camera holder available.",
      })
    }

    res.status(201).json({
      success: true,
      question: newQuestion,
    })
  } catch (error) {
    console.error("Create bet question error:", error)
    res.status(500).json({
      success: false,
      message: "Server error while creating bet question",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

exports.placeBetWithPartialPayment = async (req, res) => {
  try {
    console.log("=== PLACE BET WITH PARTIAL PAYMENT START ===")
    const { questionId, choice, amount, streamId, paymentAmount } = req.body

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

    console.log("Received bet request:", {
      questionId,
      choice,
      amount,
      streamId,
      userId,
      paymentAmount,
    })

    // Validate bet amount
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid bet amount",
      })
    }

    // Validate payment amount
    if (!paymentAmount || paymentAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment amount",
      })
    }

    // Validate streamId
    if (!streamId) {
      return res.status(400).json({
        success: false,
        message: "Stream ID is required",
      })
    }

    // Find user with actual balance
    console.log("Finding user with ID:", userId)
    const user = await User.findById(userId)

    if (!user) {
      console.log("User not found with ID:", userId)
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }
    console.log("Found user:", user.username || user.email || userId)
    console.log("Current wallet balance:", user.walletBalance || 0)

    // Calculate how much should be deducted from wallet vs. payment
    const walletBalance = user.walletBalance || 0
    const totalBetAmount = Number(amount)

    // Calculate how much to take from wallet and how much from payment
    const walletDeduction = Math.min(walletBalance, totalBetAmount)
    const paymentNeeded = totalBetAmount - walletDeduction

    console.log(`Wallet balance: ${walletBalance}, Total bet: ${totalBetAmount}`)
    console.log(`Will deduct ${walletDeduction} from wallet and ${paymentNeeded} from payment`)

    // Verify the payment amount is sufficient
    if (paymentAmount < paymentNeeded) {
      console.log(`Insufficient payment amount. Needed: ${paymentNeeded}, Provided: ${paymentAmount}`)
      return res.status(400).json({
        success: false,
        message: "Insufficient payment amount",
        insufficientFunds: true,
        currentBalance: walletBalance,
        amountNeeded: paymentNeeded,
        paymentProvided: paymentAmount,
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
          console.log("Searched by string ID:", question ? "Yes" : "No")
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
          // Use the generateNewQuestion function from socket-manager
          question = await socketManager.generateNewQuestion(streamId || "default-stream")

          if (!question) {
            return res.status(400).json({
              success: false,
              message: "No active camera holder available for betting",
            })
          }

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
        allQuestions.map((q) => ({
          id: q._id,
          active: q.active,
          resolved: q.resolved,
        })),
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

    // Calculate platform fee (5% of bet amount)
    const platformFeePercentage = 0.05
    const platformFee = Math.round(amount * platformFeePercentage)
    const betAmountAfterFee = amount - platformFee

    console.log(`Calculating platform fee: ${platformFee} (${platformFeePercentage * 100}% of ${amount})`)
    console.log(`Bet amount after fee: ${betAmountAfterFee}`)

    // Create the bet with the amount after fee
    console.log("Creating new bet")
    const bet = new Bet({
      user: userId,
      question: question._id,
      choice,
      amount: betAmountAfterFee,
      originalAmount: amount,
      platformFee: platformFee,
      status: "pending",
      timestamp: new Date(),
      streamId: streamId,
      matchedAmount: 0,
      potentialPayout: 0,
      processed: false,
    })

    // Store the previous balance for response
    const previousBalance = user.walletBalance || 0

    // Update user's wallet balance - only deduct the wallet portion
    console.log("Updating user wallet balance from", previousBalance, "to", previousBalance - walletDeduction)
    user.walletBalance = previousBalance - walletDeduction
    user.totalBets = (user.totalBets || 0) + 1
    await user.save()

    // Create transaction record for the bet
    console.log("Creating bet transaction record")
    const betTransaction = new Transaction({
      user: userId,
      type: "bet_place",
      amount: -betAmountAfterFee, // Record the bet amount after fee
      bet: bet._id,
      question: question._id,
      balanceAfter: user.walletBalance + platformFee, // Temporary balance after just the bet
    })
    await betTransaction.save()

    // Create transaction record for the platform fee
    console.log("Creating platform fee transaction record")
    const feeTransaction = new Transaction({
      user: userId,
      type: "platform_fee",
      amount: -platformFee, // Record the platform fee as a separate transaction
      bet: bet._id,
      question: question._id,
      balanceAfter: user.walletBalance, // Final balance after both bet and fee
    })
    await feeTransaction.save()

    // Create transaction record for the payment portion
    if (paymentNeeded > 0) {
      console.log("Creating payment transaction record")
      const paymentTransaction = new Transaction({
        user: userId,
        type: "payment_for_bet",
        amount: paymentNeeded,
        bet: bet._id,
        question: question._id,
        balanceAfter: user.walletBalance,
      })
      await paymentTransaction.save()
    }

    // Update question stats with the bet amount after fee
    console.log("Updating question stats")
    if (choice === "Yes") {
      question.yesBetAmount = (question.yesBetAmount || 0) + betAmountAfterFee
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
      question.noBetAmount = (question.noBetAmount || 0) + betAmountAfterFee
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

    question.totalBetAmount = (question.totalBetAmount || 0) + betAmountAfterFee

    // Check if this user has already bet on this question (regardless of choice)
    const existingBet = await Bet.findOne({
      user: userId,
      question: question._id,
      _id: { $ne: bet._id }, // Exclude the current bet
    })

    if (!existingBet) {
      // Only increment if this is the first bet from this user on this question
      question.totalPlayers = (question.totalPlayers || 0) + 1
    }

    question.totalPlatformFees = (question.totalPlatformFees || 0) + platformFee

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

    // Calculate potential winnings with 5% platform fee
    // Formula: payout = bet * 2 * 0.95
    const platformFeePercentageOnWinnings = 0.05
    const grossPotentialWinnings = betAmountAfterFee * odds
    const platformFeeOnWinnings = (betAmountAfterFee + grossPotentialWinnings) * platformFeePercentageOnWinnings
    const potentialPayout = betAmountAfterFee + grossPotentialWinnings - platformFeeOnWinnings

    console.log(`Potential payout calculation:`)
    console.log(`- Bet amount after initial fee: ${betAmountAfterFee}`)
    console.log(`- Odds: ${odds}`)
    console.log(`- Gross potential winnings: ${grossPotentialWinnings}`)
    console.log(`- Platform fee (${platformFeePercentageOnWinnings * 100}%): ${platformFeeOnWinnings}`)
    console.log(`- Net potential payout: ${potentialPayout}`)

    bet.potentialPayout = potentialPayout
    bet.grossPotentialPayout = betAmountAfterFee + grossPotentialWinnings
    bet.platformFeeOnWinnings = platformFeeOnWinnings
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
      await updateBetStats(betAmountAfterFee, platformFee)
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
        totalPlatformFees: question.totalPlatformFees || 0,
      })

      // IMPORTANT: Emit wallet update event with real-time balance
      io.emit("wallet_update", {
        userId: userId,
        newBalance: user.walletBalance,
        previousBalance: previousBalance,
        change: -walletDeduction, // Only report the wallet deduction as the change
        platformFee: platformFee,
        paymentAmount: paymentNeeded, // Include the payment amount
      })

      // Add a specific bet_response event for immediate UI updates
      io.emit("bet_response", {
        success: true,
        newBalance: user.walletBalance,
        previousBalance: previousBalance,
        change: -walletDeduction, // Only report the wallet deduction as the change
        platformFee: platformFee,
        userId: userId,
        paymentAmount: paymentNeeded, // Include the payment amount
      })
    }

    console.log("Bet placed successfully")
    console.log("New balance:", user.walletBalance)
    console.log("Previous balance:", previousBalance)
    console.log("Wallet deduction:", walletDeduction)
    console.log("Payment amount:", paymentNeeded)

    res.status(201).json({
      success: true,
      bet: {
        ...bet.toObject(),
        potentialPayout: potentialPayout,
        originalAmount: amount,
        platformFee: platformFee,
      },
      newBalance: user.walletBalance,
      previousBalance: previousBalance,
      walletDeduction: walletDeduction,
      paymentAmount: paymentNeeded,
      platformFee: platformFee,
      questionStats: {
        yesPercentage: question.yesPercentage,
        noPercentage: question.noPercentage,
        totalBetAmount: question.totalBetAmount,
        totalPlayers: question.totalPlayers,
      },
    })
    console.log("=== PLACE BET WITH PARTIAL PAYMENT END ===")
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

module.exports = exports
