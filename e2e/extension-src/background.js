// e2e/extension-src/background.js
import { initializeJazz } from "./modules/jazzService.js";
import { setupEventListeners } from "./modules/eventListeners.js";

// Set up all event listeners for the extension's lifecycle and communication.
setupEventListeners();

// Initialize the Jazz connection when the extension is loaded.
initializeJazz();