// e2e/extension-src/options.js
document.addEventListener('DOMContentLoaded', async () => {
  // Enable debug mode
  const DEBUG = true;
  const log = (msg, ...args) => {
    if (DEBUG) console.log(`[Options] ${msg}`, ...args);
  };

  const elements = {
    syncServer: document.getElementById('syncServer'),
    accountId: document.getElementById('accountId'),
    accountSecret: document.getElementById('accountSecret'),
    serverAccountId: document.getElementById('serverAccountId'),
    connectBtn: document.getElementById('connect'),
    disconnectBtn: document.getElementById('disconnect'),
    forcePushBtn: document.getElementById('forcePush'),
    testBtn: document.getElementById('testConnection'),
    statusDiv: document.getElementById('status'),
    statusText: document.getElementById('statusText'),
    localServer: document.getElementById('localServer'),
    remoteServer: document.getElementById('remoteServer'),
    localStatus: document.getElementById('localStatus'),
    remoteStatus: document.getElementById('remoteStatus'),
    serverWarning: document.getElementById('serverWarning')
  };

  const viewerElements = {
    toggleBtn: document.getElementById('viewerToggle'),
    container: document.getElementById('viewerContainer'),
    loading: document.getElementById('viewerLoading'),
    error: document.getElementById('viewerError'),
    content: document.getElementById('viewerContent'),
    totalConfigs: document.getElementById('totalConfigs'),
    validProxies: document.getElementById('validProxies'),
    lastUpdate: document.getElementById('lastUpdate'),
    configContent: document.getElementById('configContent'),
    serversGrid: document.getElementById('serversGrid'),
    copyBtn: document.getElementById('copyBtn'),
    refreshBtn: document.getElementById('refreshV2ray'),
    toast: document.getElementById('toast'),
  };

  let viewerVisible = false;
  let viewerInterval = null;
  let currentV2rayConfigJson = null;

  viewerElements.toggleBtn.addEventListener('click', () => {
    log('V2Ray viewer toggle clicked');
    viewerVisible = !viewerVisible;
    viewerElements.container.style.display = viewerVisible ? 'block' : 'none';
    viewerElements.toggleBtn.textContent = viewerVisible ? 'Hide V2Ray Config Viewer' : 'Show V2Ray Config Viewer';
    if (viewerVisible) {
      log('Opening V2Ray viewer, fetching configs...');
      fetchV2rayConfigs();
      viewerInterval = setInterval(fetchV2rayConfigs, 30000);
    } else {
      log('Closing V2Ray viewer');
      clearInterval(viewerInterval);
    }
  });

  viewerElements.refreshBtn.addEventListener('click', () => {
    log('Manual refresh clicked');
    fetchV2rayConfigs();
  });

  function fetchV2rayConfigs() {
    log('Fetching V2Ray configs...');
    viewerElements.loading.style.display = 'block';
    viewerElements.error.style.display = 'none';
    viewerElements.content.style.display = 'none';

    // Add timeout to prevent hanging
    const timeoutId = setTimeout(() => {
      log('Request timed out after 10 seconds');
      viewerElements.loading.style.display = 'none';
      viewerElements.error.style.display = 'block';
      viewerElements.error.textContent = 'Error: Request timed out. Is the extension background script running?';
    }, 10000);

    chrome.runtime.sendMessage({ type: 'FETCH_V2RAY_CONFIGS' }, (response) => {
        clearTimeout(timeoutId);
        viewerElements.loading.style.display = 'none';

        if (chrome.runtime.lastError) {
            log('Chrome runtime error:', chrome.runtime.lastError);
            viewerElements.error.style.display = 'block';
            viewerElements.error.textContent = `Error: ${chrome.runtime.lastError.message}`;
            return;
        }

        log('Received response:', response);

        if (!response) {
            log('Empty response received');
            viewerElements.error.style.display = 'block';
            viewerElements.error.textContent = 'Error: Empty response from background script. The service worker might have crashed.';
            return;
        }

        if (response.error) {
            log('Error in response:', response.error);
            viewerElements.error.style.display = 'block';
            viewerElements.error.textContent = `Error: ${response.error}`;
        } else {
            log('Successfully received V2Ray data');
            viewerElements.content.style.display = 'block';
            displayV2rayData(response);
        }
    });
  }

  function displayV2rayData(data) {
    log('Displaying V2Ray data:', data);
    viewerElements.totalConfigs.textContent = data.totalConfigs || 0;
    if (data.latestConfig) {
      viewerElements.validProxies.textContent = data.latestConfig.validProxies;
      viewerElements.lastUpdate.textContent = new Date(data.latestConfig.generatedAt).toLocaleTimeString();
      currentV2rayConfigJson = JSON.stringify(data.latestConfig.config, null, 2);
      viewerElements.configContent.textContent = currentV2rayConfigJson;
      displayV2rayServers(data.latestConfig.servers);
    } else {
      viewerElements.validProxies.textContent = '0';
      viewerElements.lastUpdate.textContent = 'Never';
      viewerElements.configContent.textContent = 'No configuration available yet.';
    }
  }

  function displayV2rayServers(servers) {
    log(`Displaying ${servers?.length || 0} servers`);
    const grid = viewerElements.serversGrid;
    grid.innerHTML = '';
    if (!servers || servers.length === 0) {
      grid.innerHTML = '<p>No active servers in the latest build.</p>';
      return;
    }
    servers.forEach(server => {
      const card = document.createElement('div');
      card.className = 'server-card';
      card.innerHTML = `
        <div class="server-name">${server.name || 'Unknown Proxy'}</div>
        <div><strong>Host:</strong> ${server.host}:${server.port}</div>
        <div><strong>Protocol:</strong> ${server.host.includes('socks') ? 'SOCKS' : 'HTTP'}</div>
      `;
      grid.appendChild(card);
    });
  }

  viewerElements.copyBtn.addEventListener('click', () => {
    if (!currentV2rayConfigJson) {
      log('No config to copy');
      return;
    }
    navigator.clipboard.writeText(currentV2rayConfigJson).then(() => {
      log('Config copied to clipboard');
      viewerElements.toast.style.display = 'block';
      setTimeout(() => { viewerElements.toast.style.display = 'none'; }, 2000);
    });
  });

  window.addEventListener('beforeunload', () => {
      log('Page unloading, cleaning up...');
      if (viewerInterval) {
          clearInterval(viewerInterval);
      }
  });

  const { jazzConfig } = await chrome.storage.local.get('jazzConfig');
  log('Loaded Jazz config:', jazzConfig ? 'Found' : 'Not found');
  if (jazzConfig) {
    elements.syncServer.value = jazzConfig.syncServer || 'ws://127.0.0.1:4200';
    elements.accountId.value = jazzConfig.accountId || '';
    elements.accountSecret.value = jazzConfig.accountSecret || '';
    elements.serverAccountId.value = jazzConfig.serverAccountId || '';
  }

  checkServers();
  updateStatus();
  setInterval(updateStatus, 2000);

  elements.testBtn.addEventListener('click', async () => {
    log('Testing connection...');
    elements.testBtn.disabled = true;
    elements.statusText.textContent = 'Testing connection...';
    await checkServers();
    const serverUrl = elements.syncServer.value;
    const isAvailable = await checkServer(serverUrl);
    log(`Server ${serverUrl} is ${isAvailable ? 'available' : 'unavailable'}`);
    elements.statusText.textContent = isAvailable ? `✅ Server ${serverUrl} is reachable` : `❌ Cannot reach ${serverUrl}`;
    elements.testBtn.disabled = false;
  });

  elements.connectBtn.addEventListener('click', async () => {
    const config = {
      syncServer: elements.syncServer.value,
      accountId: elements.accountId.value.trim(),
      accountSecret: elements.accountSecret.value.trim(),
      serverAccountId: elements.serverAccountId.value.trim()
    };

    log('Connecting with config:', { ...config, accountSecret: '***' });

    if (!config.accountId || !config.accountSecret || !config.serverAccountId) {
      alert('Please fill in all fields');
      return;
    }

    elements.connectBtn.disabled = true;
    elements.statusText.textContent = 'Connecting...';

    chrome.runtime.sendMessage({ type: 'CONFIGURE_JAZZ', config: config }, (response) => {
        log('Connect response:', response);
        elements.connectBtn.disabled = false;
        if (response?.success) {
            updateStatus();
        } else {
            alert(`Connection failed: ${response?.error || 'Check console for details.'}`);
            updateStatus();
        }
    });
  });

  elements.disconnectBtn.addEventListener('click', () => {
    log('Disconnecting...');
    chrome.runtime.sendMessage({ type: 'DISCONNECT_JAZZ' }, () => {
      log('Disconnected, reloading page...');
      location.reload();
    });
  });

  elements.forcePushBtn.addEventListener('click', () => {
    log('Force pushing...');
    chrome.runtime.sendMessage({ type: 'FORCE_PUSH' }, (response) => {
      log('Force push response:', response);
      if (response?.success) {
        elements.statusText.textContent = 'Push sent!';
        setTimeout(updateStatus, 1000);
      }
    });
  });

  elements.localServer.addEventListener('click', () => {
    if (!elements.localServer.classList.contains('offline')) {
      log('Selected local server');
      elements.syncServer.value = elements.localServer.dataset.url;
      elements.localServer.classList.add('selected');
      elements.remoteServer.classList.remove('selected');
    }
  });

  elements.remoteServer.addEventListener('click', () => {
    if (!elements.remoteServer.classList.contains('offline')) {
      log('Selected remote server');
      elements.syncServer.value = elements.remoteServer.dataset.url;
      elements.remoteServer.classList.add('selected');
      elements.localServer.classList.remove('selected');
    }
  });

  async function checkServer(url) {
    try {
      const ws = new WebSocket(url);
      return new Promise((resolve) => {
        ws.onopen = () => { ws.close(); resolve(true); };
        ws.onerror = () => resolve(false);
        setTimeout(() => { if (ws.readyState !== 1) { ws.close(); resolve(false); } }, 2000);
      });
    } catch { return false; }
  }

  async function checkServers() {
    log('Checking server availability...');
    const localAvailable = await checkServer('ws://127.0.0.1:4200');
    const remoteAvailable = await checkServer('ws://node205197-env-9764176354321.mircloud.host:11129');
    log(`Local server: ${localAvailable ? 'Online' : 'Offline'}, Remote server: ${remoteAvailable ? 'Online' : 'Offline'}`);
    elements.localStatus.textContent = localAvailable ? '✅ Online' : '❌ Offline';
    elements.remoteStatus.textContent = remoteAvailable ? '✅ Online' : '❌ Offline';
    elements.localServer.classList.toggle('offline', !localAvailable);
    elements.remoteServer.classList.toggle('offline', !remoteAvailable);
    if (!remoteAvailable && elements.syncServer.value.includes('mircloud')) {
      elements.serverWarning.style.display = 'block';
    }
  }

  function updateStatus() {
    chrome.runtime.sendMessage({ type: 'GET_JAZZ_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        log('Status check error:', chrome.runtime.lastError);
        return;
      }
      if (response?.connected) {
        elements.statusDiv.className = 'status connected';
        elements.statusText.textContent = `Connected (Account: ${response.accountId || 'unknown'})`;
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

  log('Options page initialized');
});
