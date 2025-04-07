// Environment variables for client-side code
// These must be prefixed with VITE_ in .env to be exposed to the client

// Get environment variables from Vite
export const TON_MANIFEST_URL = import.meta.env.VITE_TON_MANIFEST_URL || '/tonconnect-manifest.json';
export const TON_NETWORK = import.meta.env.VITE_TON_NETWORK || 'testnet';
export const MERCHANT_WALLET = import.meta.env.VITE_MERCHANT_WALLET;
export const SUBSCRIPTION_AMOUNT_MONTHLY = import.meta.env.VITE_SUBSCRIPTION_AMOUNT_MONTHLY || '1';
export const SUBSCRIPTION_AMOUNT_YEARLY = import.meta.env.VITE_SUBSCRIPTION_AMOUNT_YEARLY || '10';

// If no TON_MANIFEST_URL is available, use a fallback for development
if (!import.meta.env.VITE_TON_MANIFEST_URL) {
  console.warn('⚠️ TON_MANIFEST_URL environment variable is not set. Using local manifest file.');
}

// Enable debugging for environment variables in development
if (import.meta.env.DEV) {
  console.log('🔧 Environment mode:', import.meta.env.MODE);
  console.log('📄 TON_MANIFEST_URL being used:', TON_MANIFEST_URL);
  console.log('🌍 TON_NETWORK:', TON_NETWORK);
  console.log('💰 MERCHANT_WALLET:', MERCHANT_WALLET || 'Not set');
  
  // Validate manifest URL
  fetch(TON_MANIFEST_URL)
    .then(response => {
      if (response.ok) {
        console.log('✅ TON Manifest accessible at:', TON_MANIFEST_URL);
        return response.json();
      } else {
        throw new Error(`Status: ${response.status}`);
      }
    })
    .then(data => {
      console.log('📋 Manifest content:', data);
    })
    .catch(error => {
      console.error('❌ Failed to load TON Manifest:', error);
      console.warn('⚠️ Try using a direct URL to your manifest file in .env: VITE_TON_MANIFEST_URL=http://localhost:5000/public/tonconnect-manifest.json');
    });
}

// Telegram settings - get from environment or use defaults
export const TELEGRAM_BOT_TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN;
export const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'TingleTonBot';
export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;

// Log Telegram configuration in development
if (import.meta.env.DEV) {
  console.log('🤖 TELEGRAM_BOT_TOKEN available:', !!TELEGRAM_BOT_TOKEN);
  console.log('👤 TELEGRAM_BOT_USERNAME:', TELEGRAM_BOT_USERNAME);
  console.log('🔗 TELEGRAM_BOT_URL:', TELEGRAM_BOT_URL);
}