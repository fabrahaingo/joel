import "dotenv/config";
import { runHealthcheck } from "../utils/healthProbe.ts";

const { exitCode, lines } = await runHealthcheck(
  process.argv.slice(2),
  process.env
);

for (const line of lines) console.log(`Healthcheck: ${line}`);
process.exit(exitCode);
