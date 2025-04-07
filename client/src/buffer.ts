/**
 * This file explicitly exports Buffer to be used anywhere in the project.
 * Importing this file ensures Buffer is available in the import location.
 */

import { Buffer } from 'buffer';

// Add Buffer to the global scope
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
}

// Make sure globalThis has Buffer too
(globalThis as any).Buffer = Buffer;

// Export Buffer for direct imports
export { Buffer };