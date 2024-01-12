const Users = require("../models/User.js");
const People = require("../models/People.js");
const { startKeyboard } = require("../utils/keyboards");

module.exports = (bot) => async (msg) => {
  try {
    if (!msg.reply_to_message) {
      const usersCount = await Users.countDocuments();
      const peopleCount = await People.countDocuments();

      await bot.sendMessage(
        msg.chat.id,
        `📈 JOEL aujourd’hui c’est\n👨‍💻 ${usersCount} utilisateurs\n🕵️ ${peopleCount} personnes suivies\n\nJOEL sait combien vous êtes à l'utiliser mais il ne sait pas qui vous êtes... et il ne cherchera jamais à le savoir! 🛡`,
        startKeyboard
      );
    }
  } catch (error) {
    console.log(error);
  }
};
