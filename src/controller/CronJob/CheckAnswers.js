const cron = require("node-cron")
const mongoose = require("mongoose")
const BetQuestion = require("../../model/battingModel/BetQuestion")
const Bet = require("../../model/battingModel/Bet")
const User = require("../../model/authModel/userModel.js")
const Transaction = require("../../model/battingModel/Transaction")
const BetStats = require("../../model/battingModel/BetStats")

// 🔥 CRITICAL FIX: Import PlayFab service for inventory updates
const playFabService = require("../../utils/playfab/playfab-service.js")

// Socket.io setup with fallback
let io
try {
  const socketManager = require("../socket/socket-manager.js")
  io = socketManager.io
} catch (error) {
  console.log("Socket.io not available, using dummy implementation")
  io = {
    emit: (event, data) => {
      console.log(`[DUMMY IO] Would emit ${event}:`, data)
    },
  }
}

async function processOngoingBetQuestions() {
  try {
    console.log("=== PROCESSING ONGOING BET QUESTIONS ===")

    // Find questions with status "ongoing"
    const ongoingQuestions = await BetQuestion.find({
      status: "ongoing",
    })

    if (!ongoingQuestions.length) {
      console.log("No ongoing questions to process.")
      return
    }

    console.log(`Processing ${ongoingQuestions.length} ongoing questions.`)

    for (const question of ongoingQuestions) {
      const { _id: questionId, correctChoice } = question
      console.log(`Processing question ${questionId} with correctChoice: ${correctChoice || "not set"}`)

      // CRITICAL FIX: If correctChoice is empty, skip this question for now
      if (!correctChoice || correctChoice === "") {
        console.log(`Question ${questionId} has no correctChoice set. Skipping for now.`)
        continue
      }

      // Now process all bets for this question
      await processBetsForQuestion(questionId, correctChoice)

      // Mark question as completed
      question.status = "completed"
      await question.save()
      console.log(`Question ${questionId} marked as completed.`)

      // Emit socket event for question resolution
      if (io) {
        io.emit("questionResolved", {
          questionId: question._id,
          outcome: correctChoice,
        })
      }
    }

    console.log("=== PROCESSING COMPLETED ===")
  } catch (error) {
    console.error("Error processing bets:", error)
  }
}

// Process all bets for a resolved question
async function processBetsForQuestion(questionId, outcome) {
  try {
    console.log(`========== PROCESSING BETS FOR QUESTION ${questionId} ==========`)
    console.log(`Outcome: ${outcome}`)
    // Get all bets for this question
    const bets = await Bet.find({ question: questionId })

    console.log(`Processing ${bets.length} bets for question ${questionId} with outcome ${outcome}`)

    // First, check if there are both Yes and No bets
    const yesBets = bets.filter((bet) => bet.choice === "Yes")
    const noBets = bets.filter((bet) => bet.choice === "No")

    console.log(`Found ${yesBets.length} Yes bets and ${noBets.length} No bets`)

    // If there are only Yes bets or only No bets, refund all bets
    if (yesBets.length === 0 || noBets.length === 0) {
      console.log(`Only ${yesBets.length === 0 ? "No" : "Yes"} bets found. Refunding all bets.`)
      for (const bet of bets) {
        if (bet.processed) continue // Skip already processed bets
        await refundBet(bet)
      }
      return // Exit early as all bets have been refunded
    }

    // Calculate total amounts for Yes and No bets
    const totalYesAmount = yesBets.reduce((sum, bet) => sum + (bet.matchedAmount || bet.amount), 0)
    const totalNoAmount = noBets.reduce((sum, bet) => sum + (bet.matchedAmount || bet.amount), 0)

    console.log(`Total Yes amount: ${totalYesAmount}, Total No amount: ${totalNoAmount}`)

    // CRITICAL FIX: Ensure all bets have their potential payouts calculated
    await ensurePotentialPayoutsCalculated(bets, totalYesAmount, totalNoAmount)

    // Now process winning and losing bets based on the outcome
    for (const bet of bets) {
      if (bet.processed) {
        console.log(`Bet ${bet._id} already processed, skipping`)
        continue
      }

      // Determine if this bet is a winner
      const isWinner = String(bet.choice).toLowerCase() === String(outcome).toLowerCase()
      console.log(`Bet ${bet._id}: User chose ${bet.choice}, outcome is ${outcome}, isWinner: ${isWinner}`)

      // Handle partially matched bets
      if (bet.matchedAmount < bet.amount) {
        const unmatchedAmount = bet.amount - bet.matchedAmount
        if (unmatchedAmount > 0) {
          console.log(`Bet ${bet._id} has ${unmatchedAmount} unmatched amount. Processing refund.`)
          await refundPartialBet(bet, unmatchedAmount)
        }
      }

      // Process the bet based on win/loss
      if (isWinner) {
        await processBetWin(bet)
      } else {
        await processBetLoss(bet)
      }
    }
  } catch (error) {
    console.error("Process bets error:", error)
    throw error
  }
}

