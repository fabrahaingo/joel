import "dotenv/config";
import { MatrixAuth } from "matrix-bot-sdk";

const MATRIX_HOME_URL = process.env.MATRIX_HOME_URL;
if (MATRIX_HOME_URL == undefined) throw new Error("MATRIX_HOME_URL is not set");

// This will be the URL where clients can reach your homeserver. Note that this might be different
// from where the web/chat interface is hosted. The server must support password registration without
// captcha or terms of service (public servers typically won't work).
const homeserverUrl = "https://" + MATRIX_HOME_URL;

const auth = new MatrixAuth(homeserverUrl);
const client = await auth.passwordRegister("username", "password");

console.log(
  "Copy this access token to your bot's config: ",
  client.accessToken
);
