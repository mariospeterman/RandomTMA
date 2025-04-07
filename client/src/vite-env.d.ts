/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TON_MANIFEST_URL: string;
  readonly VITE_TON_NETWORK: string;
  readonly VITE_MERCHANT_WALLET: string;
  readonly VITE_SUBSCRIPTION_AMOUNT_MONTHLY: string;
  readonly VITE_SUBSCRIPTION_AMOUNT_YEARLY: string;
  readonly VITE_TELEGRAM_BOT_TOKEN: string;
  readonly VITE_TELEGRAM_BOT_USERNAME: string;
  readonly MODE: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
} 