// CRITICAL FIX: Ensure all bets have their potential payouts calculated
async function ensurePotentialPayoutsCalculated(bets, totalYesAmount, totalNoAmount) {
  for (const bet of bets) {
    // Skip already processed bets
    if (bet.processed) continue

    // If potential payout is already set and non-zero, skip
    if (bet.potentialPayout > 0) continue

    // Calculate potential payout based on matched amount and total pool
    const matchedAmount = bet.matchedAmount > 0 ? bet.matchedAmount : bet.amount
    const isYesBet = bet.choice === "Yes"
    const totalSameSideBets = isYesBet ? totalYesAmount : totalNoAmount
    const totalOppositeSideBets = isYesBet ? totalNoAmount : totalYesAmount

    // Calculate this bet's proportion of its side
    const betProportion = matchedAmount / totalSameSideBets

    // Calculate potential winnings based on proportion of opposite pool
    const platformFeePercentageOnWin = 0.05
    const grossPotentialWin = totalOppositeSideBets * betProportion + matchedAmount
    const platformFee = grossPotentialWin * platformFeePercentageOnWin
    const potentialPayout = grossPotentialWin - platformFee

    console.log(`Calculating potential payout for bet ${bet._id}:`)
    console.log(`- Choice: ${bet.choice}, Matched amount: ${matchedAmount}`)
    console.log(`- Bet proportion: ${betProportion.toFixed(4)}`)
    console.log(`- Gross potential win: ${grossPotentialWin.toFixed(2)}`)
    console.log(`- Platform fee: ${platformFee.toFixed(2)}`)
    console.log(`- Potential payout: ${potentialPayout.toFixed(2)}`)

    // Update the bet with the calculated potential payout
    bet.potentialPayout = potentialPayout
    await bet.save()
  }
}

// Process a winning bet
async function processBetWin(bet) {
  try {
    const user = await User.findById(bet.user)
    if (!user) {
      console.log(`User not found for bet ${bet._id}, skipping`)
      bet.processed = true
      bet.status = "error"
      await bet.save()
      return
    }

    // Use the potential payout that was calculated earlier
    const winAmount = bet.potentialPayout
    const matchedAmount = bet.matchedAmount > 0 ? bet.matchedAmount : bet.amount

    // Calculate the actual profit (winnings minus the original matched bet amount)
    const profit = winAmount - matchedAmount

    console.log(`Win processing for bet ${bet._id}:`)
    console.log(`- Matched bet amount: ${matchedAmount}`)
    console.log(`- Win amount: ${winAmount}`)
    console.log(`- Profit: ${profit}`)

    // Update bet status
    bet.status = "won"
    bet.processed = true

    // Update biggest win if applicable
    if (profit > (user.biggestWin || 0)) {
      user.biggestWin = profit
      console.log(`New biggest win for user ${user._id}: ${profit}`)

      // Update biggest win this week in stats
      await updateBiggestWinThisWeek(profit)
    }

    // Create win transaction
    const winTransaction = new Transaction({
      user: user._id,
      type: "bet_win",
      amount: winAmount,
      bet: bet._id,
      question: bet.question,
      balanceAfter: user.walletBalance + winAmount,
      profit: profit, // Store the profit for easier querying
    })

    try {
      // Use a transaction to ensure atomic updates
      const session = await mongoose.startSession()
      await session.withTransaction(async () => {
        // Update user balance with winnings
        const previousBalance = user.walletBalance || 0
        user.walletBalance = previousBalance + winAmount
        user.totalWins = (user.totalWins || 0) + winAmount

        // Save all changes
        await user.save({ session })
        await bet.save({ session })
        await winTransaction.save({ session })

        console.log(
          `Updated user ${user._id} wallet balance from ${previousBalance} to ${user.walletBalance} after win of ${winAmount}`,
        )
      })
      session.endSession()

      // 🔥 CRITICAL FIX: Update PlayFab inventory for bet wins
      console.log(`🎮 Updating PlayFab inventory for user ${user._id} with win amount: ${winAmount}`)
      try {
        const playFabResult = await playFabService.processPaymentToPlayFab(
          user,
          winAmount, // Positive amount for addition
          `bet-win-${bet._id}`,
          { source: "bet_win", betId: bet._id, questionId: bet.question },
        )

        if (playFabResult.success) {
          console.log(`✅ PlayFab inventory updated successfully for bet win`)
          console.log(`   - Amount added: ${winAmount}`)
          console.log(`   - Method: ${playFabResult.playFabResult.method}`)
        } else {
          console.error(`❌ PlayFab inventory update failed for bet win:`, playFabResult.error)
        }
      } catch (playFabError) {
        console.error(`❌ Error updating PlayFab inventory for bet win:`, playFabError)
      }

      // Double-check that the update was successful
      const updatedUser = await User.findById(user._id)
      if (updatedUser.walletBalance !== user.walletBalance) {
        console.error(
          `ERROR: User balance update verification failed. Expected: ${user.walletBalance}, Actual: ${updatedUser.walletBalance}`,
        )
        // Try again with a different approach
        await User.updateOne({ _id: user._id }, { $inc: { walletBalance: winAmount, totalWins: winAmount } })
        console.log(`Attempted alternative update method for user ${user._id}`)
      }

      // Emit socket events for real-time updates
      if (io) {
        io.emit("bet_win", {
          userId: user._id,
          amount: winAmount,
          profit: profit,
          questionId: bet.question,
        })

        io.emit("wallet_update", {
          userId: user._id,
          newBalance: user.walletBalance,
          previousBalance: user.walletBalance - winAmount,
          change: winAmount,
        })
      }
    } catch (error) {
      console.error(`Error processing win for bet ${bet._id}:`, error)
      // Try a fallback approach
      try {
        user.walletBalance = (user.walletBalance || 0) + winAmount
        user.totalWins = (user.totalWins || 0) + winAmount
        await user.save()
        await bet.save()
        await winTransaction.save()

        console.log(`Fallback: Updated user ${user._id} wallet balance to ${user.walletBalance}`)
      } catch (fallbackError) {
        console.error(`Fallback error for bet ${bet._id}:`, fallbackError)
      }
    }
  } catch (error) {
    console.error(`Error processing win for bet ${bet._id}:`, error)
  }
}

