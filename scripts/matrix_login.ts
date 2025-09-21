import { MatrixAuth } from "matrix-bot-sdk";

const { MATRIX_HOME_URL, MATRIX_BOT_USERNAME, MATRIX_BOT_PASSWORD } =
  process.env;
if (
  MATRIX_HOME_URL == undefined ||
  MATRIX_BOT_USERNAME == undefined ||
  MATRIX_BOT_PASSWORD == undefined
)
  throw new Error("MATRIX env is not set");

// This will be the URL where clients can reach your homeserver. Note that this might be different
// from where the web/chat interface is hosted. The server must support password registration without
// captcha or terms of service (public servers typically won't work).
const homeserverUrl = "https://" + MATRIX_HOME_URL;

const auth = new MatrixAuth(homeserverUrl);
const client = await auth.passwordLogin(
  MATRIX_BOT_USERNAME,
  MATRIX_BOT_PASSWORD
);

console.log(
  "Copy this access token to your bot's config: ",
  client.accessToken
);
