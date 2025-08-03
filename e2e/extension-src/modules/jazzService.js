// e2e/extension-src/modules/jazzService.js
import { startWorker } from "jazz-tools/worker";
import { InboxSender, Group } from "jazz-tools";
import {
  ProxyClientAccount,
  ClientAccountRoot,
  ExtensionRegistration,
  ProxyUpdatePush,
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

  } catch (error) {
    console.error("[Jazz] ❌ Initialization failed:", error);
    // Reset state on failure
    jazzWorker = null;
    jazzSender = null;
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
