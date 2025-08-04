// e2e/extension-src/modules/jazzService.js
import { startWorker } from "jazz-tools/worker";
import { InboxSender, Group } from "jazz-tools";
import {
  ProxyClientAccount,
  ClientAccountRoot,
  ExtensionRegistration,
  ProxyUpdatePush,
  ProxyServerAccount,
} from "../../proxy-schema.js";

// Module-level state for the Jazz connection
let jazzWorker = null;
let jazzSender = null;
let lastPushedData = null;

/**
 * Initializes the Jazz worker and connection.
 */
export async function initializeJazz() {
  console.log("[Jazz] Initializing...");

  if (jazzWorker) {
    console.log("[Jazz] Stopping previous worker...");
    jazzWorker.stop(); // <-- FIX: Properly stop the existing worker.
    jazzWorker = null;
    jazzSender = null;
  }

  try {
    const { jazzConfig } = await chrome.storage.local.get('jazzConfig');
    if (!jazzConfig || !jazzConfig.accountId || !jazzConfig.serverAccountId) {
      console.log("[Jazz] Configuration missing. Configure in extension options.");
      return;
    }

    console.log("[Jazz] Starting worker...");
    const { worker } = await startWorker({
      syncServer: jazzConfig.syncServer || "ws://127.0.0.1:4200",
      accountID: jazzConfig.accountId,
      accountSecret: jazzConfig.accountSecret,
      AccountSchema: ProxyClientAccount,
    });
    jazzWorker = worker;

    const account = await worker.ensureLoaded({ resolve: { profile: true } });

    if (!account.root) {
      console.log('[Jazz] 🔧 Client account root not found. Initializing...');
      account.root = ClientAccountRoot.create({
        lastPushTime: null,
        pushCount: 0,
      }, { owner: worker });
      await account.waitForSync();
      console.log('[Jazz] ✅ Client account root initialized.');
    }

    console.log("[Jazz] Loading sender for server account...");
    jazzSender = await InboxSender.load(jazzConfig.serverAccountId, jazzWorker);

    console.log("[Jazz] ✅ Initialized successfully");
    await registerWithServer();
    await pushProxyUpdate(true); // Force push on startup
    return { success: true };

  } catch (error) {
    console.error("[Jazz] ❌ Initialization failed:", error);
    jazzWorker = null;
    jazzSender = null;
    return { success: false, error: error.message };
  }
}

/**
 * Disconnects the Jazz worker.
 */
export async function disconnectJazz() {
    if (jazzWorker) {
        jazzWorker.stop();
        jazzWorker = null;
        jazzSender = null;
    }
    await chrome.storage.local.remove('jazzConfig');
    console.log('[Jazz] Disconnected.');
}


/**
 * Fetches V2Ray configurations directly from the server account.
 */
export async function fetchV2RayConfigs() {
    if (!jazzWorker) {
        return { error: 'Not connected to Jazz. Please configure and connect on the options page.' };
    }

    try {
        const { jazzConfig } = await chrome.storage.local.get('jazzConfig');
        if (!jazzConfig || !jazzConfig.serverAccountId) {
            return { error: 'Server Account ID is not configured.' };
        }

        console.log(`[Jazz] Loading server account: ${jazzConfig.serverAccountId}`);
        const serverAccount = await jazzWorker.load(jazzConfig.serverAccountId, ProxyServerAccount);

        await serverAccount.ensureLoaded({
            resolve: {
                root: {
                    v2rayConfigs: true,
                    stats: true
                }
            }
        });

        if (!serverAccount.root || serverAccount.root.v2rayConfigs.length === 0) {
            return { error: 'No V2Ray configuration data found on the server yet.' };
        }

        const latestV2Ray = serverAccount.root.v2rayConfigs[serverAccount.root.v2rayConfigs.length - 1];

        return {
            latestConfig: latestV2Ray ? {
                generatedAt: latestV2Ray.generatedAt,
                validProxies: latestV2Ray.validProxies,
                config: JSON.parse(latestV2Ray.configJson),
                servers: JSON.parse(latestV2Ray.serversList)
            } : null,
            totalConfigs: serverAccount.root.v2rayConfigs.length,
            stats: serverAccount.root.stats
        };

    } catch (error) {
        console.error('[Jazz] ❌ Failed to fetch V2Ray configs:', error);
        return { error: error.message };
    }
}


/**
 * Registers the extension with the server.
 */
export async function registerWithServer() {
  if (!jazzSender || !jazzWorker) return;

  try {
    const registration = ExtensionRegistration.create({
      type: 'register',
      extensionId: chrome.runtime.id,
    }, { owner: Group.create({ owner: jazzWorker }) });

    await jazzSender.sendMessage(registration);
    console.log('[Jazz] ✅ Registered with server');
  } catch (error) {
    console.error('[Jazz] ❌ Registration failed:', error);
  }
}

/**
 * Pushes proxy server data to the Jazz server.
 * @param {boolean} force - Whether to force the push even if data hasn't changed.
 */
export async function pushProxyUpdate(force = false) {
  if (!jazzSender || !jazzWorker) {
    console.warn("[Jazz] Not ready to send proxy update.");
    return;
  }

  try {
    const data = await chrome.storage.sync.get('_servers_list');
    const servers = data._servers_list;

    if (!servers || Object.keys(servers).length === 0) {
      console.log("[Jazz] No proxy data to push.");
      return;
    }

    const serversJson = JSON.stringify(servers);
    if (!force && serversJson === lastPushedData) {
      return; // No change
    }

    console.log(`[Jazz] Pushing ${Object.keys(servers).length} proxies...`);

    const freshServers = Object.fromEntries(
      Object.entries(servers).map(([key, server]) => [
        key,
        { ...server, receivedTime: Date.now(), ttl: server.ttl || 30 },
      ])
    );

    const message = ProxyUpdatePush.create({
      type: 'push',
      servers: JSON.stringify(freshServers),
      timestamp: new Date().toISOString(),
      extensionId: chrome.runtime.id
    }, { owner: Group.create({ owner: jazzWorker }) });

    await jazzSender.sendMessage(message);
    lastPushedData = serversJson;

    const account = await jazzWorker.ensureLoaded({ resolve: { root: true } });
    if (account.root) {
      account.root.lastPushTime = new Date().toISOString();
      account.root.pushCount = (account.root.pushCount || 0) + 1;
      await account.root.waitForSync();
    }

    console.log('[Jazz] ✅ Push successful');
  } catch (error) {
    console.error('[Jazz] ❌ Push failed:', error);
  }
}

/**
 * Returns the current status of the Jazz connection.
 */
export function getJazzStatus() {
    return {
        connected: !!jazzSender,
        accountId: jazzWorker?.id || null,
    };
}
