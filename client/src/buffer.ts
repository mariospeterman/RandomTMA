/**
 * This file explicitly exports Buffer to be used anywhere in the project.
 * Importing this file ensures Buffer is available in the import location.
 */

// Polyfill Buffer for browser
import { Buffer } from 'buffer';

// Make Buffer available globally
window.Buffer = Buffer;

// Polyfill Node.js global for libraries like simple-peer
if (typeof window !== 'undefined' && !window.global) {
  window.global = window;
}

// Export Buffer for direct imports
export { Buffer };