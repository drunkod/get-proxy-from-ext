// e2e/extension-src/background.js
import { startWorker } from "jazz-tools/worker";
import { InboxSender } from "jazz-tools";
import {
  ProxyClientAccount,
  ClientAccountRoot,
  ExtensionRegistration,
  ProxyUpdatePush,
} from "../proxy-schema.js";

let jazzWorker = null;
let jazzSender = null;
let lastPushedData = null;

async function initializeJazz() {
  console.log("[Jazz] Initializing...");

  // Stop previous worker if exists
  if (jazzWorker) {
    console.log("[Jazz] Stopping previous worker...");
    // Note: jazz-tools might not have a stop method, just let it be garbage collected
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

    // Initialize account root if needed
    const account = await worker.ensureLoaded({
      resolve: { profile: true, root: true }
    });

    if (!account.root) {
      account.root = ClientAccountRoot.create({
        lastPushTime: null,
        pushCount: 0,
      }, { owner: worker });
      await account.waitForSync();
    }

    console.log("[Jazz] Loading sender for server account...");
    jazzSender = await InboxSender.load(jazzConfig.serverAccountId, jazzWorker);

    console.log("[Jazz] ✅ Initialized successfully");
    await registerWithServer();
    await pushProxyUpdate(true); // Force push on startup

  } catch (error) {
    console.error("[Jazz] ❌ Initialization failed:", error);
  }
}

async function registerWithServer() {
  if (!jazzSender) return;

  try {
    const registration = ExtensionRegistration.create({
      type: 'register',
      extensionId: chrome.runtime.id,
    }, { owner: jazzWorker });

    await jazzSender.sendMessage(registration);
    console.log('[Jazz] ✅ Registered with server');
  } catch (error) {
    console.error('[Jazz] ❌ Registration failed:', error);
  }
}

async function pushProxyUpdate(force = false) {
  if (!jazzSender || !jazzWorker) {
    console.warn("[Jazz] Not ready to send");
    return;
  }

  try {
    const data = await chrome.storage.sync.get('_servers_list');
    const servers = data._servers_list;

    if (!servers || Object.keys(servers).length === 0) {
      console.log("[Jazz] No proxy data to push");
      return;
    }

    const serversJson = JSON.stringify(servers);
    if (!force && serversJson === lastPushedData) {
      return; // No change
    }

    console.log(`[Jazz] Pushing ${Object.keys(servers).length} proxies...`);

    // Add fresh timestamps
    const freshServers = {};
    for (const [key, server] of Object.entries(servers)) {
      freshServers[key] = {
        ...server,
        receivedTime: Date.now(),
        ttl: server.ttl || 30,
      };
    }

    const message = ProxyUpdatePush.create({
      type: 'push',
      servers: JSON.stringify(freshServers),
      timestamp: new Date().toISOString(),
      extensionId: chrome.runtime.id
    }, { owner: jazzWorker });

    await jazzSender.sendMessage(message);
    lastPushedData = serversJson;

    // Update client stats
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

// Chrome event listeners
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Extension] Installed/Updated");
  initializeJazz();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[Extension] Browser startup");
  initializeJazz();
});

// Watch for proxy changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes._servers_list && namespace === 'sync') {
    console.log("[Extension] Proxy data changed");
    pushProxyUpdate();
  }
});

// Handle messages from options page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CONFIGURE_JAZZ') {
    chrome.storage.local.set({ jazzConfig: request.config }, async () => {
      await initializeJazz();
      sendResponse({ success: true });
    });
    return true; // async response
  }

  if (request.type === 'GET_JAZZ_STATUS') {
    sendResponse({
      connected: !!jazzSender,
      accountId: jazzWorker?.id || null
    });
  }

  if (request.type === 'FORCE_PUSH') {
    pushProxyUpdate(true).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Initialize on load
initializeJazz();
