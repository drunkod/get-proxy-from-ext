// e2e/extension-src/options.js
document.addEventListener('DOMContentLoaded', async () => {
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
    viewerVisible = !viewerVisible;
    viewerElements.container.style.display = viewerVisible ? 'block' : 'none';
    viewerElements.toggleBtn.textContent = viewerVisible ? 'Hide V2Ray Config Viewer' : 'Show V2Ray Config Viewer';
    if (viewerVisible) {
      fetchV2rayConfigs();
      viewerInterval = setInterval(fetchV2rayConfigs, 30000);
    } else {
      clearInterval(viewerInterval);
    }
  });

  viewerElements.refreshBtn.addEventListener('click', fetchV2rayConfigs);

  function fetchV2rayConfigs() {
    viewerElements.loading.style.display = 'block';
    viewerElements.error.style.display = 'none';
    viewerElements.content.style.display = 'none';

    chrome.runtime.sendMessage({ type: 'FETCH_V2RAY_CONFIGS' }, (response) => {
        viewerElements.loading.style.display = 'none';

        if (chrome.runtime.lastError) {
            viewerElements.error.style.display = 'block';
            viewerElements.error.textContent = `Error: ${chrome.runtime.lastError.message}`;
            return;
        }

        if (response.error) {
            viewerElements.error.style.display = 'block';
            viewerElements.error.textContent = `Error: ${response.error}`;
        } else {
            viewerElements.content.style.display = 'block';
            displayV2rayData(response);
        }
    });
  }

  function displayV2rayData(data) {
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
    }
  }

  function displayV2rayServers(servers) {
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
    if (!currentV2rayConfigJson) return;
    navigator.clipboard.writeText(currentV2rayConfigJson).then(() => {
      viewerElements.toast.style.display = 'block';
      setTimeout(() => { viewerElements.toast.style.display = 'none'; }, 2000);
    });
  });

  window.addEventListener('beforeunload', () => {
      if (viewerInterval) {
          clearInterval(viewerInterval);
      }
  });

  const { jazzConfig } = await chrome.storage.local.get('jazzConfig');
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
    elements.testBtn.disabled = true;
    elements.statusText.textContent = 'Testing connection...';
    await checkServers();
    const serverUrl = elements.syncServer.value;
    const isAvailable = await checkServer(serverUrl);
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
    if (!config.accountId || !config.accountSecret || !config.serverAccountId) {
      alert('Please fill in all fields');
      return;
    }
    elements.connectBtn.disabled = true;
    elements.statusText.textContent = 'Connecting...';
    chrome.runtime.sendMessage({ type: 'CONFIGURE_JAZZ', config: config }, (response) => {
        elements.connectBtn.disabled = false;
        if (response?.success) {
            updateStatus();
        } else {
            alert(`Connection failed: ${response.error || 'Check console for details.'}`);
            updateStatus();
        }
    });
  });

  elements.disconnectBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'DISCONNECT_JAZZ' }, () => {
      location.reload();
    });
  });

  elements.forcePushBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'FORCE_PUSH' }, (response) => {
      if (response?.success) {
        elements.statusText.textContent = 'Push sent!';
        setTimeout(updateStatus, 1000);
      }
    });
  });

  elements.localServer.addEventListener('click', () => {
    if (!elements.localServer.classList.contains('offline')) {
      elements.syncServer.value = elements.localServer.dataset.url;
      elements.localServer.classList.add('selected');
      elements.remoteServer.classList.remove('selected');
    }
  });

  elements.remoteServer.addEventListener('click', () => {
    if (!elements.remoteServer.classList.contains('offline')) {
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
    const localAvailable = await checkServer('ws://127.0.0.1:4200');
    const remoteAvailable = await checkServer('ws://node205197-env-9764176354321.mircloud.host:11129');
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
      if (chrome.runtime.lastError) { return; }
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
});
