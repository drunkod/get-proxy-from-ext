// e2e/proxy-server-extension-jazz.js
import { startWorker } from "jazz-tools/worker";
import { WebSocket } from "ws";
import { co, Group } from "jazz-tools";
import { InboxSender } from "jazz-tools";
import { 
  ProxyServerAccount,
  ProxyClientAccount,
  ProxyConfig,
  ProxyRequestMessage,
  ProxyListResponse,
  parseServers,
  getValidServers,
  needsUpdate,
  calculateExpiration
} from "./proxy-schema.js";

global.WebSocket = WebSocket;

// Extended schema for direct extension communication
const ExtensionProxyRequest = co.map({
  type: z.literal("extensionProxyRequest"),
  requestId: z.string(),
  requestFreshData: z.boolean(),
});

const ExtensionProxyResponse = co.map({
  type: z.literal("extensionProxyResponse"),
  requestId: z.string(),
  servers: z.string(), // JSON string
  timestamp: z.string(),
  extensionId: z.string(),
  freshData: z.boolean(),
});

async function startExtensionAwareServer() {
  console.log("🎷 Starting Jazz Server with Extension Communication...");
  
  const { worker, experimental: { inbox } } = await startWorker({
    syncServer: process.env.JAZZ_SYNC_URL || "ws://127.0.0.1:4200",
    accountID: process.env.JAZZ_PROXY_SERVER_ACCOUNT,
    accountSecret: process.env.JAZZ_PROXY_SERVER_SECRET,
    AccountSchema: ProxyServerAccount,
  });
  
  const account = await worker.ensureLoaded({ 
    resolve: { 
      root: { 
        configs: true,
        latestConfig: true,
        stats: true 
      } 
    } 
  });
  
  // Map to track connected extensions
  const connectedExtensions = new Map();
  
  // Listen for extension registrations
  inbox.subscribe(co.map({
    type: z.literal("extensionRegister"),
    extensionId: z.string(),
    accountId: z.string(),
  }), async (message, senderID) => {
    console.log(`🔌 Extension registered: ${message.extensionId}`);
    connectedExtensions.set(message.extensionId, {
      accountId: senderID,
      lastSeen: Date.now(),
      extensionId: message.extensionId
    });
  });
  
  // Function to request fresh proxies from extension
  async function requestFreshProxiesFromExtension(extensionAccountId) {
    console.log(`📡 Requesting fresh proxies from extension: ${extensionAccountId}`);
    
    try {
      const extensionAccount = await ProxyClientAccount.load(
        extensionAccountId, 
        { loadAs: worker }
      );
      
      if (!extensionAccount) {
        throw new Error(`Could not load extension account: ${extensionAccountId}`);
      }
      
      // Create request
      const requestId = Math.random().toString(36).substr(2, 9);
      const request = ExtensionProxyRequest.create({
        type: "extensionProxyRequest",
        requestId: requestId,
        requestFreshData: true,
      }, { owner: worker });
      
      // Send request via inbox
      const sender = await InboxSender.load(extensionAccountId, worker);
      const responseId = await sender.sendMessage(request);
      
      console.log(`📤 Sent request ${requestId} to extension`);
      
      // Wait for response (with timeout)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Extension request timeout'));
        }, 10000);
        
        // Subscribe to response
        const unsubscribe = inbox.subscribe(ExtensionProxyResponse, 
          async (response, senderID) => {
            if (response.requestId === requestId && senderID === extensionAccountId) {
              clearTimeout(timeout);
              unsubscribe();
              
              console.log(`📥 Received fresh proxies from extension`);
              resolve(response);
            }
          }
        );
      });
      
    } catch (error) {
      console.error(`❌ Failed to get proxies from extension:`, error);
      return null;
    }
  }
  
  // Periodic proxy freshness check
  async function checkAndRefreshProxies() {
    console.log('\n🔍 Checking proxy freshness...');
    
    if (needsUpdate(account.root.latestConfig)) {
      console.log('⚠️  Proxies need refresh!');
      
      // Try to get fresh data from connected extensions
      for (const [extensionId, info] of connectedExtensions) {
        if (Date.now() - info.lastSeen < 300000) { // Active in last 5 min
          try {
            const response = await requestFreshProxiesFromExtension(info.accountId);
            
            if (response && response.freshData) {
              // Save fresh proxy data
              const servers = parseServers(response.servers);
              
              const config = ProxyConfig.create({
                servers: response.servers,
                timestamp: response.timestamp,
                expiresAt: calculateExpiration(servers),
                extensionId: response.extensionId,
                validServersCount: Object.keys(getValidServers(servers)).length,
                totalServersCount: Object.keys(servers).length,
              }, { owner: worker });
              
              account.root.configs.push(config);
              account.root.latestConfig = config;
              
              if (account.root.stats) {
                account.root.stats.totalUpdates++;
                account.root.stats.lastUpdateTime = response.timestamp;
              }
              
              await account.root.waitForSync();
              console.log(`✅ Refreshed proxies from extension: ${extensionId}`);
              break; // Got fresh data, stop trying
            }
          } catch (error) {
            console.error(`Failed to refresh from ${extensionId}:`, error);
          }
        }
      }
    } else {
      const validCount = account.root.latestConfig ? 
        Object.keys(getValidServers(parseServers(account.root.latestConfig.servers))).length : 0;
      console.log(`✅ Proxies still fresh: ${validCount} valid servers`);
    }
  }
  
  // Handle proxy data pushed from extensions
  inbox.subscribe(co.map({
    type: z.literal("proxyUpdate"),
    servers: z.string(),
    timestamp: z.string(),
    extensionId: z.string(),
  }), async (message, senderID) => {
    console.log(`📥 Proxy update from extension: ${message.extensionId}`);
    
    // Update last seen
    if (connectedExtensions.has(message.extensionId)) {
      connectedExtensions.get(message.extensionId).lastSeen = Date.now();
    }
    
    // Save proxy data
    const servers = parseServers(message.servers);
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
    
    await account.root.waitForSync();
    console.log(`✅ Saved ${Object.keys(servers).length} proxies`);
  });
  
  // Check proxies every 2 minutes
  setInterval(checkAndRefreshProxies, 2 * 60 * 1000);
  
  // Initial check after 10 seconds
  setTimeout(checkAndRefreshProxies, 10000);
  
  // Status report
  setInterval(() => {
    console.log('\n📊 Server Status:');
    console.log(`   Connected extensions: ${connectedExtensions.size}`);
    for (const [id, info] of connectedExtensions) {
      const age = Math.floor((Date.now() - info.lastSeen) / 1000);
      console.log(`   - ${id}: last seen ${age}s ago`);
    }
  }, 30000);
  
  console.log('✅ Server ready for extension communication');
  console.log(`   Account ID: ${worker.id}`);
}

startExtensionAwareServer().catch(console.error);