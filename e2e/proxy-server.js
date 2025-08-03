// e2e/proxy-server.js
import { co } from "jazz-tools";
import { initializeServerAccount } from "./server-modules/accountManager.js";
import { setupInboxListener } from "./server-modules/inboxHandler.js";
import { generateProxySummary, ProxyConfig } from "./proxy-schema.js";

async function main() {
  console.log("🎷 Starting Simplified Jazz Proxy Server...");

  const { worker, account, inbox } = await initializeServerAccount();

  setupInboxListener(inbox, worker, account);

  // Periodic tasks for monitoring and cleanup
  setInterval(async () => {
    console.log('\n📊 Server Status:');
    console.log(`   Connected extensions: ${account.root.connectedExtensions?.size || 0}`);

    if (account.root.latestConfig) {
      const summary = generateProxySummary(account.root.latestConfig.servers);
      console.log(`   Current proxies: ${summary.valid} valid, ${summary.expired} expired`);
      console.log(`   Total updates: ${account.root.stats?.totalUpdates || 0}`);
    }

    // Cleanup old configs
    if (account.root.configs.length > 20) {
      console.log("   🧹 Cleaning up old configs...");
      const toKeep = account.root.configs.slice(-20);
      account.root.configs = co.list(ProxyConfig).create(toKeep, { owner: worker });
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
