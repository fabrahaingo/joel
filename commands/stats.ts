import Users from "../models/User.ts";
import People from "../models/People.ts";
import Organisation from "../models/Organisation.ts";
import { ISession } from "../types.ts";

export const statsCommand = async (session: ISession): Promise<void> => {
  try {
    await session.log({ event: "/stats" });

    const usersCount = await Users.countDocuments();
    const signalCount = await Users.countDocuments({ messageApp: "Signal" });
    const WHCount = await Users.countDocuments({ messageApp: "WhatsApp" });
    const telegramCount = await Users.countDocuments({
      messageApp: "Telegram"
    });

    const peopleCount = await People.countDocuments();
    const orgCount = await Organisation.countDocuments();

    const followApps = [
      { app: "WhatsApp", count: WHCount },
      { app: "Signal", count: signalCount },
      { app: "Telegram", count: telegramCount }
    ].sort((a, b) => b.count - a.count);

    let msg = `📈 JOEL aujourd'hui c'est\n👨‍💻 ${String(usersCount)} utilisateurs\n`;

    for (const app of followApps)
      if (app.count > 0) msg += ` - ${String(app.count)} sur ${app.app}\n`;

    if (peopleCount > 0) msg += `🕵️ ${String(peopleCount)} personnes suivies\n`;

    if (orgCount > 0) msg += `🏛️ ${String(orgCount)} organisations suivies\n\n`;

    msg += `JOEL sait combien vous êtes à l'utiliser mais il ne sait pas qui vous êtes... et il ne cherchera jamais à le savoir! 🛡`;

    await session.sendMessage(msg, { separateMenuMessage: true });
  } catch (error) {
    console.log(error);
  }
};
