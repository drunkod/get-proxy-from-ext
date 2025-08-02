// options.js
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

  // Check server availability
  async function checkServer(url) {
    try {
      const ws = new WebSocket(url);
      return new Promise((resolve) => {
        ws.onopen = () => {
          ws.close();
          resolve(true);
        };
        ws.onerror = () => resolve(false);
        setTimeout(() => {
          ws.close();
          resolve(false);
        }, 3000);
      });
    } catch {
      return false;
    }
  }

  // Check both servers
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

  // Server picker
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

  // Load saved config
  const { jazzConfig } = await chrome.storage.local.get('jazzConfig');
  if (jazzConfig) {
    elements.syncServer.value = jazzConfig.syncServer || 'ws://127.0.0.1:4200';
    elements.accountId.value = jazzConfig.accountId || '';
    elements.accountSecret.value = jazzConfig.accountSecret || '';
    elements.serverAccountId.value = jazzConfig.serverAccountId || '';
  }

  // Initial server check
  checkServers();

  // Update status
  async function updateStatus() {
    chrome.runtime.sendMessage({ type: 'GET_JAZZ_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
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

  // Initial status check
  updateStatus();
  setInterval(updateStatus, 2000);

  // Test connection button
  elements.testBtn.addEventListener('click', async () => {
    elements.testBtn.disabled = true;
    elements.statusText.textContent = 'Testing connection...';

    await checkServers();

    const serverUrl = elements.syncServer.value;
    const isAvailable = await checkServer(serverUrl);

    if (isAvailable) {
      elements.statusText.textContent = `✅ Server ${serverUrl} is reachable`;
    } else {
      elements.statusText.textContent = `❌ Cannot reach ${serverUrl}`;
    }

    elements.testBtn.disabled = false;
  });

  // Connect
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

    chrome.runtime.sendMessage({
      type: 'CONFIGURE_JAZZ',
      config: config
    }, (response) => {
      elements.connectBtn.disabled = false;
      if (response?.success) {
        elements.statusText.textContent = 'Connected!';
      } else {
        alert('Connection failed. Check server availability.');
      }
    });
  });

  // Other handlers remain the same...
  elements.disconnectBtn.addEventListener('click', () => {
    chrome.storage.local.remove('jazzConfig', () => {
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
});
