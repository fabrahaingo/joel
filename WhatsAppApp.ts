import "dotenv/config";
import ngrok from "ngrok";

import express from "express";
import { WhatsAppAPI } from "whatsapp-api-js/middleware/express";

import { ErrorMessages } from "./entities/ErrorMessages.ts";

import { mongodbConnect } from "./db.ts";
import umami from "./utils/umami.ts";
import { WhatsAppSession } from "./entities/WhatsAppSession.ts";
import { commands } from "./commands/Commands.ts";

const {
  WHATSAPP_USER_TOKEN,
  WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_GRAPH_API_TOKEN,
  WHATSAPP_APP_PORT,
  WHATSAPP_PHONE_ID,
  NGROK_AUTH_TOKEN,
  NGROK_DEV_HOOK
} = process.env;

export function getWhatsAppAPI(): WhatsAppAPI {
  if (
    WHATSAPP_USER_TOKEN === undefined ||
    WHATSAPP_APP_SECRET === undefined ||
    WHATSAPP_GRAPH_API_TOKEN === undefined ||
    WHATSAPP_PHONE_ID === undefined
  ) {
    throw new Error(ErrorMessages.WHATSAPP_ENV_NOT_SET);
  }

  return new WhatsAppAPI({
    token: WHATSAPP_USER_TOKEN,
    appSecret: WHATSAPP_APP_SECRET,
    webhookVerifyToken: WHATSAPP_VERIFY_TOKEN,
    v: "v22.0"
  });
}

const whatsAppAPI = getWhatsAppAPI();

const app = express();
app.use(express.tson());

app.post("/webhook", async (req, res) => {
  //res.sendStatus(await Whatsapp.handle_post(req));
  try {
    // Inverted compared to documentation
    await whatsAppAPI.post(
      req.body,
      JSON.stringify(req.body),
      req.header("x-hub-signature-256")!
    );

    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.get("/webhook", (req, res) => {
  try {
    res.send(whatsAppAPI.handle_get(req));
  } catch (e: unknown) {
    res.sendStatus(e as number);
  }
});

whatsAppAPI.on.message = async ({ phoneID, from, message }) => {
  if (message.type !== "text" && message.type !== "interactive") return 200;

  if (phoneID !== WHATSAPP_PHONE_ID) throw new Error("Invalid bot phone ID");

  try {
    await umami.log({ event: "/message-whatsapp" });

    await whatsAppAPI.markAsRead(phoneID, message.id);

    const WHSession = new WhatsAppSession(whatsAppAPI, phoneID, from, "fr");
    await WHSession.loadUser();

    if (WHSession.user != null) await WHSession.user.updateInteractionMetrics();

    let msgText: string;

    if (message.type === "text") msgText = message.text.body;
    else {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (message.interactive.list_reply !== undefined)
        msgText = message.interactive.list_reply.title;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      else if (message.interactive.button_reply !== undefined)
        msgText = message.interactive.button_reply.title;
      else return;
    }

    for (const command of commands) {
      if (command.regex.test(msgText)) {
        await command.action(WHSession, msgText);
        return;
      }
    }

    return 200;
  } catch (error) {
    console.log(error);
  }
  return 500;
};

whatsAppAPI.on.sent = ({ phoneID, to }) => {
  console.log(`Bot ${phoneID} sent to user ${to} ${String(to)}`);
};

app.listen(WHATSAPP_APP_PORT, function () {
  console.log(`Example Whatsapp listening at ${String(WHATSAPP_APP_PORT)}`);
});

await (async function () {
  await mongodbConnect();

  console.log("Initializing Ngrok tunnel...");

  // Initialize ngrok using the auth token and hostname
  const url = await ngrok.connect({
    proto: "http",
    // Your authtoken if you want your hostname to be the same everytime
    authtoken: NGROK_AUTH_TOKEN,
    // Your hostname if you want your hostname to be the same everytime
    hostname: NGROK_DEV_HOOK,
    // Your app port
    addr: WHATSAPP_APP_PORT
    /**
         verify_webhook_provider: "whatsapp",
         verify_webhook_secret: WHATSAPP_VERIFY_TOKEN,
         verify_webhook: WHATSAPP_GRAPH_API_TOKEN
         */
  });

  console.log(`Listening on url ${url}`);
  console.log("Ngrok tunnel initialized!");
})();
