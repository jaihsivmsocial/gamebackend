const cron = require('node-cron');

const BetQuestion = require("../../model/battingModel/BetQuestion");
const Bet = require("../../model/battingModel/Bet");
const User = require("../../model/userModel");



async function processOngoingBetQuestions() {
  try {
    const ongoingQuestions = await BetQuestion.find({ status: "ongoing" });

    if (!ongoingQuestions.length) {
      console.log("No ongoing questions to process.");
      return;
    }

    const userRewardsMap = new Map(); // userId => rewardAmount
    const processedQuestionIds = [];

    for (const question of ongoingQuestions) {
      const { _id: questionId, totalBetAmount, correctChoice } = question;

      if (!correctChoice) {
        console.log(`Skipping question ${questionId} — no correctChoice set.`);
        continue;
      }

      const platformFee = totalBetAmount * 0.05;
      const distributablePool = totalBetAmount - platformFee;

      const winningBets = await Bet.find({
        question: questionId,
        choice: correctChoice,
      });

      const totalWinningAmount = winningBets.reduce((sum, bet) => sum + bet.amount, 0);
      if (totalWinningAmount === 0) {
        console.log(`No winning bets for question ${questionId}`);
        processedQuestionIds.push(questionId); // Still mark it completed
        continue;
      }

      for (const bet of winningBets) {
        const contributionPercent = bet.amount / totalWinningAmount;
        const reward = Math.floor(distributablePool * contributionPercent);

        const userId = bet.user.toString();
        userRewardsMap.set(userId, (userRewardsMap.get(userId) || 0) + reward);
      }

      processedQuestionIds.push(questionId);
    }

    // Bulk update users
    if (userRewardsMap.size > 0) {
      const bulkUserOps = Array.from(userRewardsMap.entries()).map(([userId, rewardAmount]) => ({
        updateOne: {
          filter: { _id: userId },
          update: {
            $inc: {
              totalWins: rewardAmount,
              walletBalance: rewardAmount,
              biggestWin: rewardAmount, // You may want to customize this to keep max value
            },
          },
        },
      }));

      await User.bulkWrite(bulkUserOps);
      console.log("User rewards updated successfully.");
    }

    // Bulk update BetQuestions to 'completed'
    if (processedQuestionIds.length > 0) {
      const bulkQuestionOps = processedQuestionIds.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { status: "completed" } },
        },
      }));

      await BetQuestion.bulkWrite(bulkQuestionOps);
      console.log("BetQuestions updated to 'completed'.");
    }
  } catch (error) {
    console.error("Error processing bets:", error);
  }
}

// Schedule the cron job to run every 10 minutes
// cron.schedule('*/10 * * * *', () => {
//   myFunction();
// });

 // Run every 1 minute
cron.schedule('* * * * *', () => {
processOngoingBetQuestions()
});
