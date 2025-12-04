import "dotenv/config";
import { SignalCli } from "signal-sdk";

const {
  SIGNAL_PHONE_NUMBER,
  SIGNAL_BAT_PATH,
  TEST_TARGET_PHONE_NUMBER,
  SIGNAL_DEVICE_NAME
} = process.env;

async function connectDevice() {
  if (SIGNAL_PHONE_NUMBER === undefined) {
    throw new Error("SIGNAL_PHONE_NUMBER env variable not set");
  }
  if (SIGNAL_BAT_PATH === undefined) {
    throw new Error("SIGNAL_BAT_PATH env variable not set");
  }
  if (TEST_TARGET_PHONE_NUMBER === undefined) {
    throw new Error("TEST_TARGET_PHONE_NUMBER env variable not set");
  }
  if (SIGNAL_DEVICE_NAME === undefined) {
    throw new Error("SIGNAL_DEVICE_NAME env variable not set");
  }

  console.log("Signal SDK - Device Connection");
  console.log("==================================\n");

  console.log(`Device name: ${SIGNAL_DEVICE_NAME}`);
  console.log("Generating QR code for device linking...\n");

  // Initialize the SDK without an account (for linking)
  const signalCli = new SignalCli(SIGNAL_BAT_PATH, SIGNAL_PHONE_NUMBER);

  try {
    // Start device linking with QR code output to console
    const linkingResult = await signalCli.deviceLink({
      name: SIGNAL_DEVICE_NAME,
      qrCodeOutput: "console"
    });

    if (linkingResult.success) {
      if (linkingResult.isLinked) {
        console.log("Device successfully linked!");
        console.log(`Device name: ${linkingResult.deviceName ?? "NO_NAME"}`);
        console.log(
          "\nYou can now use this device to send and receive Signal messages."
        );
        console.log("\nNext steps:");
        console.log("   1. Import SignalCli in your Node.js project");
        console.log("   2. Initialize with your phone number");
        console.log("   3. Start sending and receiving messages");
        console.log("\nExample usage:");
        console.log('   const { SignalCli } = require("signal-sdk");');
        console.log('   const signalCli = new SignalCli("+YourPhoneNumber");');
        console.log("   await signalCli.connect();");
      } else {
        console.log("QR code generated successfully!");
        console.log(
          "Scan the QR code above with your Signal app to link this device."
        );
        console.log("\nInstructions:");
        console.log("   1. Open Signal on your phone");
        console.log("   2. Go to Settings > Linked devices");
        console.log('   3. Tap "Link new device"');
        console.log("   4. Scan the QR code displayed above");
        console.log("\nWaiting for device linking...");
        console.log("   (This process may take a few moments)");
      }
    } else {
      console.error("Device linking failed");
      if (linkingResult.error) {
        console.error(`   Error: ${linkingResult.error}`);
      }
      console.error("\nTroubleshooting:");
      console.error("   • Make sure signal-cli is properly installed");
      console.error("   • Check your internet connection");
      console.error("   • Ensure your Signal app is up to date");
      console.error("   • Try running the command again");
      process.exit(1);
    }
  } catch (error) {
    console.error("Fatal error during device linking:", error);
    console.error("\nCommon solutions:");
    console.error(
      "   • Install signal-cli: https://github.com/AsamK/signal-cli"
    );
    console.error("   • Make sure Java is installed and accessible");
    console.error("   • Check that signal-cli is in your PATH");
    console.error("   • Verify your internet connection");
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\nDevice linking cancelled by user.");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n\nDevice linking terminated.");
  process.exit(0);
});

// Display help if requested
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Signal SDK - Device Connection Script");
  console.log("=====================================\n");
  console.log("Usage:");
  console.log("  node scripts/connect.js [device-name]");
  console.log("  npx signal-sdk connect [device-name]\n");
  console.log("Arguments:");
  console.log(
    '  device-name    Optional name for the linked device (default: "Signal SDK Device")\n'
  );
  console.log("Examples:");
  console.log("  node scripts/connect.js");
  console.log('  node scripts/connect.js "My Bot Device"');
  console.log("  npx signal-sdk connect");
  console.log('  npx signal-sdk connect "My Custom Device"\n');
  console.log(
    "This script generates a QR code that you can scan with your Signal app"
  );
  console.log("to link a new device for use with the Signal SDK.");
  process.exit(0);
}

// Run the connection process
await connectDevice();
