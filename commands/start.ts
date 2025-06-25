import { ISession } from "../types";

export const startCommand = async (session: ISession, _msg: never): Promise<void> => {
  await session.log({ event: "/start" });
  try {
    await session.sendTypingAction()
    if (session.user != null && session.user.status === "blocked") {
      session.user.status = "active";
      await session.user.save();
    }

    const botName = process.env.BOT_NAME;
    const botChannel = process.env.BOT_CHANNEL;

    const text = `\n\u{1F41D} ${botName} vous permet de *consulter et suivre les évolutions de postes* de vos collègues et connaissances au sein de l'administration française.
		\nPour rester au courant des *nouveautés*, des *corrections* de bugs ainsi que des *améliorations* de JOEL, rejoignez notre channel officiel [@${botChannel}](https://t.me/${botChannel})`;

    await session.sendMessage(text, true);
  } catch (error) {
    console.log(error);
  }
};
