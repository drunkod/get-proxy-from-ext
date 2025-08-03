// e2e/server-modules/inboxHandler.js
import { co } from "jazz-tools";
import {
    ServerBoundMessage,
    ProxyConfig,
    parseServers,
    getValidServers,
    calculateExpiration,
    needsUpdate
} from "../proxy-schema.js";
import { generateV2RayConfiguration } from "./v2ray.js";

// ... (setupInboxListener remains the same) ...
export function setupInboxListener(inbox, worker, account) {
  inbox.subscribe(ServerBoundMessage, async (message, senderID) => {
    console.log(`\n📥 Received '${message.type}' from: ${senderID}`);

    try {
      if (message.type === 'register') {
        await handleRegistration(message, senderID, account);
      } else if (message.type === 'push') {
        await handleProxyPush(message, worker, account);
      }
    } catch (error) {
      console.error(`❌ Error handling message:`, error);
    }
  });
}


async function handleRegistration(message, senderID, account) {
  console.log(`   Extension registered: ${message.extensionId}`);
  
  // FIX: Parse the JSON string before updating
  const connections = JSON.parse(account.root.connectedExtensions || "{}");
  
  // Add new connection
  connections[message.extensionId] = senderID;
  
  // FIX: Save back as a JSON string
  account.root.connectedExtensions = JSON.stringify(connections);
  await account.root.waitForSync();
}

// ... (handleProxyPush remains the same) ...
async function handleProxyPush(message, worker, account) {
  console.log(`   Proxy update from: ${message.extensionId}`);
  const servers = parseServers(message.servers);
  console.log(`   Servers: ${Object.keys(servers).join(', ')}`);

  const config = ProxyConfig.create({
    servers: message.servers,
    timestamp: message.timestamp,
    expiresAt: calculateExpiration(servers),
    extensionId: message.extensionId,
    validServersCount: Object.keys(getValidServers(servers)).length,
    totalServersCount: Object.keys(servers).length,
  }, { owner: worker });

  account.root.configs.push(config);
  account.root.latestConfig = config;

  if (account.root.stats) {
    account.root.stats.totalUpdates = (account.root.stats.totalUpdates || 0) + 1;
    account.root.stats.lastUpdateTime = message.timestamp;
    account.root.stats.totalProxiesEverSeen = (account.root.stats.totalProxiesEverSeen || 0) + Object.keys(servers).length;
  }

  await account.root.waitForSync();
  console.log(`   ✅ Saved ${Object.keys(servers).length} servers`);

  if (needsUpdate(account.root.latestConfig)) {
    console.log("   🔧 Generating V2Ray config...");
    await generateV2RayConfiguration(worker, account);
  }
}