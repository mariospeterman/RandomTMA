# Telegram Mini App with TON Integration

This project is a Telegram Mini App (TMA) with TON blockchain integration, allowing users to connect their TON wallets and make subscription payments.

## Features

- Telegram Mini App integration
- Automatic user authentication via Telegram
- TON Connect wallet integration
- Subscription payment system (monthly/yearly)
- Support for both testnet and mainnet
- WebSocket/Socket.io for real-time communication

## Requirements

- Node.js v16 or later
- A Telegram bot with Mini App functionality enabled
- TON wallet for testing (Tonkeeper, TON Wallet, etc.)
- TONCenter API key for transaction verification

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/your-repo-name.git
cd your-repo-name
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the `.env.example` file to `.env` and configure the required variables:

```bash
cp .env.example .env
```

Then edit the `.env` file with your details:

```
# Telegram Mini App Configuration
TELEGRAM_BOT_TOKEN="YOUR_TELEGRAM_BOT_TOKEN"
VITE_TELEGRAM_BOT_TOKEN="YOUR_TELEGRAM_BOT_TOKEN"
VITE_TELEGRAM_BOT_USERNAME="YOUR_BOT_USERNAME"

# TON Connect Configuration
VITE_TON_MANIFEST_URL="https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/public/tonconnect-manifest.json"

# Network Configuration (testnet or mainnet)
VITE_TON_NETWORK="testnet"

# TON API Access
TONCENTER_TOKEN="YOUR_TONCENTER_API_KEY"

# Payment Configuration
VITE_MERCHANT_WALLET="YOUR_MERCHANT_WALLET_ADDRESS"

# Subscription settings
VITE_SUBSCRIPTION_AMOUNT_MONTHLY="1"
VITE_SUBSCRIPTION_AMOUNT_YEARLY="10"

# Server settings
PORT=5000
NODE_ENV="development"

# Session security
SESSION_SECRET="REPLACE_WITH_RANDOM_SECRET_STRING"
```

### 4. Configure TON Connect Manifest

The TON Connect manifest file is located at `public/tonconnect-manifest.json`. Update it with your app details:

```json
{
  "url": "https://your-tma-domain.com",
  "name": "Your TMA Name",
  "iconUrl": "https://your-tma-domain.com/icon.png",
  "termsOfUseUrl": "https://your-tma-domain.com/terms",
  "privacyPolicyUrl": "https://your-tma-domain.com/privacy",
  
  "permissions": [
    "tonAddress"
  ],
  
  "platforms": [
    "ios",
    "android",
    "web"
  ],
  
  "telegram_app_url": "https://t.me/YOUR_BOT_USERNAME/app",
  "telegram_bot_username": "YOUR_BOT_USERNAME"
}
```

### 5. Set up your Telegram Bot

1. Create a new bot with [@BotFather](https://t.me/BotFather)
2. Get your bot token
3. Enable the Mini App feature for your bot:
   - Send `/mybots` to BotFather
   - Select your bot
   - Go to "Bot Settings" > "Menu Button" and set it to your app URL

## Development

### Start in development mode

```bash
npm run dev
```

This will start the development server at http://localhost:5000.

### Build for production

```bash
npm run build
```

### Start in production mode

```bash
npm run start
```

## Testing Payments

1. Connect your TON wallet through the app
2. Select a subscription plan
3. Complete the payment process
4. Transaction will be automatically verified
   - If using testnet, no real TON will be spent

## Deployment

1. Deploy to your preferred hosting service
2. Set all environment variables in your hosting dashboard
3. Configure the TON Connect manifest URL to point to your deployed site
4. Update your Telegram Bot to link to your deployed mini app

## License

MIT

## Credits

- [TMA.js SDK](https://github.com/tma-js/sdk)
- [TON Connect SDK](https://github.com/ton-connect/sdk)
- [TON Core](https://github.com/ton-core/ton-core)