// Process a losing bet
async function processBetLoss(bet) {
  try {
    // CRITICAL FIX: Ensure the bet is marked as lost and processed
    bet.status = "lost"
    bet.processed = true
    await bet.save()

    // Get the user for logging purposes
    const user = await User.findById(bet.user)
    if (user) {
      console.log(`Bet ${bet._id} marked as lost for user ${user._id}`)

      // Emit socket event for bet loss
      if (io) {
        io.emit("bet_loss", {
          userId: user._id,
          betId: bet._id,
          questionId: bet.question,
          amount: bet.amount,
        })
      }
    } else {
      console.log(`Bet ${bet._id} marked as lost, but user not found`)
    }
  } catch (error) {
    console.error(`Error processing loss for bet ${bet._id}:`, error)
  }
}

// Refund a bet
async function refundBet(bet) {
  try {
    const user = await User.findById(bet.user)
    if (!user) {
      console.log(`User not found for bet ${bet._id}, skipping refund`)
      bet.processed = true
      bet.status = "error"
      await bet.save()
      return
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
      question: bet.question,
      balanceAfter: user.walletBalance + refundAmount,
      description: "Refund for unmatched bet (no opposing bets)",
    })

    try {
      // Use a transaction to ensure atomic updates
      const session = await mongoose.startSession()
      await session.withTransaction(async () => {
        // Update user balance with refund
        const previousBalance = user.walletBalance || 0
        user.walletBalance = previousBalance + refundAmount

        // Save all changes
        await user.save({ session })
        await refundTransaction.save({ session })

        console.log(
          `Updated user ${user._id} wallet balance from ${previousBalance} to ${user.walletBalance} after refund of ${refundAmount}`,
        )
      })
      session.endSession()

      // 🔥 CRITICAL FIX: Update PlayFab inventory for refunds
      console.log(`🎮 Updating PlayFab inventory for user ${user._id} with refund amount: ${refundAmount}`)
      try {
        const playFabResult = await playFabService.processPaymentToPlayFab(
          user,
          refundAmount, // Positive amount for addition
          `bet-refund-${bet._id}`,
          { source: "bet_refund", betId: bet._id, questionId: bet.question },
        )

        if (playFabResult.success) {
          console.log(`✅ PlayFab inventory updated successfully for bet refund`)
        } else {
          console.error(`❌ PlayFab inventory update failed for bet refund:`, playFabResult.error)
        }
      } catch (playFabError) {
        console.error(`❌ Error updating PlayFab inventory for bet refund:`, playFabError)
      }

      // Update bet status
      bet.status = "refunded"
      bet.processed = true
      await bet.save()

      // Emit wallet update event
      if (io) {
        io.emit("wallet_update", {
          userId: user._id,
          newBalance: user.walletBalance,
          previousBalance: user.walletBalance - refundAmount,
          change: refundAmount,
          reason: "bet_refund",
        })
      }
    } catch (error) {
      console.error(`Error processing refund for bet ${bet._id}:`, error)
      // Try a fallback approach
      try {
        user.walletBalance = (user.walletBalance || 0) + refundAmount
        await user.save()
        bet.status = "refunded"
        bet.processed = true
        await bet.save()
        await refundTransaction.save()

        console.log(`Fallback: Updated user ${user._id} wallet balance to ${user.walletBalance} after refund`)
      } catch (fallbackError) {
        console.error(`Fallback error for bet ${bet._id} refund:`, fallbackError)
      }
    }
  } catch (error) {
    console.error(`Error refunding bet ${bet._id}:`, error)
  }
}

