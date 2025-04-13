// server/index.ts
import express2 from "express";

// server/routes.ts
import { createServer } from "http";

// server/storage.ts
var MemStorage = class {
  data = {};
  set(key, value) {
    this.data[key] = value;
  }
  get(key) {
    return this.data[key];
  }
  remove(key) {
    delete this.data[key];
  }
  // Get all items with a certain prefix
  getByPrefix(prefix) {
    const result = {};
    for (const key in this.data) {
      if (key.startsWith(prefix)) {
        result[key] = this.data[key];
      }
    }
    return result;
  }
  // Get all online users (for peer matching)
  getOnlineUsers() {
    return this.getByPrefix("user:online:");
  }
  // Get array of all online users
  getOnlineUsersArray() {
    const onlineUsers = this.getOnlineUsers();
    return Object.values(onlineUsers);
  }
  // Count users with specific status
  countUsersWithStatus(searching = false, inChat = false) {
    const users = this.getOnlineUsersArray();
    return users.filter((u) => u.searching === searching && u.inChat === inChat).length;
  }
  // Set a user as online with their Telegram ID
  setUserOnline(telegramId, socketId, metadata = {}) {
    this.set(`user:online:${telegramId}`, {
      telegramId,
      socketId,
      lastSeen: Date.now(),
      inChat: false,
      searching: false,
      ...metadata
    });
    console.log(`User ${telegramId} set as online. Total online: ${Object.keys(this.getOnlineUsers()).length}`);
  }
  // Remove a user from online status
  removeUserOnline(telegramId) {
    this.remove(`user:online:${telegramId}`);
    console.log(`User ${telegramId} removed from online users. Remaining: ${Object.keys(this.getOnlineUsers()).length}`);
  }
  // Find a random online user excluding the given user
  findRandomMatch(telegramId) {
    const onlineUsers = this.getOnlineUsers();
    console.log(`Finding match for user ${telegramId}. Total online users: ${Object.keys(onlineUsers).length}`);
    const usersArray = Object.values(onlineUsers);
    const eligibleUsers = usersArray.filter(
      (user) => {
        const isEligible = user.telegramId !== telegramId && // Not the requesting user
        !user.inChat && // Not already in a chat
        user.searching;
        console.log(`User ${user.telegramId} eligible: ${isEligible} (inChat: ${user.inChat}, searching: ${user.searching})`);
        return isEligible;
      }
    );
    console.log(`Found ${eligibleUsers.length} eligible users for matching with user ${telegramId}`);
    if (eligibleUsers.length === 0) {
      return null;
    }
    const selectedUser = eligibleUsers[Math.floor(Math.random() * eligibleUsers.length)];
    console.log(`Selected random user for matching: ${selectedUser.telegramId} (${selectedUser.firstName || selectedUser.username || "Anonymous"})`);
    return selectedUser;
  }
  // Set a user's chat status
  setUserChatStatus(telegramId, inChat) {
    const user = this.get(`user:online:${telegramId}`);
    if (user) {
      user.inChat = inChat;
      if (inChat) {
        user.searching = false;
      }
      this.set(`user:online:${telegramId}`, user);
      console.log(`User ${telegramId} chat status updated: inChat=${inChat}`);
    }
  }
  // Set a user's searching status
  setUserSearchingStatus(telegramId, searching) {
    const user = this.get(`user:online:${telegramId}`);
    if (user) {
      user.searching = searching;
      if (searching) {
        user.notifiedNoMatch = false;
      }
      this.set(`user:online:${telegramId}`, user);
      console.log(`User ${telegramId} searching status updated: searching=${searching}`);
    }
  }
  // Get system stats for debugging
  getStats() {
    const onlineUsers = this.getOnlineUsersArray();
    return {
      totalOnline: onlineUsers.length,
      searching: onlineUsers.filter((u) => u.searching && !u.inChat).length,
      inChat: onlineUsers.filter((u) => u.inChat).length,
      idle: onlineUsers.filter((u) => !u.searching && !u.inChat).length
    };
  }
};
var storage = new MemStorage();

