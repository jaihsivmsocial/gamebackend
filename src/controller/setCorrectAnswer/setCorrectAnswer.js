const Bet = require("../../model/battingModel/Bet");
const User = require("../../model/userModel");
const BetQuestion = require("../../model/battingModel/BetQuestion");
const playerModel = require("../../model/battingModel/playerModel");



exports.processOngoingBetQuestions = async (_id, subject, noOfKills) => {
  console.log("id, subject, noOfKills====", _id, subject, noOfKills);
  try {
    const question = await BetQuestion.findById(_id);

    if (!question) {
      console.log("No ongoing question found.");
      return;
    }
    let answer = await fineKill(subject);
    console.log('kill', answer[0]?.Kills, noOfKills, answer[0]?.Kills >= noOfKills);
    if (answer[0]?.Kills >= noOfKills) {
      question.correctChoice = "Yes";
        await question.save(); // <-- ADD THIS LINE
      console.log("--------from-----Yes--------------id---", question._id);
    } else {
      question.correctChoice = "No";
      console.log("--------from-----No--------------id---", question._id);
        await question.save(); // <-- ADD THIS LINE
    }


    // Update the question status to 'completed'
console.log("About to save:   1 ", question.correctChoice, );
    console.log("About to save:  2", question.correctChoice);
    console.log("BetQuestion updated to 'completed'.");
    
  } catch (error) {
    console.error("Error processing bets:", error);
  }
};

const fineKill = async (CameraHolderName) => {
  try {
    const ongoingCameraHolderName = await playerModel
      .find({
        CameraHolderName,
        createdAt: { $lte: new Date() },
      })
      .select("Kills");
    console.log(
      "ongoingCameraHolderName---------------------",
      ongoingCameraHolderName
    );
    return ongoingCameraHolderName; // <-- returning result here
  } catch (error) {
    console.error("Invalid ID or error in fineKill:", error);
    throw error; // optional: re-throw to handle outside
  }
};
