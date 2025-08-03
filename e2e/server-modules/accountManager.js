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

/**
 * Initializes and returns the Jazz server account worker.
 * It will retry connecting to the sync server if it's not immediately available.
 * @returns {Promise<{worker: object, account: object, inbox: object}>}
 */
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
          connectedExtensions: co.map({}).create({}, { owner: worker }),
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
        account.root.connectedExtensions = co.map({}).create({}, { owner: worker });
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
      console.log(`   Connected extensions: ${account.root.connectedExtensions?.size || 0}`);

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