// Refund partial bet
async function refundPartialBet(bet, unmatchedAmount) {
  try {
    const user = await User.findById(bet.user)
    if (!user) {
      console.log(`User not found for bet ${bet._id}, skipping partial refund`)
      return
    }

    console.log(`Processing partial refund of ${unmatchedAmount} for bet ${bet._id}`)

    // Create refund transaction for unmatched amount
    const refundTransaction = new Transaction({
      user: user._id,
      type: "bet_partial_refund",
      amount: unmatchedAmount,
      bet: bet._id,
      question: bet.question,
      balanceAfter: user.walletBalance + unmatchedAmount,
      description: "Refund for unmatched portion of bet",
    })

    try {
      // Use a transaction to ensure atomic updates
      const session = await mongoose.startSession()
      await session.withTransaction(async () => {
        // Update user balance with refund
        const previousBalance = user.walletBalance || 0
        user.walletBalance = previousBalance + unmatchedAmount

        // Save all changes
        await user.save({ session })
        await refundTransaction.save({ session })

        console.log(
          `Updated user ${user._id} wallet balance from ${previousBalance} to ${user.walletBalance} after partial refund of ${unmatchedAmount}`,
        )
      })
      session.endSession()

      // 🔥 CRITICAL FIX: Update PlayFab inventory for partial refunds
      console.log(`🎮 Updating PlayFab inventory for user ${user._id} with partial refund amount: ${unmatchedAmount}`)
      try {
        const playFabResult = await playFabService.processPaymentToPlayFab(
          user,
          unmatchedAmount, // Positive amount for addition
          `bet-partial-refund-${bet._id}`,
          { source: "bet_partial_refund", betId: bet._id, questionId: bet.question },
        )

        if (playFabResult.success) {
          console.log(`✅ PlayFab inventory updated successfully for partial refund`)
        } else {
          console.error(`❌ PlayFab inventory update failed for partial refund:`, playFabResult.error)
        }
      } catch (playFabError) {
        console.error(`❌ Error updating PlayFab inventory for partial refund:`, playFabError)
      }

      // Emit wallet update event
      if (io) {
        io.emit("wallet_update", {
          userId: user._id,
          newBalance: user.walletBalance,
          previousBalance: user.walletBalance - unmatchedAmount,
          change: unmatchedAmount,
          reason: "bet_partial_refund",
        })
      }
    } catch (error) {
      console.error(`Error processing partial refund for bet ${bet._id}:`, error)
      // Try a fallback approach
      try {
        user.walletBalance = (user.walletBalance || 0) + unmatchedAmount
        await user.save()
        await refundTransaction.save()

        console.log(`Fallback: Updated user ${user._id} wallet balance to ${user.walletBalance} after partial refund`)
      } catch (fallbackError) {
        console.error(`Fallback error for bet ${bet._id} partial refund:`, fallbackError)
      }
    }
  } catch (error) {
    console.error(`Error processing partial refund for bet ${bet._id}:`, error)
  }
}

// Update biggest win this week in stats
async function updateBiggestWinThisWeek(winAmount) {
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
  }
}

// Run every minute
cron.schedule("* * * * *", () => {
  console.log("Running cron job to process ongoing bet questions...")
  processOngoingBetQuestions()
})

module.exports = {
  processOngoingBetQuestions,
}
