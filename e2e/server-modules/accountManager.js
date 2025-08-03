// e2e/server-modules/accountManager.js
import { startWorker } from "jazz-tools/worker";
import { WebSocket } from "ws";
import { co } from "jazz-tools";
import {
  ProxyServerAccount,
  ServerAccountRoot,
  ProxyConfig,
  V2RayConfig,
  StatsSchema,
} from "../proxy-schema.js";

global.WebSocket = WebSocket;

// A simple helper to wait for a specified time
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function initializeServerAccount() {
  const maxRetries = 15;
  const retryDelay = 2000; // 2 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { worker, experimental: { inbox } } = await startWorker({
        syncServer: process.env.JAZZ_SYNC_URL || "ws://127.0.0.1:4200",
        accountID: process.env.JAZZ_PROXY_SERVER_ACCOUNT,
        accountSecret: process.env.JAZZ_PROXY_SERVER_SECRET,
        AccountSchema: ProxyServerAccount,
      });

      const account = await worker.ensureLoaded({ resolve: { profile: true } });

      if (!account.root) {
        console.log("🔧 Root not found. Initializing new account root...");
        account.root = ServerAccountRoot.create({
          configs: co.list(ProxyConfig).create([], { owner: worker }),
          v2rayConfigs: co.list(V2RayConfig).create([], { owner: worker }),
          stats: StatsSchema.create({ totalUpdates: 0, totalProxiesEverSeen: 0 }, { owner: worker }),
          // You can now omit the optional 'connectedExtensions' field
          // It will correctly be initialized as 'undefined
        }, { owner: worker });
        await account.waitForSync();
        console.log("✅ New account root initialized.");
      }

      await account.root.ensureLoaded({
        resolve: {
          configs: true,
          v2rayConfigs: true,
          stats: true,
          connectedExtensions: true,
          latestConfig: true,
        }
      });

      if (!account.root.connectedExtensions) {
        // FIX: Ensure it's initialized as an empty JSON string if missing
        account.root.connectedExtensions = "{}";
        await account.root.waitForSync();
      }

      const profileGroup = account.profile._owner;
      if (profileGroup.getRoleOf("everyone") !== "reader") {
        profileGroup.addMember("everyone", "reader");
        await profileGroup.waitForSync();
      }

      console.log(`✅ Server connected to sync service on attempt ${attempt}.`);
      console.log(`   Account ID: ${worker.id}`);
      console.log(`   Total configs: ${account.root.configs?.length || 0}`);
      // FIX: Parse the string to get the count
      const connections = JSON.parse(account.root.connectedExtensions || "{}");
      console.log(`   Connected extensions: ${Object.keys(connections).length}`);

      return { worker, account, inbox };

    } catch (error) {
      if (error.message.includes('ECONNREFUSED')) {
        console.warn(`[Attempt ${attempt}/${maxRetries}] 🔌 Sync server not ready. Retrying in ${retryDelay / 1000}s...`);
        await sleep(retryDelay);
      } else {
        console.error("❌ Failed to initialize server account due to a non-connection error:", error);
        throw error;
      }
    }
  }

  throw new Error(`❌ Could not connect to the sync server after ${maxRetries} attempts.`);
}