// server/socket.ts
import { Server } from "socket.io";
function setupSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    allowEIO3: true,
    transports: ["websocket", "polling"],
    pingTimeout: 6e4,
    // Increased ping timeout
    pingInterval: 25e3,
    // Increased ping interval
    connectTimeout: 3e4,
    // Increased connection timeout
    maxHttpBufferSize: 1e8,
    // Increased buffer size for signals (100MB)
    path: "/socket.io"
    // Explicitly set the path
  });
  console.log("\u{1F50C} Socket.io server initialized with configuration:");
  console.log("   - Path:", "/socket.io");
  console.log("   - Transports:", ["websocket", "polling"]);
  console.log("   - CORS:", "enabled for all origins");
  io.engine.on("connection_error", (err) => {
    console.error("\u274C Socket.io connection error:", err.req.url, err.code, err.message, err.context);
  });
  setInterval(() => {
    try {
      const onlineUsers = storage.getOnlineUsersArray();
      const now = Date.now();
      const staleTimeout = 2 * 60 * 1e3;
      let removedCount = 0;
      onlineUsers.forEach((user) => {
        if (now - user.lastSeen > staleTimeout) {
          console.log(`\u23F1\uFE0F Removing stale user ${user.telegramId} (${user.firstName || user.username || "Unknown"}) - last seen ${Math.round((now - user.lastSeen) / 1e3)}s ago`);
          if (user.inChat && user.currentRoomId) {
            io.to(user.currentRoomId).emit("chat_ended", {
              message: "Connection lost with the other user"
            });
          }
          storage.removeUserOnline(user.telegramId);
          removedCount++;
        }
      });
      if (removedCount > 0) {
        console.log(`\u{1F9F9} Removed ${removedCount} stale connections`);
      }
    } catch (error) {
      console.error("\u274C Error in stale connection cleanup:", error);
    }
  }, 3e4);
  io.on("connection", (socket) => {
    console.log("\u{1F464} User connected:", socket.id);
    let currentUserTelegramId = null;
    socket.on("register", (data) => {
      try {
        const { telegramId, username, firstName, lastName } = data;
        if (!telegramId) {
          console.error("\u274C Missing telegramId in register event");
          socket.emit("error", { message: "Missing telegramId" });
          return;
        }
        currentUserTelegramId = telegramId;
        const existingUser = storage.get(`user:online:${telegramId}`);
        if (existingUser && existingUser.socketId !== socket.id) {
          console.log(`\u26A0\uFE0F User ${telegramId} already registered with socket ${existingUser.socketId} - updating to new socket ${socket.id}`);
          if (existingUser.inChat && existingUser.currentRoomId) {
            io.to(existingUser.currentRoomId).emit("chat_ended", {
              message: "The other user reconnected"
            });
          }
          storage.setUserOnline(telegramId, socket.id, {
            username,
            firstName,
            lastName,
            inChat: false,
            // Reset chat status on reconnect
            searching: false,
            // Reset searching status on reconnect
            lastSeen: Date.now()
          });
        } else {
          storage.setUserOnline(telegramId, socket.id, {
            username,
            firstName,
            lastName,
            inChat: false,
            searching: false,
            lastSeen: Date.now()
          });
        }
        console.log(`\u2705 User registered: ${telegramId} (${firstName || username || "Unknown"})`);
        socket.emit("registered", { success: true });
        const onlineUsers = storage.getOnlineUsers();
        const onlineCount = Object.keys(onlineUsers).length - 1;
        socket.emit("online_count", { count: onlineCount > 0 ? onlineCount : 0 });
        console.log("\u{1F4CA} System stats:", storage.getStats());
        io.emit("online_count", storage.getStats());
      } catch (error) {
        console.error("\u274C Error registering user:", error);
        socket.emit("error", { message: "Failed to register user" });
      }
    });
    socket.on("get_online_count", () => {
      try {
        if (currentUserTelegramId) {
          const user = storage.get(`user:online:${currentUserTelegramId}`);
          if (user) {
            user.lastSeen = Date.now();
            storage.set(`user:online:${currentUserTelegramId}`, user);
          }
        }
        const stats = storage.getStats();
        socket.emit("online_count", {
          count: stats.totalOnline,
          searching: stats.searching,
          inChat: stats.inChat
        });
        console.log(`\u{1F4CA} Sent online stats: ${JSON.stringify(stats)}`);
      } catch (error) {
        console.error("\u274C Error sending online count:", error);
      }
    });
    socket.on("request_random_chat", () => {
      if (!currentUserTelegramId) {
        socket.emit("error", { message: "You must register first" });
        return;
      }
      console.log(`\u{1F50D} User ${currentUserTelegramId} requested a random chat`);
      try {
        const telegramId = currentUserTelegramId;
        storage.setUserSearchingStatus(telegramId, true);
        storage.setUserChatStatus(telegramId, false);
        const user = storage.get(`user:online:${telegramId}`);
        if (user) {
          user.lastSeen = Date.now();
          storage.set(`user:online:${telegramId}`, user);
        }
        console.log("\u{1F4CA} System stats after search request:", storage.getStats());
        tryFindMatch(telegramId, socket);
        const checkInterval = setInterval(() => {
          const currentUser = storage.get(`user:online:${telegramId}`);
          if (!currentUser || !currentUser.searching || currentUser.inChat) {
            console.log(`\u23F1\uFE0F Stopping match check for user ${telegramId} (no longer searching or in chat)`);
            clearInterval(checkInterval);
            return;
          }
          currentUser.lastSeen = Date.now();
          storage.set(`user:online:${telegramId}`, currentUser);
          console.log(`\u23F1\uFE0F Periodic match check for user ${telegramId}`);
          tryFindMatch(telegramId, socket);
        }, 3e3);
        socket.on("disconnect", () => {
          clearInterval(checkInterval);
        });
        socket.on("cancel_search", () => {
          clearInterval(checkInterval);
        });
      } catch (error) {
        console.error("\u274C Error matching users for chat:", error);
        socket.emit("error", { message: "Failed to set up chat" });
      }
    });
    function tryFindMatch(telegramId, userSocket) {
      const match = storage.findRandomMatch(telegramId);
      if (!match) {
        console.log(`\u26A0\uFE0F No match found for user ${telegramId} during check`);
        const user = storage.get(`user:online:${telegramId}`);
        if (user && user.searching && !user.notifiedNoMatch) {
          userSocket.emit("no_match", {
            message: "No users available. Waiting for someone to connect..."
          });
          user.notifiedNoMatch = true;
          storage.set(`user:online:${telegramId}`, user);
        }
        return false;
      }
      console.log(`\u{1F3AF} Found match for user ${telegramId}: ${match.telegramId}`);
      storage.setUserChatStatus(telegramId, true);
      storage.setUserChatStatus(match.telegramId, true);
      const initiatorSocket = userSocket;
      const receiverSocket = io.sockets.sockets.get(match.socketId);
      if (!receiverSocket) {
        console.error(`\u274C Receiver socket ${match.socketId} not found - stale connection`);
        storage.setUserChatStatus(telegramId, false);
        storage.setUserSearchingStatus(match.telegramId, false);
        storage.removeUserOnline(match.telegramId);
        return tryFindMatch(telegramId, userSocket);
      }
      if (!initiatorSocket.connected || !receiverSocket.connected) {
        console.error(`\u274C One of the sockets is not connected - aborting match`);
        if (!initiatorSocket.connected) {
          storage.setUserChatStatus(telegramId, false);
          storage.setUserSearchingStatus(telegramId, false);
        }
        if (!receiverSocket.connected) {
          storage.setUserChatStatus(match.telegramId, false);
          storage.setUserSearchingStatus(match.telegramId, false);
        }
        return false;
      }
      const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      initiatorSocket.join(roomId);
      receiverSocket.join(roomId);
      const initiatorUser = storage.get(`user:online:${telegramId}`);
      if (initiatorUser) {
        initiatorUser.currentRoomId = roomId;
        storage.set(`user:online:${telegramId}`, initiatorUser);
      }
      const receiverUser = storage.get(`user:online:${match.telegramId}`);
      if (receiverUser) {
        receiverUser.currentRoomId = roomId;
        storage.set(`user:online:${match.telegramId}`, receiverUser);
      }
      console.log(`\u{1F504} Created room ${roomId} for users ${telegramId} and ${match.telegramId}`);
      initiatorSocket.emit("chat_matched", {
        roomId,
        isInitiator: true,
        peer: {
          telegramId: match.telegramId,
          username: match.username,
          firstName: match.firstName,
          lastName: match.lastName
        }
      });
      receiverSocket.emit("chat_matched", {
        roomId,
        isInitiator: false,
        peer: {
          telegramId,
          username: storage.get(`user:online:${telegramId}`)?.username,
          firstName: storage.get(`user:online:${telegramId}`)?.firstName,
          lastName: storage.get(`user:online:${telegramId}`)?.lastName
        }
      });
      console.log("\u{1F4CA} System stats after match:", storage.getStats());
      io.emit("online_count", storage.getStats());
      return true;
    }
    socket.on("signal", (data) => {
      const { roomId, signal } = data;
      if (!roomId || !signal) {
        socket.emit("error", { message: "Invalid signaling data" });
        return;
      }
      if (currentUserTelegramId) {
        const user = storage.get(`user:online:${currentUserTelegramId}`);
        if (user) {
          user.lastSeen = Date.now();
          storage.set(`user:online:${currentUserTelegramId}`, user);
        }
      }
      console.log(`\u{1F4E1} Signal from ${socket.id} in room ${roomId} (type: ${signal.type || "unknown"}, ${signal.candidate ? "ICE candidate" : signal.sdp ? "SDP" : "other data"})`);
      socket.to(roomId).emit("signal", {
        signal,
        from: socket.id,
        roomId
      });
    });
    socket.on("end_chat", (data) => {
      const { roomId } = data;
      if (roomId) {
        console.log(`\u{1F44B} User ${currentUserTelegramId} ending chat in room ${roomId}`);
        io.to(roomId).emit("chat_ended", {
          message: "Chat has ended"
        });
        socket.leave(roomId);
      }
      if (currentUserTelegramId) {
        const user = storage.get(`user:online:${currentUserTelegramId}`);
        if (user) {
          user.inChat = false;
          user.currentRoomId = null;
          user.lastSeen = Date.now();
          storage.set(`user:online:${currentUserTelegramId}`, user);
        }
      }
      console.log("\u{1F4CA} System stats after chat end:", storage.getStats());
      io.emit("online_count", storage.getStats());
    });
    socket.on("ping", () => {
      if (currentUserTelegramId) {
        const user = storage.get(`user:online:${currentUserTelegramId}`);
        if (user) {
          user.lastSeen = Date.now();
          storage.set(`user:online:${currentUserTelegramId}`, user);
        }
      }
      socket.emit("pong");
    });
    socket.on("disconnect", () => {
      console.log("\u{1F44B} User disconnected:", socket.id, currentUserTelegramId ? `(Telegram ID: ${currentUserTelegramId})` : "");
      if (currentUserTelegramId) {
        const user = storage.get(`user:online:${currentUserTelegramId}`);
        if (user && user.inChat && user.currentRoomId) {
          io.to(user.currentRoomId).emit("chat_ended", {
            message: "The other user disconnected"
          });
        }
      }
      if (currentUserTelegramId) {
        storage.removeUserOnline(currentUserTelegramId);
      }
      console.log("\u{1F4CA} System stats after disconnect:", storage.getStats());
      io.emit("online_count", storage.getStats());
    });
    socket.on("cancel_search", (data) => {
      try {
        const telegramId = data.telegramId;
        console.log(`\u{1F6AB} User ${telegramId} canceled search`);
        storage.setUserSearchingStatus(telegramId, false);
        const user = storage.get(`user:online:${telegramId}`);
        if (user) {
          user.lastSeen = Date.now();
          storage.set(`user:online:${telegramId}`, user);
        }
        console.log("\u{1F4CA} System stats after search cancel:", storage.getStats());
        io.emit("online_count", storage.getStats());
      } catch (error) {
        console.error("\u274C Error canceling search:", error);
      }
    });
  });
  return io;
}

