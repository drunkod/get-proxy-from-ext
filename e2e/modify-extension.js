// e2e/modify-extension-jazz-v3.js
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

const EXTENSION_ZIP = 'hide-me-Chrome-Chrome.zip';
const MODIFIED_DIR = '.modified-extension-jazz-v3';

async function modifyExtensionWithJazzV3() {
  console.log('🎷 Modifying extension with Jazz for Service Workers...');
  
  // Clean and create directories
  if (fs.existsSync(MODIFIED_DIR)) {
    fs.rmSync(MODIFIED_DIR, { recursive: true });
  }
  fs.mkdirSync(MODIFIED_DIR);
  
  // Extract original extension
  const zip = new AdmZip(EXTENSION_ZIP);
  zip.extractAllTo(MODIFIED_DIR, true);
  
  // Create Jazz directory
  const jazzDir = path.join(MODIFIED_DIR, 'jazz');
  fs.mkdirSync(jazzDir, { recursive: true });
  
  // 1. Create Jazz service for service workers
  const jazzServiceContent = `
// jazz/jazz-service.js
class ExtensionJazzService {
  constructor() {
    this.ws = null;
    this.accountId = null;
    this.accountSecret = null;
    this.serverAccountId = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000;
  }
  
  async initialize(config) {
    console.log('[Jazz] Initializing connection...');
    
    this.accountId = config.accountId;
    this.accountSecret = config.accountSecret;
    this.serverAccountId = config.serverAccountId;
    
    await this.connect(config.syncServer);
  }
  
  async connect(syncServer) {
    try {
      this.ws = new WebSocket(syncServer || 'ws://localhost:4200');
      
      this.ws.onopen = () => {
        console.log('[Jazz] Connected to sync server');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.authenticate();
      };
      
      this.ws.onmessage = (event) => {
        this.handleMessage(JSON.parse(event.data));
      };
      
      this.ws.onerror = (error) => {
        console.error('[Jazz] WebSocket error:', error);
      };
      
      this.ws.onclose = () => {
        console.log('[Jazz] Disconnected');
        this.connected = false;
        this.attemptReconnect();
      };
      
    } catch (error) {
      console.error('[Jazz] Failed to connect:', error);
      this.attemptReconnect();
    }
  }
  
  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(\`[Jazz] Reconnecting in \${this.reconnectDelay}ms (attempt \${this.reconnectAttempts})\`);
      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay);
    }
  }
  
  authenticate() {
    this.send({
      type: 'auth',
      accountId: this.accountId,
      accountSecret: this.accountSecret
    });
  }
  
  send(data) {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('[Jazz] Cannot send - not connected');
    }
  }
  
  handleMessage(message) {
    console.log('[Jazz] Received message:', message.type);
    
    switch (message.type) {
      case 'auth_success':
        console.log('[Jazz] Authentication successful');
        this.subscribeToRequests();
        this.sendInitialProxyData();
        break;
        
      case 'proxy_request':
        this.handleProxyRequest(message);
        break;
    }
  }
  
  subscribeToRequests() {
    this.send({
      type: 'subscribe',
      channel: 'proxy_requests_' + this.accountId
    });
  }
  
  async sendInitialProxyData() {
    const data = await chrome.storage.sync.get('_servers_list');
    if (data._servers_list) {
      this.pushProxyUpdate(data._servers_list);
    }
  }
  
  async handleProxyRequest(request) {
    console.log('[Jazz] Server requesting fresh proxies');
    
    try {
      const data = await chrome.storage.sync.get('_servers_list');
      const servers = data._servers_list || {};
      
      // Add fresh timestamps
      const freshServers = {};
      for (const [key, server] of Object.entries(servers)) {
        freshServers[key] = {
          ...server,
          receivedTime: Date.now(),
          ttl: server.ttl || 30,
          lastVerified: Date.now()
        };
      }
      
      this.send({
        type: 'proxy_response',
        requestId: request.requestId,
        servers: freshServers,
        timestamp: new Date().toISOString(),
        extensionId: chrome.runtime.id,
        freshData: true
      });
      
      console.log('[Jazz] Sent ' + Object.keys(freshServers).length + ' fresh proxies');
    } catch (error) {
      console.error('[Jazz] Error handling proxy request:', error);
    }
  }
  
  async pushProxyUpdate(servers) {
    if (!this.connected) {
      console.warn('[Jazz] Not connected, cannot push update');
      return;
    }
    
    console.log('[Jazz] Pushing proxy update to server');
    
    this.send({
      type: 'proxy_update',
      servers: servers,
      timestamp: new Date().toISOString(),
      extensionId: chrome.runtime.id
    });
  }
}

// Create and export service instance
self.jazzService = new ExtensionJazzService();
`;
  
  fs.writeFileSync(
    path.join(jazzDir, 'jazz-service.js'),
    jazzServiceContent
  );
  
  // 2. Create service worker integration
  const serviceWorkerIntegration = `
// === JAZZ INTEGRATION FOR SERVICE WORKER ===
// Import Jazz service
importScripts('./jazz/jazz-service.js');

(async function() {
  console.log('[Extension Jazz] Service Worker Jazz Integration');
  
  // Initialize Jazz on startup
  chrome.runtime.onStartup.addListener(initializeJazz);
  chrome.runtime.onInstalled.addListener(initializeJazz);
  
  // Also initialize now
  initializeJazz();
  
  async function initializeJazz() {
    try {
      // Get saved Jazz config
      const { jazzConfig } = await chrome.storage.local.get('jazzConfig');
      
      if (jazzConfig) {
        console.log('[Extension Jazz] Found saved config, initializing...');
        await self.jazzService.initialize(jazzConfig);
        
        // Set up storage listener for proxy changes
        chrome.storage.onChanged.addListener((changes, namespace) => {
          if (changes._servers_list && namespace === 'sync') {
            console.log('[Extension Jazz] Proxy data changed, pushing update');
            const servers = changes._servers_list.newValue;
            self.jazzService.pushProxyUpdate(servers);
          }
        });
      } else {
        console.log('[Extension Jazz] No config found. Configure in extension options.');
      }
    } catch (error) {
      console.error('[Extension Jazz] Initialization error:', error);
    }
  }
  
  // Handle messages from popup/options
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'CONFIGURE_JAZZ') {
      chrome.storage.local.set({ jazzConfig: request.config }, async () => {
        try {
          await self.jazzService.initialize(request.config);
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      });
      return true; // Will respond asynchronously
    }
    
    if (request.type === 'GET_JAZZ_STATUS') {
      sendResponse({
        connected: self.jazzService?.connected || false,
        accountId: self.jazzService?.accountId || null
      });
      return true;
    }
    
    if (request.type === 'DISCONNECT_JAZZ') {
      chrome.storage.local.remove('jazzConfig', () => {
        if (self.jazzService?.ws) {
          self.jazzService.ws.close();
        }
        sendResponse({ success: true });
      });
      return true;
    }
  });
  
  // Periodic connection check
  setInterval(() => {
    if (self.jazzService && !self.jazzService.connected) {
      console.log('[Extension Jazz] Connection lost, attempting to reconnect...');
      initializeJazz();
    }
  }, 30000); // Check every 30 seconds
  
})();
// === END JAZZ INTEGRATION ===

`;
  
  // 3. Inject into service worker
  const manifestPath = path.join(MODIFIED_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  let serviceWorkerFile = 'main.js';
  if (manifest.manifest_version === 3 && manifest.background?.service_worker) {
    serviceWorkerFile = manifest.background.service_worker;
  } else if (manifest.manifest_version === 2) {
    // Convert to service worker for V2
    serviceWorkerFile = manifest.background?.scripts?.[0] || 'main.js';
  }
  
  const swPath = path.join(MODIFIED_DIR, serviceWorkerFile);
  const originalCode = fs.readFileSync(swPath, 'utf8');
  
  // Prepend Jazz integration
  fs.writeFileSync(swPath, serviceWorkerIntegration + '\n\n' + originalCode);
  
  // 4. Create options page (same as before)
  const optionsHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Jazz Proxy Sync Configuration</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
      max-width: 600px;
      margin: 0 auto;
    }
    h1 { color: #333; }
    .form-group {
      margin-bottom: 15px;
    }
    label {
      display: block;
      margin-bottom: 5px;
      font-weight: bold;
    }
    input {
      width: 100%;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      box-sizing: border-box;
    }
    button {
      background: #4CAF50;
      color: white;
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
      margin-right: 10px;
    }
    button:hover {
      background: #45a049;
    }
    button.danger {
      background: #f44336;
    }
    button.danger:hover {
      background: #d32f2f;
    }
    .status {
      margin-top: 20px;
      padding: 10px;
      border-radius: 4px;
    }
    .status.connected {
      background: #d4edda;
      color: #155724;
    }
    .status.disconnected {
      background: #f8d7da;
      color: #721c24;
    }
    .info {
      background: #d1ecf1;
      color: #0c5460;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    #testResults {
      margin-top: 20px;
      padding: 10px;
      background: #f5f5f5;
      border-radius: 4px;
      font-family: monospace;
      white-space: pre-wrap;
      display: none;
    }
  </style>
</head>
<body>
  <h1>🎷 Jazz Proxy Sync Configuration</h1>
  
  <div class="info">
    Connect this extension to Jazz for real-time proxy synchronization.
  </div>
  
  <div class="form-group">
    <label>Jazz Sync Server URL:</label>
    <input type="text" id="syncServer" placeholder="ws://localhost:4200" value="ws://localhost:4200">
  </div>
  
  <div class="form-group">
    <label>Extension Account ID:</label>
    <input type="text" id="accountId" placeholder="extension_account_123">
  </div>
  
  <div class="form-group">
    <label>Extension Account Secret:</label>
    <input type="password" id="accountSecret" placeholder="extension_secret_123">
  </div>
  
  <div class="form-group">
    <label>Server Account ID (to sync with):</label>
    <input type="text" id="serverAccountId" placeholder="server_account_123">
  </div>
  
  <button id="connect">Connect to Jazz</button>
  <button id="disconnect" class="danger" style="display:none;">Disconnect</button>
  <button id="testConnection">Test Connection</button>
  
  <div id="status" class="status disconnected">
    Status: <span id="statusText">Not connected</span>
  </div>
  
  <div id="testResults"></div>
  
  <script src="options.js"></script>
</body>
</html>
`;
  
  const optionsJs = `
// options.js
document.addEventListener('DOMContentLoaded', async () => {
  const elements = {
    syncServer: document.getElementById('syncServer'),
    accountId: document.getElementById('accountId'),
    accountSecret: document.getElementById('accountSecret'),
    serverAccountId: document.getElementById('serverAccountId'),
    connectBtn: document.getElementById('connect'),
    disconnectBtn: document.getElementById('disconnect'),
    testBtn: document.getElementById('testConnection'),
    statusDiv: document.getElementById('status'),
    statusText: document.getElementById('statusText'),
    testResults: document.getElementById('testResults')
  };
  
  // Load saved config
  chrome.storage.local.get(['jazzConfig'], (data) => {
    if (data.jazzConfig) {
      elements.syncServer.value = data.jazzConfig.syncServer || '';
      elements.accountId.value = data.jazzConfig.accountId || '';
      elements.accountSecret.value = data.jazzConfig.accountSecret || '';
      elements.serverAccountId.value = data.jazzConfig.serverAccountId || '';
    }
  });
  
  // Check connection status
  async function updateStatus() {
    chrome.runtime.sendMessage({ type: 'GET_JAZZ_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error getting status:', chrome.runtime.lastError);
        return;
      }
      
      if (response && response.connected) {
        elements.statusDiv.className = 'status connected';
        elements.statusText.textContent = 'Connected to Jazz';
        elements.connectBtn.style.display = 'none';
        elements.disconnectBtn.style.display = 'inline-block';
      } else {
        elements.statusDiv.className = 'status disconnected';
        elements.statusText.textContent = 'Not connected';
        elements.connectBtn.style.display = 'inline-block';
        elements.disconnectBtn.style.display = 'none';
      }
    });
  }
  
  // Initial status check
  updateStatus();
  setInterval(updateStatus, 2000);
  
  // Connect button
  elements.connectBtn.addEventListener('click', async () => {
    const config = {
      syncServer: elements.syncServer.value,
      accountId: elements.accountId.value,
      accountSecret: elements.accountSecret.value,
      serverAccountId: elements.serverAccountId.value
    };
    
    // Validate
    if (!config.accountId || !config.accountSecret) {
      alert('Please enter Account ID and Secret');
      return;
    }
    
    elements.statusText.textContent = 'Connecting...';
    
    // Save and connect
    chrome.runtime.sendMessage({
      type: 'CONFIGURE_JAZZ',
      config: config
    }, (response) => {
      if (response && response.success) {
        elements.statusText.textContent = 'Connected!';
        setTimeout(updateStatus, 1000);
      } else {
        elements.statusText.textContent = 'Connection failed';
        alert('Failed to connect: ' + (response?.error || 'Unknown error'));
      }
    });
  });
  
  // Disconnect button
  elements.disconnectBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'DISCONNECT_JAZZ' }, (response) => {
      if (response && response.success) {
        elements.statusText.textContent = 'Disconnected';
        setTimeout(() => location.reload(), 500);
      }
    });
  });
  
  // Test connection
  elements.testBtn.addEventListener('click', async () => {
    elements.testResults.style.display = 'block';
    elements.testResults.textContent = 'Testing connection...\\n';
    
    // Test 1: Check service worker
    chrome.runtime.sendMessage({ type: 'GET_JAZZ_STATUS' }, (response) => {
      elements.testResults.textContent += '✓ Service worker responding\\n';
      elements.testResults.textContent += '  Connected: ' + (response?.connected || false) + '\\n';
      
      // Test 2: Check storage
      chrome.storage.sync.get('_servers_list', (data) => {
        const serverCount = Object.keys(data._servers_list || {}).length;
        elements.testResults.textContent += '✓ Proxy storage accessible\\n';
        elements.testResults.textContent += '  Servers: ' + serverCount + '\\n';
      });
    });
  });
});
`;
  
  fs.writeFileSync(path.join(MODIFIED_DIR, 'options.html'), optionsHtml);
  fs.writeFileSync(path.join(MODIFIED_DIR, 'options.js'), optionsJs);
  
  // 5. Update manifest
  manifest.permissions = manifest.permissions || [];
  if (!manifest.permissions.includes('storage')) {
    manifest.permissions.push('storage');
  }
  
  // Add host permissions for WebSocket
  if (manifest.manifest_version === 3) {
    manifest.host_permissions = manifest.host_permissions || [];
    manifest.host_permissions.push(
      "ws://localhost/*",
      "wss://localhost/*"
    );
  } else {
    if (!manifest.permissions.includes("ws://localhost/*")) {
      manifest.permissions.push("ws://localhost/*", "wss://localhost/*");
    }
  }
  
  // Add options page
  manifest.options_page = 'options.html';
  
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  
  console.log('✅ Extension modified with Jazz for service workers!');
  console.log(`📁 Modified extension in: ${path.resolve(MODIFIED_DIR)}`);
  console.log('\n📋 Next steps:');
  console.log('1. Load extension from Chrome');
  console.log('2. Open extension options');
  console.log('3. Configure Jazz connection');
  console.log('4. Start Jazz server: npm run start-jazz-server');
}

modifyExtensionWithJazzV3().catch(console.error);