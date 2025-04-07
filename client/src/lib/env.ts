// Environment variables for client-side code
// These must be prefixed with VITE_ in .env to be exposed to the client

// Get the TON_MANIFEST_URL directly from Replit secrets
export const TON_MANIFEST_URL = import.meta.env.TON_MANIFEST_URL;

// If no TON_MANIFEST_URL is available, use a fallback for development
if (!TON_MANIFEST_URL) {
  console.warn('TON_MANIFEST_URL environment variable is not set. Using fallback URL for development only.');
}

// Enable debugging for environment variables in development
if (import.meta.env.DEV) {
  console.log('Environment mode:', import.meta.env.MODE);
  console.log('TON_MANIFEST_URL being used:', TON_MANIFEST_URL || 'Not set');
}

// Telegram settings - get from environment or use defaults
export const TELEGRAM_BOT_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN;
export const TELEGRAM_BOT_USERNAME = 'TingleTonBot';
export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;

// Log Telegram configuration in development
if (import.meta.env.DEV) {
  console.log('TELEGRAM_BOT_TOKEN available:', !!TELEGRAM_BOT_TOKEN);
  console.log('TELEGRAM_BOT_URL:', TELEGRAM_BOT_URL);
}