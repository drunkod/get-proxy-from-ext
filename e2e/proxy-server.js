// e2e/proxy-server.js
import { startWorker } from "jazz-tools/worker";
import { WebSocket } from "ws";
import { co, z } from "jazz-tools";
import {
  ProxyServerAccount,
  ServerAccountRoot,
  ProxyConfig,
  V2RayConfig,
  StatsSchema,
  ServerBoundMessage,
  parseServers,
  getValidServers,
  calculateExpiration,
  generateProxySummary,
  needsUpdate
} from "./proxy-schema.js";

global.WebSocket = WebSocket;

async function startProxyServer() {
  console.log("🎷 Starting Simplified Jazz Proxy Server...");

  const { worker, experimental: { inbox } } = await startWorker({
    syncServer: process.env.JAZZ_SYNC_URL || "ws://127.0.0.1:4200",
    accountID: process.env.JAZZ_PROXY_SERVER_ACCOUNT,
    accountSecret: process.env.JAZZ_PROXY_SERVER_SECRET,
    AccountSchema: ProxyServerAccount,
  });

  // Load the account more shallowly first to avoid errors on missing fields.
  const account = await worker.ensureLoaded({
    resolve: { 
      profile: true,
      root: true
    }
  });

  // **FIX:** Check for and initialize the root CoValue if it doesn't exist.
  // This is crucial for new or corrupted accounts.
  if (!account.root) {
    console.log("🔧 Root not found. Initializing new account root...");
    account.root = ServerAccountRoot.create({
      configs: co.list(ProxyConfig).create([], { owner: worker }),
      v2rayConfigs: co.list(V2RayConfig).create([], { owner: worker }),
      stats: StatsSchema.create({
        totalUpdates: 0,
        totalProxiesEverSeen: 0,
      }, { owner: worker }),
      connectedExtensions: co.map(z.string()).create({}, { owner: worker }),
    }, { owner: worker });
    await account.waitForSync();
    console.log("✅ New account root initialized.");
  }

  // Now that we know `account.root` exists, load its contents.
  await account.root.ensureLoaded({
      resolve: {
          configs: true,
          v2rayConfigs: true,
          stats: true,
          connectedExtensions: true,
          latestConfig: true,
      }
  });

  // **FIX:** Add fallback initializations for each field in the root,
  // making the server robust against accounts with older schemas.
  if (!account.root.connectedExtensions) {
    console.log("🔧 Initializing missing 'connectedExtensions' map...");
    account.root.connectedExtensions = co.map(z.string()).create({}, { owner: worker });
    await account.root.waitForSync();
  }
  if (!account.root.configs) {
    console.log("🔧 Initializing missing 'configs' list...");
    account.root.configs = co.list(ProxyConfig).create([], { owner: worker });
    await account.root.waitForSync();
  }
   if (!account.root.v2rayConfigs) {
      console.log("🔧 Initializing missing 'v2rayConfigs' list...");
      account.root.v2rayConfigs = co.list(V2RayConfig).create([], { owner: worker });
      await account.root.waitForSync();
  }
  if (!account.root.stats) {
    console.log("🔧 Initializing missing 'stats' object...");
    account.root.stats = StatsSchema.create({
        totalUpdates: 0,
        totalProxiesEverSeen: 0,
    }, { owner: worker });
    await account.root.waitForSync();
  }

  // Make profile public
  const profileGroup = account.profile._owner;
  if (profileGroup.getRoleOf("everyone") !== "reader") {
    profileGroup.addMember("everyone", "reader");
    await profileGroup.waitForSync();
  }

  console.log(`✅ Server ready. Account ID: ${worker.id}`);
  console.log(`   Total configs: ${account.root.configs?.length || 0}`);
  console.log(`   Connected extensions: ${account.root.connectedExtensions?.size || 0}`);

  // Single subscription for all messages
  inbox.subscribe(ServerBoundMessage, async (message, senderID) => {
    console.log(`\n📥 Received '${message.type}' from: ${senderID}`);

    try {
      if (message.type === 'register') {
        console.log(`   Extension registered: ${message.extensionId}`);
        account.root.connectedExtensions.set(message.extensionId, senderID);
        await account.root.connectedExtensions.waitForSync();

      } else if (message.type === 'push') {
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

        // Update stats
        if (account.root.stats) {
          account.root.stats.totalUpdates = (account.root.stats.totalUpdates || 0) + 1;
          account.root.stats.lastUpdateTime = message.timestamp;
          account.root.stats.totalProxiesEverSeen =
            (account.root.stats.totalProxiesEverSeen || 0) + Object.keys(servers).length;
        }

        await account.root.waitForSync();
        console.log(`   ✅ Saved ${Object.keys(servers).length} servers`);
        
        // Auto-generate V2Ray config if needed
        if (needsUpdate(account.root.latestConfig)) {
          console.log("   🔧 Generating V2Ray config...");
          await generateV2RayConfiguration(worker, account);
        }
      }
    } catch (error) {
      console.error(`❌ Error handling message:`, error);
    }
  });

  // Generate V2Ray configuration
  async function generateV2RayConfiguration(worker, account) {
    if (!account.root.latestConfig) return;

    const servers = parseServers(account.root.latestConfig.servers);
    const validServers = getValidServers(servers);
    
    const v2rayConfig = {
      "log": { "loglevel": "warning" },
      "inbounds": [
        {
          "port": 1080,
          "listen": "127.0.0.1",
          "protocol": "socks",
          "settings": { "auth": "noauth", "udp": true }
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

    // Add valid proxies
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
        "streamSettings": { "network": "tcp" }
      });
    }

    // Add direct outbound
    v2rayConfig.outbounds.push({
      "protocol": "freedom",
      "tag": "direct"
    });

    // Set default proxy
    if (v2rayConfig.outbounds.length > 1) {
      v2rayConfig.routing.rules.push({
        "type": "field",
        "outboundTag": v2rayConfig.outbounds[0].tag
      });
    }

    // Save config
    const v2rayConfigRecord = V2RayConfig.create({
      generatedAt: new Date().toISOString(),
      validProxies: Object.keys(validServers).length,
      configJson: JSON.stringify(v2rayConfig, null, 2),
      serversList: JSON.stringify(Object.values(validServers)),
    }, { owner: worker });

    account.root.v2rayConfigs.push(v2rayConfigRecord);
    await account.root.v2rayConfigs.waitForSync();
    
    console.log(`   ✅ V2Ray config generated with ${Object.keys(validServers).length} proxies`);
  }

  // Periodic tasks
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
      const toKeep = account.root.configs.slice(-20);
      account.root.configs = co.list(ProxyConfig).create(toKeep, { owner: worker });
      await account.root.configs.waitForSync();
      console.log("   🧹 Cleaned up old configs");
    }
  }, 60000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log("\n⏹️  Shutting down server...");
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(0);
  });
}

startProxyServer().catch(console.error);
