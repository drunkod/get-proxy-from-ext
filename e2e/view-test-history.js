// e2e/view-proxy-history.js
import { startWorker } from "jazz-tools/worker";
import { WebSocket } from "ws";
import { ProxyServerAccount, parseServers, getValidServers } from "./proxy-schema.js";
import { config } from 'dotenv';

config(); // Load .env
global.WebSocket = WebSocket;

async function viewProxyHistory() {
  console.log("🔍 Connecting to Jazz server...");
  
  try {
    const { worker } = await startWorker({
      syncServer: process.env.JAZZ_SYNC_URL || "ws://127.0.0.1:4200",
      accountID: process.env.JAZZ_PROXY_SERVER_ACCOUNT,
      accountSecret: process.env.JAZZ_PROXY_SERVER_SECRET,
      AccountSchema: ProxyServerAccount,
    });

    console.log("📡 Loading proxy data...");
    
    const account = await worker.ensureLoaded({ 
      resolve: { 
        root: { 
          configs: { $each: {} },
          latestConfig: true,
          stats: true,
          v2rayConfigs: { $each: {} }
        } 
      } 
    });

    if (!account || !account.root) {
      console.log("❌ Could not load account data");
      return;
    }

    console.log(`\n📚 Proxy History for Server ${account.id}:`);
    console.log(`Total configs stored: ${account.root.configs?.length || 0}`);
    console.log(`Total updates: ${account.root.stats?.totalUpdates || 0}`);
    console.log(`Last update: ${account.root.stats?.lastUpdateTime ? new Date(account.root.stats.lastUpdateTime).toLocaleString() : 'Never'}\n`);

    // Show latest config details
    if (account.root.latestConfig) {
      console.log("📋 Latest Configuration:");
      const servers = parseServers(account.root.latestConfig.servers);
      const validServers = getValidServers(servers);
      
      console.log(`   Timestamp: ${new Date(account.root.latestConfig.timestamp).toLocaleString()}`);
      console.log(`   Total servers: ${account.root.latestConfig.totalServersCount}`);
      console.log(`   Valid servers: ${Object.keys(validServers).length}`);
      console.log(`   Expired servers: ${account.root.latestConfig.totalServersCount - Object.keys(validServers).length}`);
      
      if (account.root.latestConfig.expiresAt) {
        const timeUntilExpiry = new Date(account.root.latestConfig.expiresAt) - new Date();
        if (timeUntilExpiry > 0) {
          const minutesLeft = Math.floor(timeUntilExpiry / 60000);
          console.log(`   ⏰ Next expiration in: ${minutesLeft} minutes`);
        } else {
          console.log(`   ⚠️  Config has expired proxies`);
        }
      }
      
      console.log("\n📡 Server Details:");
      for (const [key, server] of Object.entries(servers)) {
        const isValid = validServers[key] !== undefined;
        const status = isValid ? '✅' : '❌';
        console.log(`   ${status} ${server.name || key}: ${server.host}:${server.port}`);
        
        if (server.ttl && server.ttl > 0) {
          const expiresAt = new Date(server.receivedTime + (server.ttl * 60 * 1000));
          const minutesLeft = Math.floor((expiresAt - new Date()) / 60000);
          if (minutesLeft > 0) {
            console.log(`      Expires in: ${minutesLeft} minutes`);
          } else {
            console.log(`      Expired: ${Math.abs(minutesLeft)} minutes ago`);
          }
        } else {
          console.log(`      Never expires`);
        }
      }
    }

    // Show recent configs
    if (account.root.configs && account.root.configs.length > 1) {
      console.log("\n📜 Recent Configurations:");
      const recentConfigs = account.root.configs.slice(-5).reverse();
      for (const config of recentConfigs) {
        if (config && config !== account.root.latestConfig) {
          const servers = parseServers(config.servers);
          console.log(`   ${new Date(config.timestamp).toLocaleString()} - ${Object.keys(servers).length} servers`);
        }
      }
    }

    // Show V2Ray configs
    if (account.root.v2rayConfigs && account.root.v2rayConfigs.length > 0) {
      console.log("\n🔧 V2Ray Configurations:");
      const recentV2ray = account.root.v2rayConfigs.slice(-3).reverse();
      for (const v2config of recentV2ray) {
        if (v2config) {
          console.log(`   ${new Date(v2config.generatedAt).toLocaleString()} - ${v2config.validProxies} proxies`);
        }
      }
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    process.exit(0);
  }
}

viewProxyHistory().catch(console.error);