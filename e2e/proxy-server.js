// e2e/proxy-server.js
import { co } from "jazz-tools";
import { initializeServerAccount } from "./server-modules/accountManager.js";
import { setupInboxListener } from "./server-modules/inboxHandler.js";
import { generateProxySummary, ProxyConfig } from "./proxy-schema.js";

async function main() {
  console.log("🎷 Starting Simplified Jazz Proxy Server...");

  // Capture the rootGroup from the initialization
  const { worker, account, inbox, rootGroup } = await initializeServerAccount();

  // Pass the rootGroup to the inbox listener setup
  setupInboxListener(inbox, worker, account, rootGroup);

  // Periodic tasks for monitoring and cleanup
  setInterval(async () => {
    console.log('\n📊 Server Status:');
    try {
      // FIX: Parse the string to get the count
      const connections = JSON.parse(account.root.connectedExtensions || "{}");
      console.log(`   Connected extensions: ${Object.keys(connections).length}`);
    } catch (e) {
      console.warn("Could not parse connected extensions for status check.");
      console.log(`   Connected extensions: (error parsing)`);
    }

    if (account.root.latestConfig) {
      const summary = generateProxySummary(account.root.latestConfig.servers);
      console.log(`   Current proxies: ${summary.valid} valid, ${summary.expired} expired`);
      console.log(`   Total updates: ${account.root.stats?.totalUpdates || 0}`);
    }

    // Cleanup old configs
    if (account.root.configs.length > 20) {
      console.log("   🧹 Cleaning up old configs...");
      // Ensure even cleaned-up lists are owned by the worker to avoid permission issues on list replacement
      const toKeep = account.root.configs.slice(-20);
      account.root.configs = co.list(ProxyConfig).create(toKeep, { owner: rootGroup });
      await account.root.configs.waitForSync();
    }
  }, 60000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log("\n⏹️  Shutting down server...");
    // Potentially add cleanup logic here
    await new Promise(resolve => setTimeout(resolve, 500));
    process.exit(0);
  });
}

main().catch(console.error);