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

    const userRewardsMap = new Map(); // userId => totalPotentialPayout
    const processedQuestionIds = [];

    for (const question of ongoingQuestions) {
      const { _id: questionId, correctChoice } = question;

      if (!correctChoice) {
        console.log(`Skipping question ${questionId} — no correctChoice set.`);
        continue;
      }

      const winningBets = await Bet.find({
        question: questionId,
        choice: correctChoice,
      });

      if (!winningBets.length) {
        console.log(`No winning bets for question ${questionId}`);
        processedQuestionIds.push(questionId);
        continue;
      }

      for (const bet of winningBets) {
        const userId = bet.user.toString();
        const reward = bet.potentialPayout || 0;

        userRewardsMap.set(userId, (userRewardsMap.get(userId) || 0) + reward);
      }

      processedQuestionIds.push(questionId);
    }

    // Bulk update users' wallet balances and totalWins
    if (userRewardsMap.size > 0) {
      const bulkUserOps = Array.from(userRewardsMap.entries()).map(([userId, rewardAmount]) => ({
        updateOne: {
          filter: { _id: userId },
          update: {
            $inc: {
              totalWins: rewardAmount,
              walletBalance: rewardAmount,
              biggestWin: rewardAmount,
            },
          },
        },
      }));

      await User.bulkWrite(bulkUserOps);
      console.log("User rewards updated successfully.");
    }

    // Mark questions as completed
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


 cron.schedule('* * * * *', () => {
processOngoingBetQuestions()
});
