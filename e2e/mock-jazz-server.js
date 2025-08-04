// e2e/mock-jazz-server.js
// Simplified mock server for testing extension-server communication
import { WebSocketServer } from 'ws';

const PORT = 4200;
const wss = new WebSocketServer({ port: PORT });

const connections = new Map();
const messages = new Map();

console.log(`🎷 Mock Jazz Server running on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  console.log('🔌 New connection');
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('📥 Received:', message.type);
      
      switch (message.type) {
        case 'auth':
          // Simple auth
          connections.set(message.accountId, ws);
          ws.send(JSON.stringify({ type: 'auth_success' }));
          break;
          
        case 'subscribe':
          // Track subscriptions
          console.log(`   Subscribed to: ${message.channel}`);
          break;
          
        case 'proxy_update':
          // Extension sending proxy update
          console.log(`   Proxy update: ${Object.keys(message.servers).length} servers`);
          
          // Forward to server if connected
          const serverWs = connections.get(process.env.JAZZ_PROXY_SERVER_ACCOUNT);
          if (serverWs) {
            serverWs.send(JSON.stringify({
              type: 'proxy_update',
              ...message,
              senderID: message.extensionId
            }));
          }
          break;
          
        case 'proxy_request':
          // Server requesting proxies
          console.log('   Server requesting proxies');
          
          // Find an extension to request from
          for (const [accountId, clientWs] of connections) {
            if (accountId !== message.accountId) {
              clientWs.send(JSON.stringify({
                type: 'proxy_request',
                requestId: message.requestId
              }));
              break;
            }
          }
          break;
          
        case 'proxy_response':
          // Extension responding with proxies
          console.log(`   Extension response: ${message.servers ? Object.keys(message.servers).length : 0} servers`);
          
          // Forward response
          const targetWs = connections.get(process.env.JAZZ_PROXY_SERVER_ACCOUNT);
          if (targetWs) {
            targetWs.send(JSON.stringify(message));
          }
          break;
      }
      
    } catch (error) {
      console.error('❌ Error handling message:', error);
    }
  });
  
  ws.on('close', () => {
    // Remove from connections
    for (const [id, conn] of connections) {
      if (conn === ws) {
        connections.delete(id);
        console.log(`🔌 Disconnected: ${id}`);
        break;
      }
    }
  });
});

// Status endpoint
setInterval(() => {
  console.log(`\n📊 Connected clients: ${connections.size}`);
  for (const [id, ws] of connections) {
    console.log(`   - ${id}: ${ws.readyState === 1 ? 'connected' : 'disconnected'}`);
  }
}, 30000);