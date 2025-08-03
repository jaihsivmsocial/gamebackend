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

// Helper function to update PlayFab inventory for all betting operations.
// This function centralizes calls to the PlayFab service.
// It also updates the MongoDB user balance after a successful PlayFab transaction.
const updatePlayFabInventory = async (user, amount, transactionId, transactionDetails = {}) => {
  try {
    console.log("🎯 === UPDATE PLAYFAB INVENTORY FUNCTION CALLED (CHECK ANSWER) ===")
    console.log(`🎯 User ID: ${user._id}, Amount: ${amount}, Source: ${transactionDetails.source || "bet"}`)

    if (!playFabService.isConfigured()) {
      console.log("❌ PlayFab not configured, skipping inventory update.")
      return { success: false, reason: "PlayFab not configured", newBalance: user.walletBalance } // Return current balance on config error
    }

    const entityId = playFabService.getPlayFabEntityId(user)
    if (!entityId) {
      console.log(`❌ No PlayFab Entity ID found for user ${user._id}, skipping inventory update.`)
      return { success: false, reason: "No PlayFab Entity ID", newBalance: user.walletBalance } // Return current balance on entity ID error
    }
    console.log(`✅ Using PlayFab Entity ID: ${entityId} for user ${user._id}`)

    const currentBalance = user.walletBalance // Use MongoDB balance as starting point
    console.log(`📊 Current MongoDB balance before PlayFab update: ${currentBalance}`)

    const result = await playFabService.processPaymentToPlayFab(user, amount, transactionId, transactionDetails)

    if (result.success) {
      console.log(`✅ Successfully processed PlayFab payment for user ${user._id}.`)
      console.log("✅ PlayFab Result Details:", JSON.stringify(result.playFabResult, null, 2))

      // After successful PlayFab transaction, fetch the latest balance from PlayFab
      // and update MongoDB user balance to ensure consistency.
      try {
        const updatedInventory = await playFabService.getPlayerInventory(user)
        const newBalance = updatedInventory.virtualCurrencyBalance || 0
        console.log(`📊 PlayFab balance after update: ${newBalance} (Change: ${newBalance - currentBalance})`)

        // CRITICAL FIX: Update MongoDB user balance to match PlayFab
        user.walletBalance = newBalance
        await user.save()
        console.log(`✅ MongoDB user balance updated to match PlayFab: ${newBalance}`)
        return { success: true, newBalance: newBalance } // Return the new balance
      } catch (balanceError) {
        console.error(`⚠️ Could not get updated balance from PlayFab or update MongoDB: ${balanceError.message}`)
        // Even if MongoDB update fails, the PlayFab transaction might have succeeded.
        // Return success based on PlayFab, but indicate potential sync issue.
        return { success: true, newBalance: user.walletBalance, warning: "MongoDB balance sync failed" }
      }
    } else {
      console.error(`❌ Failed to process PlayFab payment: ${result.error}`)
      return { success: false, error: result.error, newBalance: user.walletBalance } // Return current balance on PlayFab failure
    }
  } catch (error) {
    console.error("❌ Unhandled error in updatePlayFabInventory:", error.message)
    return { success: false, error: error.message, newBalance: user.walletBalance } // Return current balance on unhandled error
  }
}

