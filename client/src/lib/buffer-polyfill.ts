// This file provides a Buffer polyfill for browser environments
// when using libraries that expect Node.js Buffer to be available

import { Buffer as BufferPolyfill } from 'buffer';

// Make Buffer available globally
if (typeof window !== 'undefined') {
  // Browser environment
  window.Buffer = BufferPolyfill;
  (window as any).global = window;
}

// For non-browser environments or SSR
if (typeof global !== 'undefined' && !global.Buffer) {
  (global as any).Buffer = BufferPolyfill;
}

// Expose Buffer constant globally for libraries like ton-core
(globalThis as any).Buffer = BufferPolyfill;

// Add Buffer to the global type
declare global {
  interface Window {
    Buffer: typeof BufferPolyfill;
  }
}