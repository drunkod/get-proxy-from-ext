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

// Accept rootGroup as an argument
export function setupInboxListener(inbox, worker, account, rootGroup) {
  inbox.subscribe(ServerBoundMessage, async (message, senderID) => {
    console.log(`\n📥 Received '${message.type}' from: ${senderID}`);

    try {
      if (message.type === 'register') {
        await handleRegistration(message, senderID, account);
      } else if (message.type === 'push') {
        // Pass rootGroup to the handler
        await handleProxyPush(message, worker, account, rootGroup);
      }
    } catch (error) {
      console.error(`❌ Error handling message:`, error);
    }
  });
}

async function handleRegistration(message, senderID, account) {
  console.log(`   Extension registered: ${message.extensionId}`);
  
  // FIX: Parse the JSON string before updating
  let connections;
  try {
    connections = JSON.parse(account.root.connectedExtensions || "{}");
  } catch (e) {
    console.warn("Could not parse connectedExtensions, resetting to empty object.");
    connections = {};
  }
  
  // Add new connection
  connections[message.extensionId] = senderID;
  
  // FIX: Save back as a JSON string
  account.root.connectedExtensions = JSON.stringify(connections);
  await account.root.waitForSync();
  console.log(`   Updated connections: ${account.root.connectedExtensions}`);
}

// Accept rootGroup here as well
async function handleProxyPush(message, worker, account, rootGroup) {
  console.log(`   Proxy update from: ${message.extensionId}`);
  const servers = parseServers(message.servers);
  console.log(`   Servers: ${Object.keys(servers).length}`);

  // CRITICAL FIX: Create the new ProxyConfig with the public rootGroup as the owner.
  const config = ProxyConfig.create({
    servers: message.servers,
    timestamp: message.timestamp,
    expiresAt: calculateExpiration(servers),
    extensionId: message.extensionId,
    validServersCount: Object.keys(getValidServers(servers)).length,
    totalServersCount: Object.keys(servers).length,
  }, { owner: rootGroup }); // <-- USE THE PUBLIC GROUP

  account.root.configs.push(config);
  account.root.latestConfig = config;

  if (account.root.stats) {
    account.root.stats.totalUpdates = (account.root.stats.totalUpdates || 0) + 1;
    account.root.stats.lastUpdateTime = message.timestamp;
    account.root.stats.totalProxiesEverSeen = (account.root.stats.totalProxiesEverSeen || 0) + Object.keys(servers).length;
  }

  await account.root.waitForSync();
  console.log(`   ✅ Saved ${Object.keys(servers).length} servers`);

  // Generate V2Ray config on every push or if no configs exist
  const shouldGenerateV2Ray = 
    !account.root.v2rayConfigs || account.root.v2rayConfigs.length === 0 || // No configs yet
    needsUpdate(account.root.latestConfig); // Expired servers

  if (shouldGenerateV2Ray) {
    console.log("   🔧 Generating V2Ray config...");
    // Pass rootGroup to the V2Ray generator
    await generateV2RayConfiguration(worker, account, rootGroup);
  }
}