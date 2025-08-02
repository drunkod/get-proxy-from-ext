// e2e/proxy-server.js
import { startWorker } from "jazz-tools/worker";
import { WebSocket } from "ws";
import { co, Group } from "jazz-tools";
import { 
  ProxyServerAccount,
  ProxyClientAccount,
  ProxyMessage,
  ProxyDataResponse,
  ProxyStatusResponse,
  ProxyListResponse,
  ProxyConfig,
  V2RayConfig,
  StatsSchema,
  calculateExpiration,
  getValidServers,
  parseServers,
  needsUpdate,
  generateProxySummary
} from "./proxy-schema.js";

global.WebSocket = WebSocket;

async function initializeServerAccount(worker) {
  const account = await worker.ensureLoaded({ 
    resolve: { 
      profile: true,
      root: true
    } 
  });
  
  // Initialize root if it doesn't exist
  if (!account.root) {
    console.log("🔧 Initializing account root...");
    account.root = ServerAccountRoot.create({
      configs: co.list(ProxyConfig).create([], { owner: worker }),
      v2rayConfigs: co.list(V2RayConfig).create([], { owner: worker }),
      stats: StatsSchema.create({
        totalUpdates: 0,
        totalProxiesEverSeen: 0,
      }, { owner: worker }),
    }, { owner: worker });
    
    await account.waitForSync();
    console.log("✅ Account root initialized");
  }
  
  // Ensure all fields exist
  if (!account.root.configs) {
    account.root.configs = co.list(ProxyConfig).create([], { owner: worker });
  }
  if (!account.root.v2rayConfigs) {
    account.root.v2rayConfigs = co.list(V2RayConfig).create([], { owner: worker });
  }
  if (!account.root.stats) {
    account.root.stats = StatsSchema.create({
      totalUpdates: 0,
      totalProxiesEverSeen: 0,
    }, { owner: worker });
  }
  
  return account;
}

// Handle proxy data updates
async function handleProxyData(message, senderID, worker) {
  const { servers: serversJson, timestamp, extensionId } = message;
  console.log(`📥 Received proxy data from: ${senderID}`);
  
  // Parse servers from JSON string
  const servers = parseServers(serversJson);
  console.log(`   Servers: ${Object.keys(servers).join(', ')}`);
  
  const senderAccount = await ProxyClientAccount.load(senderID, { loadAs: worker });
  if (!senderAccount) {
    throw new Error(`Could not load sender account: ${senderID}`);
  }

  // Load account data
  const account = await worker.ensureLoaded({ 
    resolve: { 
      root: { 
        configs: true, 
        stats: true 
      } 
    } 
  });

  // Calculate expiration based on TTL
  const expiresAt = calculateExpiration(servers);
  const validServers = getValidServers(servers);
  
  // Create and save proxy config
  const config = ProxyConfig.create({
    servers: serversJson, // Keep as JSON string
    timestamp,
    expiresAt,
    extensionId,
    validServersCount: Object.keys(validServers).length,
    totalServersCount: Object.keys(servers).length,
  }, { owner: worker });

  account.root.configs.push(config);
  
  // Update latest config
  account.root.latestConfig = config;
  
  // Update stats
  if (account.root.stats) {
    account.root.stats.totalUpdates = (account.root.stats.totalUpdates || 0) + 1;
    account.root.stats.lastUpdateTime = timestamp;
    account.root.stats.totalProxiesEverSeen = 
      (account.root.stats.totalProxiesEverSeen || 0) + Object.keys(servers).length;
  }
  
  await account.root.configs.waitForSync();
  await account.root.waitForSync();
  
  // Log TTL info
  for (const [key, server] of Object.entries(servers)) {
    if (server.ttl && server.ttl > 0) {
      console.log(`   ${server.name || key}: expires in ${server.ttl} minutes`);
    } else {
      console.log(`   ${server.name || key}: never expires`);
    }
  }

  if (expiresAt) {
    console.log(`⏰ Config will expire at: ${new Date(expiresAt).toLocaleString()}`);
  }
  
  console.log(`✅ Saved ${Object.keys(servers).length} servers (${Object.keys(validServers).length} valid)`);

  // Create response
  const responseGroup = Group.create({ owner: worker });
  responseGroup.addMember(senderAccount, "reader");
  
  const response = ProxyDataResponse.create({
    id: config.id,
    message: `Saved ${Object.keys(servers).length} proxy servers`,
    savedCount: Object.keys(servers).length,
    timestamp: new Date().toISOString(),
  }, { owner: responseGroup });

  await responseGroup.waitForSync();
  return response;
}

