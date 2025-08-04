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

        const messageHandlers = {
            'CONFIGURE_JAZZ': async (request) => {
                console.log('[Extension] Configuring Jazz...');
                await new Promise(resolve => chrome.storage.local.set({ jazzConfig: request.config }, resolve));
                return await initializeJazz();
            },
            'DISCONNECT_JAZZ': async () => {
                console.log('[Extension] Disconnecting Jazz...');
                await disconnectJazz();
                return { success: true };
            },
            'GET_JAZZ_STATUS': () => {
                return getJazzStatus();
            },
            'FORCE_PUSH': async () => {
                console.log('[Extension] Force pushing proxy update...');
                await pushProxyUpdate(true);
                return { success: true };
            },
            'FETCH_V2RAY_CONFIGS': async () => {
                console.log('[Extension] Fetching V2Ray configs...');
                return await fetchV2RayConfigs();
            }
        };

        const handler = messageHandlers[request.type];

        if (handler) {
            (async () => {
                try {
                    const response = await handler(request);
                    console.log(`[Extension] Responding to ${request.type}:`, response);
                    sendResponse(response);
                } catch (error) {
                    console.error(`[Extension] Error handling message ${request.type}:`, error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true; // Indicates an asynchronous response
        } else {
            console.warn(`[Extension] Unhandled message type: ${request.type}`);
        }
    });
}