// Renamed from processOngoingBetQuestions to clarify its role in processing resolved questions for payouts
async function processResolvedQuestionsForPayouts() {
  try {
    console.log("=== PROCESSING RESOLVED BET QUESTIONS FOR PAYOUTS ===")
    // Find questions with status "outcome_set_pending_payout"
    const questionsToProcess = await BetQuestion.find({
      status: "outcome_set_pending_payout",
      resolved: true, // Ensure it's marked as resolved
      correctChoice: { $ne: null, $ne: "" }, // Ensure outcome is set
    })

    if (!questionsToProcess.length) {
      console.log("No resolved questions pending payout to process.")
      return
    }

    console.log(`Processing ${questionsToProcess.length} resolved questions for payouts.`)

    for (const question of questionsToProcess) {
      const { _id: questionId, correctChoice } = question
      console.log(`Processing question ${questionId} with correctChoice: ${correctChoice}`)

      // Now process all bets for this question
      await processBetsForQuestion(questionId, correctChoice)

      // Mark question as completed after processing all bets
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
    console.log("=== PAYOUT PROCESSING COMPLETED ===")
  } catch (error) {
    console.error("Error processing resolved questions for payouts:", error)
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
        // Refund the full original amount
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
      console.log(`🎲 Bet ${bet._id}: User chose ${bet.choice}, outcome is ${outcome}, isWinner: ${isWinner}`)

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
    const grossPotentialWin = totalOppositeSideBets * betProportion + matchedAmount // This is the total amount (stake + profit from losing pool)
    const platformFee = grossPotentialWin * platformFeePercentageOnWin
    const potentialPayout = grossPotentialWin - platformFee // This is the final amount to be paid out

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
    console.log(`- Win amount (potentialPayout): ${winAmount}`) // Added log
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

    // 🔥 CRITICAL FIX: Update PlayFab inventory FIRST to get the new balance
    console.log(`🎮 Updating PlayFab inventory for user ${user._id} with win amount: ${winAmount}`)
    const playFabResult = await updatePlayFabInventory(
      user,
      winAmount, // Positive amount for addition
      `bet-win-${bet._id}`,
      { source: "bet_win", betId: bet._id, questionId: bet.question },
    )

    if (!playFabResult.success) {
      console.error(`❌ PlayFab inventory update failed for bet win:`, playFabResult.error)
      // Mark bet as error and return
      bet.processed = true
      bet.status = "error"
      await bet.save()
      return
    }

    const newBalance = playFabResult.newBalance // Get the new balance from PlayFab update

    // Create win transaction AFTER PlayFab update and with the correct balanceAfter
    const winTransaction = new Transaction({
      user: user._id,
      type: "bet_win",
      amount: winAmount,
      bet: bet._id,
      question: bet.question,
      balanceAfter: newBalance, // Set balanceAfter here
      profit: profit, // Store the profit for easier querying
    })

    try {
      const session = await mongoose.startSession()
      await session.withTransaction(async () => {
        await bet.save({ session })
        await winTransaction.save({ session }) // This should now pass validation
      })
      session.endSession()

      console.log(`✅ PlayFab inventory updated successfully for bet win`)
      console.log(`Updated user ${user._id} wallet balance to ${newBalance} after win of ${winAmount}`)

      // Emit socket events for real-time updates
      if (io) {
        io.emit("bet_win", {
          userId: user._id,
          amount: winAmount,
          profit: profit,
          grossAmount: bet.grossWinAmount, // Use stored gross amount
          platformFee: bet.platformFeeOnWin, // Use stored platform fee
          questionId: bet.question,
        })
        io.emit("wallet_update", {
          userId: user._id,
          newBalance: newBalance,
          previousBalance: newBalance - winAmount, // Calculate previous for emit
          change: winAmount,
          platformFee: bet.platformFeeOnWin,
          grossWinAmount: bet.grossWinAmount,
        })
      }
    } catch (error) {
      console.error(`Error saving transaction or bet for bet ${bet._id}:`, error)
      throw error
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
    const refundAmount = bet.originalAmount // FIXED: Use originalAmount for full refund
    if (typeof refundAmount !== "number" || isNaN(refundAmount)) {
      console.error(`Invalid refundAmount for bet ${bet._id}: ${refundAmount}`)
      bet.processed = true
      bet.status = "error"
      await bet.save()
      return
    }

    console.log(`Refunding ${refundAmount} to user ${user._id} for unmatched bet`)

    // 🔥 CRITICAL FIX: Update PlayFab inventory FIRST to get the new balance
    console.log(`🎮 Updating PlayFab inventory for user ${user._id} with refund amount: ${refundAmount}`)
    const playFabResult = await updatePlayFabInventory(
      user,
      refundAmount, // Positive amount for addition
      `bet-refund-${bet._id}`,
      { source: "bet_refund", betId: bet._id, questionId: bet.question },
    )

    if (!playFabResult.success) {
      console.error(`❌ PlayFab inventory update failed for bet refund:`, playFabResult.error)
      // Mark bet as error and return
      bet.processed = true
      bet.status = "error"
      await bet.save()
      return
    }

    const newBalance = playFabResult.newBalance // Get the new balance from PlayFab update

    // Create refund transaction AFTER PlayFab update and with the correct balanceAfter
    const refundTransaction = new Transaction({
      user: user._id,
      type: "bet_refund",
      amount: refundAmount,
      bet: bet._id,
      question: bet.question,
      balanceAfter: newBalance, // Set balanceAfter here
      description: "Refund for unmatched bet (no opposing bets)",
    })

    try {
      const session = await mongoose.startSession()
      await session.withTransaction(async () => {
        await refundTransaction.save({ session }) // This should now pass validation
      })
      session.endSession()

      console.log(`✅ PlayFab inventory updated successfully for bet refund`)
      console.log(`Updated user ${user._id} wallet balance to ${newBalance} after refund of ${refundAmount}`)

      // Update bet status
      bet.status = "refunded"
      bet.processed = true
      await bet.save()

      // Emit wallet update event
      if (io) {
        io.emit("wallet_update", {
          userId: user._id,
          newBalance: newBalance,
          previousBalance: newBalance - refundAmount, // Calculate previous for emit
          change: refundAmount,
          reason: "bet_refund",
        })
      }
    } catch (error) {
      console.error(`Error saving transaction or bet for bet ${bet._id}:`, error)
      throw error
    }
  } catch (error) {
    console.error(`Error refunding bet ${bet._id}:`, error)
    throw error // Re-throw to propagate the error
  }
}

// Refund partial bet
async function refundPartialBet(bet, unmatchedAmount) {
  try {
    const user = await User.findById(bet.user)
    if (!user) {
      console.log(`User not found for bet ${bet._id}, skipping partial refund`)
      bet.processed = true
      bet.status = "error"
      await bet.save()
      return
    }

    if (typeof unmatchedAmount !== "number" || isNaN(unmatchedAmount)) {
      console.error(`Invalid unmatchedAmount for bet ${bet._id}: ${unmatchedAmount}`)
      bet.processed = true
      bet.status = "error"
      await bet.save()
      return
    }

    console.log(`Processing partial refund of ${unmatchedAmount} for bet ${bet._id}`)

    // 🔥 CRITICAL FIX: Update PlayFab inventory FIRST to get the new balance
    console.log(`🎮 Updating PlayFab inventory for user ${user._id} with partial refund amount: ${unmatchedAmount}`)
    const playFabResult = await updatePlayFabInventory(
      user,
      unmatchedAmount, // Positive amount for addition
      `bet-partial-refund-${bet._id}`,
      { source: "bet_partial_refund", betId: bet._id, questionId: bet.question },
    )

    if (!playFabResult.success) {
      console.error(`❌ PlayFab inventory update failed for partial refund:`, playFabResult.error)
      // Mark bet as error and return
      bet.processed = true
      bet.status = "error"
      await bet.save()
      return
    }

    const newBalance = playFabResult.newBalance // Get the new balance from PlayFab update

    // Create refund transaction for unmatched amount AFTER PlayFab update and with the correct balanceAfter
    const refundTransaction = new Transaction({
      user: user._id,
      type: "bet_partial_refund",
      amount: unmatchedAmount, // Refund the exact unmatched amount
      bet: bet._id,
      question: bet.question,
      balanceAfter: newBalance, // Set balanceAfter here
      description: "Refund for unmatched portion of bet",
    })

    const session = await mongoose.startSession()
    await session.withTransaction(async () => {
      await refundTransaction.save({ session }) // This should now pass validation
    })
    session.endSession()

    console.log(`✅ PlayFab inventory updated successfully for partial refund`)
    console.log(`Updated user ${user._id} wallet balance to ${newBalance} after partial refund of ${unmatchedAmount}`)

    // Emit wallet update event
    if (io) {
      io.emit("wallet_update", {
        userId: user._id,
        newBalance: newBalance,
        previousBalance: newBalance - unmatchedAmount, // Calculate previous for emit
        change: unmatchedAmount,
        reason: "bet_partial_refund",
      })
    }
  } catch (error) {
    console.error(`Error processing partial refund for bet ${bet._id}:`, error)
    throw error
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
  console.log("Running cron job to process resolved bet questions for payouts...")
  processResolvedQuestionsForPayouts()
})

module.exports = {
  processResolvedQuestionsForPayouts, // Export the renamed function
}