// Handle status check requests
async function handleStatusCheck(message, senderID, worker) {
  console.log(`📊 Status check from: ${senderID}`);
  
  const account = await worker.ensureLoaded({ 
    resolve: { 
      root: { 
        latestConfig: true,
        stats: true
      } 
    } 
  });

  if (!account.root.latestConfig) {
    return ProxyStatusResponse.create({
      needsUpdate: true,
      validServers: 0,
      expiredServers: 0,
      totalServers: 0,
    });
  }

  const servers = parseServers(account.root.latestConfig.servers);
  const validServers = getValidServers(servers);
  const totalServers = Object.keys(servers).length;
  const expiredCount = totalServers - Object.keys(validServers).length;
  
  // Check if update needed
  const updateNeeded = needsUpdate(account.root.latestConfig);

  // Calculate next expiration (with minutes)
  let nextExpirationIn = null;
  if (account.root.latestConfig.expiresAt) {
    const msUntilExpiration = new Date(account.root.latestConfig.expiresAt).getTime() - Date.now();
    nextExpirationIn = Math.max(0, Math.floor(msUntilExpiration / 60000)); // Convert to minutes
  }

  const senderAccount = await ProxyClientAccount.load(senderID, { loadAs: worker });
  const responseGroup = Group.create({ owner: worker });
  responseGroup.addMember(senderAccount, "reader");

  const response = ProxyStatusResponse.create({
    needsUpdate: updateNeeded,
    validServers: Object.keys(validServers).length,
    expiredServers: expiredCount,
    totalServers: totalServers,
    lastUpdateTime: account.root.stats?.lastUpdateTime,
    nextExpirationIn,
  }, { owner: responseGroup });

  await responseGroup.waitForSync();
  return response;
}

// Handle proxy list requests
async function handleProxyRequest(message, senderID, worker) {
  const { includeExpired } = message;
  console.log(`📋 Proxy list request from: ${senderID} (includeExpired: ${includeExpired})`);
  
  const account = await worker.ensureLoaded({ 
    resolve: { 
      root: { 
        latestConfig: true 
      } 
    } 
  });

  if (!account.root.latestConfig) {
    return ProxyListResponse.create({
      servers: JSON.stringify({}),
      validCount: 0,
      expiredCount: 0,
      retrievedAt: new Date().toISOString(),
    });
  }

  const allServers = parseServers(account.root.latestConfig.servers);
  const servers = includeExpired ? allServers : getValidServers(allServers);
  const validCount = Object.keys(getValidServers(allServers)).length;
  const expiredCount = Object.keys(allServers).length - validCount;

  const senderAccount = await ProxyClientAccount.load(senderID, { loadAs: worker });
  const responseGroup = Group.create({ owner: worker });
  responseGroup.addMember(senderAccount, "reader");

  const response = ProxyListResponse.create({
    servers: JSON.stringify(servers),
    validCount,
    expiredCount,
    retrievedAt: new Date().toISOString(),
  }, { owner: responseGroup });

  await responseGroup.waitForSync();
  return response;
}

// Generate V2Ray configuration
async function generateV2RayConfiguration(worker) {
  const account = await worker.ensureLoaded({ 
    resolve: { 
      root: { 
        latestConfig: true,
        v2rayConfigs: true
      } 
    } 
  });

  if (!account.root.latestConfig) {
    console.log("No proxy configuration available");
    return null;
  }

  const servers = parseServers(account.root.latestConfig.servers);
  const validServers = getValidServers(servers);
  
  console.log(`🔧 Generating V2Ray config with ${Object.keys(validServers).length} valid proxies`);

  const v2rayConfig = {
    "log": {
      "loglevel": "warning"
    },
    "inbounds": [
      {
        "port": 1080,
        "listen": "127.0.0.1",
        "protocol": "socks",
        "settings": {
          "auth": "noauth",
          "udp": true
        }
      },
      {
        "port": 8001,
        "listen": "127.0.0.1",
        "protocol": "http"
      }
    ],
    "outbounds": [],
    "routing": {
      "domainStrategy": "IPIfNonMatch",
      "rules": [
        {
          "type": "field",
          "ip": ["geoip:private"],
          "outboundTag": "direct"
        }
      ]
    }
  };

  const serversList = [];
  
  // Add each valid proxy
  for (const [key, server] of Object.entries(validServers)) {
    const protocol = server.host.includes("socks") ? "socks" : "http";
    
    v2rayConfig.outbounds.push({
      "protocol": protocol,
      "settings": {
        "servers": [{
          "address": server.host,
          "port": server.port
        }]
      },
      "tag": `proxy-${key}`,
      "streamSettings": {
        "network": "tcp"
      }
    });

    serversList.push({
      name: server.name || key,
      host: server.host,
      port: server.port,
      protocol: protocol
    });
  }

  // Add direct outbound
  v2rayConfig.outbounds.push({
    "protocol": "freedom",
    "tag": "direct"
  });

  // Set default proxy (first available)
  if (v2rayConfig.outbounds.length > 1) {
    v2rayConfig.routing.rules.push({
      "type": "field",
      "outboundTag": v2rayConfig.outbounds[0].tag
    });
  }

  // Save V2Ray config
  const v2rayConfigRecord = V2RayConfig.create({
    generatedAt: new Date().toISOString(),
    validProxies: Object.keys(validServers).length,
    configJson: JSON.stringify(v2rayConfig, null, 2),
    serversList: JSON.stringify(serversList),
  }, { owner: worker });

  account.root.v2rayConfigs.push(v2rayConfigRecord);
  await account.root.v2rayConfigs.waitForSync();

  return v2rayConfig;
}

