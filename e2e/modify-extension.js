// e2e/modify-extension.js
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import AdmZip from 'adm-zip';

const EXTENSION_ZIP = 'hide-me-Chrome-Chrome.zip';
const MODIFIED_DIR = '.modified-extension';
const WEBHOOK_URL = 'http://localhost:3000/proxy-update';

async function modifyExtension() {
  console.log('🔧 Starting extension modification...');
  
  // Step 1: Clean previous build
  if (fs.existsSync(MODIFIED_DIR)) {
    fs.rmSync(MODIFIED_DIR, { recursive: true });
  }
  fs.mkdirSync(MODIFIED_DIR);
  
  // Step 2: Extract extension
  console.log('📦 Extracting extension...');
  const zip = new AdmZip(EXTENSION_ZIP);
  zip.extractAllTo(MODIFIED_DIR, true);
  
  // Step 3: Find and modify background script
  const manifestPath = path.join(MODIFIED_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  // Handle different manifest versions
  let backgroundScripts = [];
  if (manifest.manifest_version === 2) {
    backgroundScripts = manifest.background?.scripts || [];
  } else if (manifest.manifest_version === 3) {
    if (manifest.background?.service_worker) {
      backgroundScripts = [manifest.background.service_worker];
    }
  }
  
  console.log('🔍 Found background scripts:', backgroundScripts);
  
  // Step 4: Add webhook code to background scripts
  const webhookCode = `
// === INJECTED PROXY WEBHOOK CODE ===
(function() {
  console.log('[Proxy Webhook] Initializing...');
  
  const WEBHOOK_URL = '${WEBHOOK_URL}';
  let lastProxyData = null;
  
  // Function to send proxy data
  async function sendProxyData(data) {
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          servers: data,
          timestamp: new Date().toISOString(),
          extensionId: chrome.runtime.id
        })
      });
      
      if (response.ok) {
        console.log('[Proxy Webhook] Data sent successfully');
      } else {
        console.error('[Proxy Webhook] Failed to send data:', response.status);
      }
    } catch (error) {
      console.error('[Proxy Webhook] Error sending data:', error);
    }
  }
  
  // Monitor storage changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes._servers_list && namespace === 'sync') {
      console.log('[Proxy Webhook] Detected proxy update');
      const newData = changes._servers_list.newValue;
      
      // Only send if data actually changed
      if (JSON.stringify(newData) !== JSON.stringify(lastProxyData)) {
        lastProxyData = newData;
        sendProxyData(newData);
      }
    }
  });
  
  // Send initial data on startup
  chrome.storage.sync.get('_servers_list', (data) => {
    if (data._servers_list) {
      console.log('[Proxy Webhook] Sending initial proxy data');
      lastProxyData = data._servers_list;
      sendProxyData(data._servers_list);
    }
  });
  
  // // Periodic sync (every 30 seconds)
  // setInterval(() => {
  //   chrome.storage.sync.get('_servers_list', (data) => {
  //     if (data._servers_list) {
  //       const currentData = JSON.stringify(data._servers_list);
  //       if (currentData !== JSON.stringify(lastProxyData)) {
  //         console.log('[Proxy Webhook] Periodic sync found changes');
  //         lastProxyData = data._servers_list;
  //         sendProxyData(data._servers_list);
  //       }
  //     }
  //   });
  // }, 30000);
  
  console.log('[Proxy Webhook] Initialized successfully');
})();
// === END INJECTED CODE ===

`;
  
  // Inject code into each background script
  for (const scriptPath of backgroundScripts) {
    const fullPath = path.join(MODIFIED_DIR, scriptPath);
    if (fs.existsSync(fullPath)) {
      console.log(`💉 Injecting webhook into ${scriptPath}...`);
      const originalCode = fs.readFileSync(fullPath, 'utf8');
      const modifiedCode = webhookCode + '\n' + originalCode;
      fs.writeFileSync(fullPath, modifiedCode);
    }
  }
  
  // Step 5: Update manifest to allow localhost connection
  if (!manifest.host_permissions) {
    manifest.host_permissions = [];
  }
  if (!manifest.host_permissions.includes('http://localhost/*')) {
    manifest.host_permissions.push('http://localhost/*');
  }
  
  // For manifest v2
  if (manifest.manifest_version === 2) {
    if (!manifest.permissions) manifest.permissions = [];
    if (!manifest.permissions.includes('http://localhost/*')) {
      manifest.permissions.push('http://localhost/*');
    }
  }
  
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('✅ Updated manifest permissions');
  
  // Step 6: Create info file
  const infoContent = `
Modified Extension Info
======================
Original: ${EXTENSION_ZIP}
Modified: ${new Date().toISOString()}
Webhook URL: ${WEBHOOK_URL}

Changes made:
1. Added webhook to send proxy updates to local server
2. Added localhost permission to manifest
3. Monitors chrome.storage.sync for '_servers_list' changes
4. Sends updates every 30 seconds if data changed

To install:
1. Open chrome://extensions
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the ${MODIFIED_DIR} folder
`;
  
  fs.writeFileSync(path.join(MODIFIED_DIR, 'MODIFICATION_INFO.txt'), infoContent);
  
  console.log('\n✅ Extension modified successfully!');
  console.log(`📁 Modified extension in: ${path.resolve(MODIFIED_DIR)}`);
}

// Run modification
modifyExtension().catch(console.error);