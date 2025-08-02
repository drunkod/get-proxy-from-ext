// e2e/proxy-webhook-server.js
import express from 'express';
import cors from 'cors';
import { startWorker } from "jazz-tools/worker";
import { InboxSender } from "jazz-tools";
import { ProxyClientAccount, ProxyDataMessage } from "./proxy-schema.js";
import { WebSocket } from "ws";
import fs from 'fs';
import path from 'path';

global.WebSocket = WebSocket;

const app = express();
app.use(cors());
app.use(express.json());

let jazzSender = null;
let worker = null;
let stats = {
  received: 0,
  sent: 0,
  lastUpdate: null,
  errors: 0
};

async function initializeClientAccount(worker) {
  let account = await worker.ensureLoaded({ 
    resolve: { 
      profile: true,
      root: true
    } 
  });
  
  if (!account.root) {
    console.log("📦 Creating client account root...");
    
    const responseIds = co.list(z.string()).create([], { owner: worker });
    
    account.root = ClientAccountRoot.create({
      responseIds: responseIds,
      requestCount: 0,
    }, { owner: worker });
    
    await account.waitForSync();
  }
  
  return account;
}

// Initialize Jazz
async function initJazz() {
  console.log('🎷 Initializing Jazz...');
  try {
    const result = await startWorker({
      syncServer: process.env.JAZZ_SYNC_URL || "ws://127.0.0.1:4200",
      accountID: process.env.JAZZ_PROXY_CLIENT_ACCOUNT,
      accountSecret: process.env.JAZZ_PROXY_CLIENT_SECRET,
      AccountSchema: ProxyClientAccount,
    });
    
    worker = result.worker;

    // Initialize account if needed
    await initializeClientAccount(worker);

    jazzSender = await InboxSender.load(process.env.JAZZ_PROXY_SERVER_ACCOUNT, worker);
    console.log('✅ Jazz initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Jazz:', error);
    throw error;
  }
}

// Webhook endpoint
app.post('/proxy-update', async (req, res) => {
  stats.received++;
  stats.lastUpdate = new Date().toISOString();
  
  const { servers, timestamp, extensionId } = req.body;
  
  console.log(`\n📥 Received proxy update at ${new Date().toLocaleTimeString()}`);
  console.log(`   Extension ID: ${extensionId}`);
  console.log(`   Servers: ${Object.keys(servers).join(', ')}`);
  
  // Save to local file for backup
  const dataDir = 'proxy-data';
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }
  
  const filename = `proxy-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(dataDir, filename),
    JSON.stringify({ servers, timestamp, extensionId }, null, 2)
  );
  
  // Send to Jazz if available
  if (jazzSender) {
    try {
      // Transform servers data
      const transformedServers = {};
      for (const [key, server] of Object.entries(servers)) {
        if (server.host && server.port) {
          transformedServers[key] = {
            host: server.host,
            port: server.port,
            name: server.name || key,
            receivedTime: server.receivedTime || Date.now(),
            ttl: server.ttl || -1,
          };
        }
      }
      
    const message = ProxyDataMessage.create({
    type: "proxyData",
    servers: JSON.stringify(transformedServers), // Stringify the servers
    timestamp: timestamp || new Date().toISOString(),
    extensionId: extensionId,
    });
      
      const responseId = await jazzSender.sendMessage(message);
      stats.sent++;
      
      console.log(`✅ Sent to Jazz, response ID: ${responseId}`);
      res.json({ 
        status: 'success', 
        responseId,
        serversCount: Object.keys(transformedServers).length 
      });
    } catch (error) {
      stats.errors++;
      console.error('❌ Failed to send to Jazz:', error);
      res.status(500).json({ 
        status: 'error', 
        message: 'Failed to send to Jazz',
        error: error.message 
      });
    }
  } else {
    res.json({ 
      status: 'saved_locally', 
      message: 'Jazz not connected, saved locally',
      filename 
    });
  }
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    jazz: jazzSender ? 'connected' : 'disconnected',
    stats,
    uptime: process.uptime()
  });
});

// List saved proxy data
app.get('/proxy-data', (req, res) => {
  const dataDir = 'proxy-data';
  if (!fs.existsSync(dataDir)) {
    res.json({ files: [] });
    return;
  }
  
  const files = fs.readdirSync(dataDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 10); // Last 10 files
  
  const data = files.map(file => {
    const content = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    return {
      filename: file,
      timestamp: content.timestamp,
      servers: Object.keys(content.servers),
      extensionId: content.extensionId
    };
  });
  
  res.json({ files: data });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n🚀 Proxy webhook server running on http://localhost:${PORT}`);
  console.log('📝 Endpoints:');
  console.log(`   POST /proxy-update - Receive proxy updates`);
  console.log(`   GET  /status       - Server status`);
  console.log(`   GET  /proxy-data   - List saved proxy data`);
  
  // Initialize Jazz in background
  initJazz().catch(error => {
    console.error('⚠️  Running without Jazz connection');
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});