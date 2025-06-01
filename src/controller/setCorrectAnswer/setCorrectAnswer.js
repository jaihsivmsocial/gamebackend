const Bet = require("../../model/battingModel/Bet");
const User = require("../../model/userModel");
const BetQuestion = require("../../model/battingModel/BetQuestion");
const playerModel = require("../../model/battingModel/playerModel");

exports.processOngoingBetQuestions = async (_id, subject, noOfKills) => {
  console.log(
    `Processing bet question: ID=${_id}, Subject=${subject}, Required Kills=${noOfKills}`
  );
  try {
    const question = await BetQuestion.findById(_id);

      console.log(
      `-------------------1.1-----------------Found question: ${question}`
    );

    console.log(
      `-------------------1-----------------Found question: ${question.subject}`
    );

    if (!question) {
      console.log(`No question found with ID: ${_id}`);
      return;
    }

    // Find the player's kill count
    // let answer = await fineKill(subject);
    const currentKills = await fineKill(subject);

    // const currentKills = answer[0]?.Kills || 0;

    console.log(
      `----------------------2--------------------------Player ${subject} has ${currentKills.KillsForCal} kills. Required: ${noOfKills}`
    );
    console.log(`Kill condition met? ${currentKills.KillsForCal >= noOfKills}`);

    // Set the correct choice based on kill count
    if (currentKills.KillsForCal >= noOfKills) {
      question.correctChoice = "Yes";
      console.log(`Setting correctChoice to "Yes" for question ${_id}`);
    } else {
      question.correctChoice = "No";
      console.log(`Setting correctChoice to "No" for question ${_id}`);
    }

    const updatedPlayer = await playerModel.findByIdAndUpdate(
      currentKills._id, // Replace with actual ID
      { Kills: 0 , KillsForCal:0}, // Update: set Kills to 0
      { new: true } // Option to return the updated document
    );

    // CRITICAL FIX: Set the status to "ongoing" so the cron job can process it
    question.status = "ongoing";

    // CRITICAL FIX: Make sure the correctChoice is saved
    await question.save();

    console.log(
      `Question ${_id} updated: correctChoice=${question.correctChoice}, status=${question.status}`
    );

    // CRITICAL FIX: Verify the update was successful
    const updatedQuestion = await BetQuestion.findById(_id);
    if (
      !updatedQuestion.correctChoice ||
      updatedQuestion.correctChoice !== question.correctChoice
    ) {
      console.error(
        `ERROR: Question update verification failed. Expected correctChoice: ${question.correctChoice}, Actual: ${updatedQuestion.correctChoice}`
      );
      // Try again with a different approach
      await BetQuestion.updateOne(
        { _id },
        {
          $set: {
            correctChoice: currentKills >= noOfKills ? "Yes" : "No",
            status: "ongoing",
          },
        }
      );
      console.log(`Attempted alternative update method for question ${_id}`);

      // Verify again
      const reVerifiedQuestion = await BetQuestion.findById(_id);
      console.log(
        `Re-verification: correctChoice=${reVerifiedQuestion.correctChoice}, status=${reVerifiedQuestion.status}`
      );
    }

    // CRITICAL FIX: Calculate potential payouts for all bets immediately
    await calculatePotentialPayouts(_id);
  } catch (error) {
    console.error(`Error processing bet question ${_id}:`, error);
  }
};

// CRITICAL FIX: Add function to calculate potential payouts for all bets
async function calculatePotentialPayouts(questionId) {
  try {
    console.log(
      `Calculating potential payouts for all bets on question ${questionId}`
    );

    // Get all bets for this question
    const bets = await Bet.find({ question: questionId });

    // First, check if there are both Yes and No bets
    const yesBets = bets.filter((bet) => bet.choice === "Yes");
    const noBets = bets.filter((bet) => bet.choice === "No");

    // If there are only Yes bets or only No bets, no need to calculate payouts
    if (yesBets.length === 0 || noBets.length === 0) {
      console.log(
        `Only ${yesBets.length === 0 ? "No" : "Yes"} bets found. No need to calculate payouts.`
      );
      return;
    }

    // Calculate total amounts for Yes and No bets
    const totalYesAmount = yesBets.reduce(
      (sum, bet) => sum + (bet.matchedAmount || bet.amount),
      0
    );
    const totalNoAmount = noBets.reduce(
      (sum, bet) => sum + (bet.matchedAmount || bet.amount),
      0
    );

    console.log(
      `Total Yes amount: ${totalYesAmount}, Total No amount: ${totalNoAmount}`
    );

    // Calculate potential payouts for all bets
    for (const bet of bets) {
      // Calculate potential payout based on matched amount and total pool
      const matchedAmount =
        bet.matchedAmount > 0 ? bet.matchedAmount : bet.amount;
      const isYesBet = bet.choice === "Yes";
      const totalSameSideBets = isYesBet ? totalYesAmount : totalNoAmount;
      const totalOppositeSideBets = isYesBet ? totalNoAmount : totalYesAmount;

      // Calculate this bet's proportion of its side
      const betProportion = matchedAmount / totalSameSideBets;

      // Calculate potential winnings based on proportion of opposite pool
      const platformFeePercentageOnWin = 0.05;
      const grossPotentialWin =
        totalOppositeSideBets * betProportion + matchedAmount;
      const platformFee = grossPotentialWin * platformFeePercentageOnWin;
      const potentialPayout = grossPotentialWin - platformFee;

      console.log(`Calculating potential payout for bet ${bet._id}:`);
      console.log(`- Choice: ${bet.choice}, Matched amount: ${matchedAmount}`);
      console.log(`- Bet proportion: ${betProportion.toFixed(4)}`);
      console.log(`- Gross potential win: ${grossPotentialWin.toFixed(2)}`);
      console.log(`- Platform fee: ${platformFee.toFixed(2)}`);
      console.log(`- Potential payout: ${potentialPayout.toFixed(2)}`);

      // Update the bet with the calculated potential payout
      bet.potentialPayout = potentialPayout;
      await bet.save();
    }

    console.log(
      `Potential payouts calculated for all bets on question ${questionId}`
    );
  } catch (error) {
    console.error(
      `Error calculating potential payouts for question ${questionId}:`,
      error
    );
  }
}

const fineKill = async (CameraHolderName) => {
  try {
    console.log(`Looking up kills for player: ${CameraHolderName}`);
    let player = await playerModel
      .findOne({
        CameraHolderName,
        createdAt: { $lte: new Date() },
      })
      .sort({ createdAt: -1 })
      .select("KillsForCal");

    if (!player) {
      // Fallback to playerName if no result from CameraHolderName
      player = await playerModel
        .findOne({
          playerName: CameraHolderName,
          createdAt: { $lte: new Date() },
        })
        .sort({ createdAt: -1 })
        .select("KillsForCal");
    }

    if (!player) {
      // Both searches failed — return default
      player = { Kills: 0 };
    }

    console.log(
      `Found kill data for ${CameraHolderName}: ${player.KillsForCal} kills`
    );
    return player;
  } catch (error) {
    console.error(`Error finding kills for ${CameraHolderName}:`, error);
    throw error;
  }
};