// Main server function
async function startProxyServer() {
  if (!process.env.JAZZ_PROXY_SERVER_ACCOUNT || !process.env.JAZZ_PROXY_SERVER_SECRET) {
    throw new Error("❌ ERROR: JAZZ_PROXY_SERVER_ACCOUNT and JAZZ_PROXY_SERVER_SECRET must be set.");
  }

  console.log("🚀 Starting Proxy Config Server with TTL support...");

  const { worker, experimental: { inbox } } = await startWorker({
    syncServer: process.env.JAZZ_SYNC_URL || "ws://127.0.0.1:4200",
    accountID: process.env.JAZZ_PROXY_SERVER_ACCOUNT,
    accountSecret: process.env.JAZZ_PROXY_SERVER_SECRET,
    AccountSchema: ProxyServerAccount,
  });

  // Ensure profile is public
  console.log("🔑 Setting up server account...");
  const me = await worker.ensureLoaded({ 
    resolve: { 
      profile: true,
      root: {
        configs: true,
        stats: true
      }
    } 
  });

    // Initialize account structure
  const account = await initializeServerAccount(worker);
  
  
  const profileGroup = me.profile._owner;
  if (profileGroup.getRoleOf("everyone") !== "reader") {
    profileGroup.addMember("everyone", "reader");
    await profileGroup.waitForSync();
    console.log("   ✅ Profile is now public.");
  }

  console.log(`✅ Server connected with Account ID: ${worker.id}`);
  console.log(`   Total configs stored: ${me.root.configs?.length || 0}`);
  console.log(`   Total updates: ${me.root.stats?.totalUpdates || 0}`);
  console.log("📬 Listening for proxy messages...");

  // Subscribe to inbox messages
  inbox.subscribe(ProxyMessage, async (message, senderID) => {
    console.log(`\n📥 Received ${message.type} message from: ${senderID}`);

    try {
      switch (message.type) {
        case "proxyData":
          return await handleProxyData(message, senderID, worker);
        case "checkStatus":
          return await handleStatusCheck(message, senderID, worker);
        case "requestProxies":
          return await handleProxyRequest(message, senderID, worker);
        default:
          throw new Error(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`❌ Error handling message: ${error.message}`);
      console.error(error.stack);
      throw error;
    }
  });

  // Periodic tasks
  setInterval(async () => {
    const account = await worker.ensureLoaded({ 
      resolve: { 
        root: { 
          configs: true,
          latestConfig: true,
          stats: true
        } 
      } 
    });
    
    // Status report
    console.log("\n📊 Server Status Report:");
    console.log(`   Account ID: ${worker.id}`);
    console.log(`   Total configs: ${account.root.configs?.length || 0}`);
    console.log(`   Total updates: ${account.root.stats?.totalUpdates || 0}`);
    
    if (account.root.latestConfig) {
      const summary = generateProxySummary(account.root.latestConfig.servers);
      console.log(`   Latest config: ${summary.valid} valid, ${summary.expired} expired`);
      console.log(`   By country: ${JSON.stringify(summary.byCountry)}`);
      console.log(`   By protocol: ${JSON.stringify(summary.byProtocol)}`);
    }
    
    // Cleanup old configs (keep last 20)
    if (account.root.configs.length > 20) {
      const toKeep = account.root.configs.slice(-20);
      account.root.configs = co.list(ProxyConfig).create(toKeep, { owner: worker });
      await account.root.configs.waitForSync();
      console.log("🧹 Cleaned up old configs");
    }
    
    // Auto-generate V2Ray config if proxies updated
    if (needsUpdate(account.root.latestConfig)) {
      console.log("🔄 Auto-generating new V2Ray config...");
      await generateV2RayConfiguration(worker);
    }
  }, 60000); // Every minute

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log("\n⏹️  Shutting down proxy server...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    process.exit(0);
  });
}

// Start the server
startProxyServer().catch(console.error);