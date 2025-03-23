import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { CommandType, IUser } from "./types";
import { mongodbConnect } from "./db";
import User from "./models/User";
import umami from "./utils/umami";

const bot: TelegramBot = new TelegramBot(process.env.BOT_TOKEN || "", {
  polling: true,
  onlyFirstMatch: true,
});

const commands: CommandType = [
  {
    regex: /\/start$/,
    action: require("./commands/start"),
  },
  {
    regex: /🔎 Rechercher$/,
    action: require("./commands/search"),
  },
  {
    regex: /🧩 Ajouter un contact$/,
    action: require("./commands/follow"),
  },
  {
    regex: /✋ Retirer un suivi$/,
    action: require("./commands/unfollow"),
  },
  {
    regex: /🧐 Lister mes suivis$/,
    action: require("./commands/list"),
  },
  {
    regex: /❓ Aide/,
    action: require("./commands/help"),
  },
  {
    regex: /👨‍💼 Ajouter une fonction/,
    action: require("./commands/followFunction"),
  },
  {
    regex: /\/secret|\/ena|\/ENA|\/insp|\/INSP/,
    action: require("./commands/ena"),
  },
  {
    regex: /\/stats/,
    action: require("./commands/stats"),
  },
  {
    regex: /.*/,
    action: require("./commands/default"),
  },
];

(async () => {
  await mongodbConnect();

  commands.forEach((command) => {
    bot.onText(command.regex,
        async (msg: TelegramBot.Message) => {
          // Check if user is defined
          const tgUser: TelegramBot.User | undefined = msg.from;
          if (tgUser === undefined) return

          // Fetch user from db
          const user: IUser | null = await User.findOne({ chatId: msg.chat.id });

          if (user !== null) {
            // Update time of last interaction if before the current day
            const currentDate = (new Date());
            currentDate.setHours(0, 12, 0, 0); // Prevents updating the user for each message
            if (user.last_interaction.getTime() < currentDate.getTime()) {
              user.last_interaction = currentDate;
              await user.save();
              await umami.log({event: "/user-active-day"});
            }
          }

          // Process user message
          command.action(bot)(msg)
        })
        ;
  });

  console.log(`\u{2705} JOEL started successfully`);
})();
