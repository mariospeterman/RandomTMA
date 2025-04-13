# Production Deployment Guide

This guide provides instructions for deploying the Random Video Chat app in a production environment.

## 1. Setting Up Your TURN Server

For production, set up your own TURN server:

### Using Coturn

```bash
# Install Coturn
sudo apt update
sudo apt install coturn

# Edit configuration
sudo nano /etc/turnserver.conf
```

Basic configuration:
```
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=your_strong_secret_here
realm=yourdomain.com
server-name=yourdomain.com
cert=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
pkey=/etc/letsencrypt/live/yourdomain.com/privkey.pem
```

Start the service:
```bash
sudo systemctl enable coturn
sudo systemctl start coturn
```

## 2. Socket.IO Scaling with Redis

```bash
# Install Redis
sudo apt install redis-server

# Install the adapter
npm install @socket.io/redis-adapter redis

# Update socket.ts to use Redis
```

```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

// In setupSocketServer function
const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  const io = new Server(httpServer, {
    adapter: createAdapter(pubClient, subClient),
    // ... existing options
  });
});
```

## 3. Environment Configuration

Update `.env.production` with:
- TURN server credentials
- Socket.IO settings
- Telegram Bot tokens

## 4. Building and Deployment

```bash
# Install dependencies
npm install

# Build
npm run build

# Use PM2 for process management
npm install -g pm2
pm2 start ecosystem.config.js
pm2 startup
pm2 save
```

## 5. Nginx Configuration

```nginx
upstream videochat_backend {
    hash $remote_addr consistent;
    server 127.0.0.1:5000;
    server 127.0.0.1:5001;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    location / {
        proxy_pass http://videochat_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
    
    location /socket.io/ {
        proxy_pass http://videochat_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## 6. Troubleshooting

- Check TURN server logs: `sudo tail -f /var/log/turnserver/turnserver.log`
- Test ICE connectivity with [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
- Check browser console for WebRTC errors 