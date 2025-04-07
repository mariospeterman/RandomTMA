import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupSocketServer } from "./socket";
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';

export async function registerRoutes(app: Express): Promise<Server> {
  // Create HTTP server
  const httpServer = createServer(app);
  
  // Setup Socket.io server for WebRTC signaling
  const io = setupSocketServer(httpServer);
  
  // Create WebSocket server for direct communication between peers
  // Note: Using a separate path from Vite's HMR WebSocket
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws' 
  });
  
  // Handle WebSocket connections
  wss.on('connection', (ws) => {
    console.log('WebSocket client connected to /ws endpoint');
    
    ws.on('message', (message) => {
      try {
        // Parse the message (expecting JSON)
        const data = JSON.parse(message.toString());
        console.log('WebSocket message received:', data.type);
        
        // Handle message based on type
        if (data.type === 'identity') {
          // Handle identity registration
          console.log('WebSocket identity registered:', data.identity);
          
          // Echo back confirmation
          ws.send(JSON.stringify({
            type: 'identity_confirmed',
            success: true
          }));
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
      }
    });
    
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
    
    // Send initial welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      message: 'Connected to Tingle WebSocket server'
    }));
  });
  
  // API endpoints
  app.get("/api/status", (req, res) => {
    res.json({ 
      status: "online", 
      connections: io.engine.clientsCount,
      features: {
        webrtc: true,
        webSocket: true,
        tonConnect: true,
        telegramConnect: true
      }
    });
  });

  return httpServer;
}
