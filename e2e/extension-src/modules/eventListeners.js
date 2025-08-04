// e2e/extension-src/modules/eventListeners.js
import { initializeJazz, pushProxyUpdate, getJazzStatus, fetchV2RayConfigs, disconnectJazz } from "./jazzService.js";

/**
 * Sets up all Chrome event listeners for the extension.
 */
export function setupEventListeners() {
    // Listen for installation or update
    chrome.runtime.onInstalled.addListener(() => {
        console.log("[Extension] Installed/Updated");
        initializeJazz();
    });

    // Listen for browser startup
    chrome.runtime.onStartup.addListener(() => {
        console.log("[Extension] Browser startup");
        initializeJazz();
    });

    // Watch for changes in proxy data
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (changes._servers_list && namespace === 'sync') {
            console.log("[Extension] Proxy data changed");
            pushProxyUpdate();
        }
    });

    // Handle messages from the options page or other parts of the extension
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log(`[Extension] Received message: ${request.type}`, { request, sender: sender?.tab?.url || "background" });

        switch (request.type) {
            case 'CONFIGURE_JAZZ':
                console.log('[Extension] Configuring Jazz...');
                chrome.storage.local.set({ jazzConfig: request.config }, () => {
                    initializeJazz().then((result) => {
                        console.log('[Extension] Jazz init result:', result);
                        sendResponse(result);
                    });
                });
                return true; // Indicates an asynchronous response

            case 'DISCONNECT_JAZZ':
                console.log('[Extension] Disconnecting Jazz...');
                disconnectJazz().then(() => {
                    console.log('[Extension] Jazz disconnected');
                    sendResponse({success: true});
                });
                return true;

            case 'GET_JAZZ_STATUS':
                const status = getJazzStatus();
                console.log('[Extension] Responding with Jazz status:', status);
                sendResponse(status);
                break;

            case 'FORCE_PUSH':
                console.log('[Extension] Force pushing proxy update...');
                pushProxyUpdate(true).then(() => {
                    console.log('[Extension] Force push complete.');
                    sendResponse({ success: true });
                });
                return true;

            case 'FETCH_V2RAY_CONFIGS':
                console.log('[Extension] Fetching V2Ray configs...');
                fetchV2RayConfigs().then(response => {
                    console.log('[Extension] Responding with V2Ray fetch result:', response);
                    sendResponse(response);
                });
                return true; // Crucial for async response

            default:
                console.warn(`[Extension] Unhandled message type: ${request.type}`);
                break;
        }
    });
}
