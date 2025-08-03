// e2e/extension-src/modules/eventListeners.js
import { initializeJazz, pushProxyUpdate, getJazzStatus } from "./jazzService.js";

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
        switch (request.type) {
            case 'CONFIGURE_JAZZ':
                chrome.storage.local.set({ jazzConfig: request.config }, () => {
                    initializeJazz().then(() => sendResponse({ success: true }));
                });
                return true; // Indicates an asynchronous response

            case 'GET_JAZZ_STATUS':
                sendResponse(getJazzStatus());
                break;

            case 'FORCE_PUSH':
                pushProxyUpdate(true).then(() => sendResponse({ success: true }));
                return true; // Indicates an asynchronous response
        }
    });
}