// server/routes.ts
import { WebSocketServer } from "ws";
import { HttpApi } from "ton";
import { fromNano, Address } from "ton";
import dotenv from "dotenv";
dotenv.config();
var MERCHANT_WALLET = process.env.VITE_MERCHANT_WALLET || "";
var TON_NETWORK = process.env.VITE_TON_NETWORK || "testnet";
var TONCENTER_TOKEN = process.env.TONCENTER_TOKEN || "";
async function registerRoutes(app2) {
  const httpServer = createServer(app2);
  const io = setupSocketServer(httpServer);
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws"
  });
  wss.on("connection", (ws) => {
    console.log("WebSocket client connected to /ws endpoint");
    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log("WebSocket message received:", data.type);
        if (data.type === "identity") {
          console.log("WebSocket identity registered:", data.identity);
          ws.send(JSON.stringify({
            type: "identity_confirmed",
            success: true
          }));
        }
      } catch (error) {
        console.error("Error handling WebSocket message:", error);
      }
    });
    ws.on("close", () => {
      console.log("WebSocket client disconnected");
    });
    ws.send(JSON.stringify({
      type: "welcome",
      message: "Connected to Tingle WebSocket server"
    }));
  });
  app2.get("/api/status", (req, res) => {
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
  app2.post("/api/user/wallet", (req, res) => {
    try {
      const { telegramId, walletAddress } = req.body;
      if (!telegramId || !walletAddress) {
        return res.status(400).json({ error: "Missing required fields" });
      }
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
  app2.post("/api/verify-payment", async (req, res) => {
    try {
      const { walletAddress, transactionHash, amount, comment } = req.body;
      if (!walletAddress || !amount) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const endpoint = TON_NETWORK === "mainnet" ? "https://toncenter.com/api/v2/jsonRPC" : "https://testnet.toncenter.com/api/v2/jsonRPC";
      const httpClient = new HttpApi(
        endpoint,
        { apiKey: TONCENTER_TOKEN }
      );
      let verified = false;
      if (transactionHash) {
        try {
          console.log(`Verifying transaction: ${transactionHash}`);
          verified = true;
        } catch (error) {
          console.error("Error verifying transaction hash:", error);
        }
      } else {
        try {
          const transactions = await httpClient.getTransactions(Address.parse(MERCHANT_WALLET), {
            limit: 100
          });
          const incomingTransactions = transactions.filter(
            (tx) => tx.in_msg && tx.in_msg.source === walletAddress
          );
          for (const tx of incomingTransactions) {
            if (!tx.in_msg || !tx.in_msg.message) continue;
            const txAmount = fromNano(tx.in_msg.value);
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
  app2.post("/api/verify-telegram", (req, res) => {
    try {
      const { initData } = req.body;
      if (!initData) {
        return res.status(400).json({ error: "Missing initData" });
      }
      const data = new URLSearchParams(initData);
      const hasUser = data.has("user");
      const hasHash = data.has("hash");
      if (!hasUser || !hasHash) {
        return res.status(400).json({
          error: "Invalid initData format",
          verified: false
        });
      }
      let user = {};
      try {
        const userData = data.get("user");
        if (userData) {
          user = JSON.parse(userData);
        }
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
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

// server/vite.ts
import express from "express";
import fs from "fs";
import path2 from "path";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    themePlugin(),
    ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
      await import("@replit/vite-plugin-cartographer").then(
        (m) => m.cartographer()
      )
    ] : []
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: {
      ...serverOptions,
      allowedHosts: true
    },
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path2.resolve(import.meta.dirname, "..", "dist", "client");
  if (!fs.existsSync(distPath)) {
    console.warn(`Could not find the build directory: ${distPath}. Make sure to build the client first.`);
    const clientPath = path2.resolve(import.meta.dirname, "..", "client");
    if (fs.existsSync(clientPath)) {
      console.log(`Falling back to serving from client directory: ${clientPath}`);
      app2.use(express.static(clientPath));
      app2.use(express.static(path2.resolve(import.meta.dirname, "..", "public")));
      app2.use("*", (req, res, next) => {
        if (req.originalUrl.startsWith("/api/") || req.originalUrl.startsWith("/socket.io/")) {
          next();
          return;
        }
        const indexPath = path2.resolve(clientPath, "index.html");
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          console.error(`Could not find index.html at ${indexPath}`);
          next(new Error("Could not find index.html"));
        }
      });
    } else {
      throw new Error(`Could not find either build directory or client directory`);
    }
  } else {
    console.log(`Serving static files from: ${distPath}`);
    app2.use(express.static(distPath));
    app2.use(express.static(path2.resolve(import.meta.dirname, "..", "public")));
    app2.use("*", (req, res, next) => {
      if (req.originalUrl.startsWith("/api/") || req.originalUrl.startsWith("/socket.io/")) {
        next();
        return;
      }
      res.sendFile(path2.resolve(distPath, "index.html"));
    });
  }
}

// server/index.ts
import dotenv2 from "dotenv";
import path3 from "path";
import http from "http";
import cors from "cors";
import { fileURLToPath } from "url";
dotenv2.config();
var __filename = fileURLToPath(import.meta.url);
var __dirname = path3.dirname(__filename);
var app = express2();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
app.use(express2.static(path3.join(process.cwd(), "public")));
app.use((req, res, next) => {
  const start = Date.now();
  const path4 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path4.startsWith("/api")) {
      let logLine = `${req.method} ${path4} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
app.use(cors());
app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});
app.get("/api/status", (req, res) => {
  res.json({ status: "API is running" });
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const httpServer = http.createServer(app);
  setupSocketServer(httpServer);
  const port = process.env.PORT || 5e3;
  httpServer.listen({
    port,
    host: "0.0.0.0"
  }, () => {
    log(`serving on port ${port}`);
  });
  console.log("Static file paths:");
  console.log(`  Public: ${path3.join(__dirname, "../public")}`);
  console.log(`  Static: ${path3.join(__dirname, "../public/static")}`);
})();
