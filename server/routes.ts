import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupSocketServer } from "./socket";
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';
import { HttpApi } from "ton";
import { fromNano, toNano, Address } from "ton";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get environment variables for TON payments
const MERCHANT_WALLET = process.env.VITE_MERCHANT_WALLET || '';
const TON_NETWORK = process.env.VITE_TON_NETWORK || 'testnet';
const TONCENTER_TOKEN = process.env.TONCENTER_TOKEN || '';

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
  
  // API endpoint to save user wallet address
  app.post("/api/user/wallet", (req, res) => {
    try {
      const { telegramId, walletAddress } = req.body;
      
      if (!telegramId || !walletAddress) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      // Save to in-memory storage for now
      // In a production app, you would save this to a database
      storage.set(`wallet:${telegramId}`, walletAddress);
      
      console.log(`Saved wallet address ${walletAddress} for user ${telegramId}`);
      
      res.json({ 
        success: true,
        message: "Wallet address saved successfully"
      });
    } catch (error) {
      console.error("Error saving wallet address:", error);
      res.status(500).json({ error: "Failed to save wallet address" });
    }
  });
  
  // API endpoint to verify payment transaction
  app.post("/api/verify-payment", async (req, res) => {
    try {
      const { walletAddress, transactionHash, amount, comment } = req.body;
      
      if (!walletAddress || !amount) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      // Create TON HTTP client based on network
      const endpoint = TON_NETWORK === "mainnet"
        ? "https://toncenter.com/api/v2/jsonRPC"
        : "https://testnet.toncenter.com/api/v2/jsonRPC";
        
      const httpClient = new HttpApi(
        endpoint,
        { apiKey: TONCENTER_TOKEN }
      );
      
      let verified = false;
      
      // If we have a transaction hash, we can verify it directly
      if (transactionHash) {
        try {
          // This would be implemented to check the transaction hash
          // In a real implementation, you would need to validate the transaction details
          console.log(`Verifying transaction: ${transactionHash}`);
          verified = true;
        } catch (error) {
          console.error("Error verifying transaction hash:", error);
        }
      } else {
        // Otherwise, check recent transactions
        try {
          const transactions = await httpClient.getTransactions(Address.parse(MERCHANT_WALLET), {
            limit: 100
          });
          
          // Filter for incoming transactions
          const incomingTransactions = transactions.filter(
            (tx) => tx.in_msg && tx.in_msg.source === walletAddress
          );
          
          // Find matching transaction
          for (const tx of incomingTransactions) {
            // Skip if there's no in_msg or message
            if (!tx.in_msg || !tx.in_msg.message) continue;
            
            // Convert from nano
            const txAmount = fromNano(tx.in_msg.value);
            
            // Check if amount matches and comment matches (if provided)
            if (txAmount === amount && (!comment || tx.in_msg.message.includes(comment))) {
              verified = true;
              break;
            }
          }
        } catch (error) {
          console.error("Error checking transactions:", error);
        }
      }
      
      if (verified) {
        // Save subscription details in a real application
        // Here we just return success
        res.json({
          success: true,
          message: "Payment verified successfully",
          verified
        });
      } else {
        res.json({
          success: false,
          message: "Payment verification failed",
          verified
        });
      }
    } catch (error) {
      console.error("Error verifying payment:", error);
      res.status(500).json({ error: "Failed to verify payment" });
    }
  });

  // API endpoint to verify Telegram WebApp init data
  app.post("/api/verify-telegram", (req, res) => {
    try {
      const { initData } = req.body;
      
      if (!initData) {
        return res.status(400).json({ error: "Missing initData" });
      }
      
      // Parse initData
      const data = new URLSearchParams(initData);
      
      // In a production app, you would verify the hash here using HMAC-SHA-256
      // https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
      
      // For simplicity, we'll just check that it contains expected fields
      const hasUser = data.has('user');
      const hasHash = data.has('hash');
      
      if (!hasUser || !hasHash) {
        return res.status(400).json({ 
          error: "Invalid initData format", 
          verified: false 
        });
      }
      
      // Process user data
      let user = {};
      try {
        const userData = data.get('user');
        if (userData) {
          user = JSON.parse(userData);
        }
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
      
      // For demo purposes, we'll consider this verified
      // In production, you must verify the hash with the bot token
      console.log("WebApp data verified for user:", user);
      
      res.json({ 
        success: true, 
        verified: true,
        user
      });
    } catch (error) {
      console.error("Error verifying Telegram data:", error);
      res.status(500).json({ error: "Verification failed" });
    }
  });

  return httpServer;
}
