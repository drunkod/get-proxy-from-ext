// tests/test-client.js
// Simulates extension client for testing
import { startWorker } from "jazz-tools/worker";
import { InboxSender } from "jazz-tools";
import { WebSocket } from "ws";

global.WebSocket = WebSocket;

async function runTestClient() {
  console.log("🧪 Test Client: Starting...");

  const { worker } = await startWorker({
    syncServer: process.env.JAZZ_SYNC_URL,
    accountID: process.env.JAZZ_PROXY_CLIENT_ACCOUNT,
    accountSecret: process.env.JAZZ_PROXY_CLIENT_SECRET,
  });

  const sender = await InboxSender.load(
    process.env.JAZZ_PROXY_SERVER_ACCOUNT,
    worker
  );

  // Send test proxy data
  const testProxies = {
    "test-us": {
      host: "us.test-proxy.local",
      port: 3128,
      name: "Test US Proxy",
      ttl: 30,
      receivedTime: Date.now()
    },
    "test-uk": {
      host: "uk.test-proxy.local",
      port: 3128,
      name: "Test UK Proxy",
      ttl: -1,
      receivedTime: Date.now()
    }
  };

  console.log("📤 Sending test proxy data...");

  await sender.sendMessage({
    type: "push",
    servers: JSON.stringify(testProxies),
    timestamp: new Date().toISOString(),
    extensionId: "test-extension"
  });

  console.log("✅ Test data sent successfully");
  process.exit(0);
}

runTestClient().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
