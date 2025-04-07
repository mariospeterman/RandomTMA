import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { storage } from './storage';

export function setupSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    allowEIO3: true,
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,        // Increased ping timeout
    pingInterval: 25000,       // Increased ping interval
    connectTimeout: 30000,     // Increased connection timeout
    maxHttpBufferSize: 1e8,    // Increased buffer size for signals (100MB)
    path: '/socket.io'         // Explicitly set the path
  });

  // Log server started
  console.log('🔌 Socket.io server initialized with configuration:');
  console.log('   - Path:', '/socket.io');
  console.log('   - Transports:', ['websocket', 'polling']);
  console.log('   - CORS:', 'enabled for all origins');
  
  io.engine.on("connection_error", (err) => {
    console.error('❌ Socket.io connection error:', err.req.url, err.code, err.message, err.context);
  });

  // Periodic check for stale connections
  setInterval(() => {
    try {
      const onlineUsers = storage.getOnlineUsersArray();
      const now = Date.now();
      const staleTimeout = 2 * 60 * 1000; // 2 minutes
      
      let removedCount = 0;
      
      onlineUsers.forEach(user => {
        // Check if user's lastSeen is too old
        if (now - user.lastSeen > staleTimeout) {
          console.log(`⏱️ Removing stale user ${user.telegramId} (${user.firstName || user.username || 'Unknown'}) - last seen ${Math.round((now - user.lastSeen) / 1000)}s ago`);
          
          // Clean up any ongoing chat
          if (user.inChat && user.currentRoomId) {
            io.to(user.currentRoomId).emit('chat_ended', { 
              message: 'Connection lost with the other user' 
            });
          }
          
          // Remove user from online status
          storage.removeUserOnline(user.telegramId);
          removedCount++;
        }
      });
      
      if (removedCount > 0) {
        console.log(`🧹 Removed ${removedCount} stale connections`);
      }
    } catch (error) {
      console.error('❌ Error in stale connection cleanup:', error);
    }
  }, 30000); // Check every 30 seconds

  // Track connected users
  io.on('connection', (socket) => {
    console.log('👤 User connected:', socket.id);
    let currentUserTelegramId: number | null = null;

    // Register user with their Telegram ID
    socket.on('register', (data) => {
      try {
        const { telegramId, username, firstName, lastName } = data;
        
        if (!telegramId) {
          console.error('❌ Missing telegramId in register event');
          socket.emit('error', { message: 'Missing telegramId' });
          return;
        }
        
        currentUserTelegramId = telegramId;
        
        // Check if user is already registered with another socket
        const existingUser = storage.get(`user:online:${telegramId}`);
        if (existingUser && existingUser.socketId !== socket.id) {
          console.log(`⚠️ User ${telegramId} already registered with socket ${existingUser.socketId} - updating to new socket ${socket.id}`);
          
          // If the user was in a chat, end it
          if (existingUser.inChat && existingUser.currentRoomId) {
            io.to(existingUser.currentRoomId).emit('chat_ended', { 
              message: 'The other user reconnected' 
            });
          }
          
          // Update socket ID but keep other metadata
          storage.setUserOnline(telegramId, socket.id, {
            username,
            firstName,
            lastName,
            inChat: false,      // Reset chat status on reconnect
            searching: false,   // Reset searching status on reconnect
            lastSeen: Date.now()
          });
        } else {
          // Store user in online users with their socket ID and Telegram data
          storage.setUserOnline(telegramId, socket.id, {
            username,
            firstName,
            lastName,
            inChat: false,
            searching: false,
            lastSeen: Date.now()
          });
        }
        
        console.log(`✅ User registered: ${telegramId} (${firstName || username || 'Unknown'})`);
        socket.emit('registered', { success: true });
        
        // Notify client of current online count (excluding themselves)
        const onlineUsers = storage.getOnlineUsers();
        const onlineCount = Object.keys(onlineUsers).length - 1;
        socket.emit('online_count', { count: onlineCount > 0 ? onlineCount : 0 });
        
        // Log system stats
        console.log('📊 System stats:', storage.getStats());
        
        // Broadcast to all clients that online count changed
        io.emit('online_count', storage.getStats());
      } catch (error) {
        console.error('❌ Error registering user:', error);
        socket.emit('error', { message: 'Failed to register user' });
      }
    });

    // Handle request for online user count
    socket.on('get_online_count', () => {
      try {
        // Update user's last seen timestamp
        if (currentUserTelegramId) {
          const user = storage.get(`user:online:${currentUserTelegramId}`);
          if (user) {
            user.lastSeen = Date.now();
            storage.set(`user:online:${currentUserTelegramId}`, user);
          }
        }
        
        const stats = storage.getStats();
        socket.emit('online_count', { 
          count: stats.totalOnline,
          searching: stats.searching,
          inChat: stats.inChat 
        });
        console.log(`📊 Sent online stats: ${JSON.stringify(stats)}`);
      } catch (error) {
        console.error('❌ Error sending online count:', error);
      }
    });

    // Handle request for random chat
    socket.on('request_random_chat', () => {
      if (!currentUserTelegramId) {
        socket.emit('error', { message: 'You must register first' });
        return;
      }
      
      console.log(`🔍 User ${currentUserTelegramId} requested a random chat`);
      
      try {
        // Ensure telegramId is a number, not null
        const telegramId = currentUserTelegramId;
        
        // Set user as searching and not in chat
        storage.setUserSearchingStatus(telegramId, true);
        storage.setUserChatStatus(telegramId, false);
        
        // Update last seen timestamp
        const user = storage.get(`user:online:${telegramId}`);
        if (user) {
          user.lastSeen = Date.now();
          storage.set(`user:online:${telegramId}`, user);
        }
        
        // Debug: Log system stats
        console.log('📊 System stats after search request:', storage.getStats());
        
        // Try to find a match immediately
        tryFindMatch(telegramId, socket);
        
        // Set up periodic check for matches (every 3 seconds)
        const checkInterval = setInterval(() => {
          // Check if user is still connected and searching
          const currentUser = storage.get(`user:online:${telegramId}`);
          if (!currentUser || !currentUser.searching || currentUser.inChat) {
            console.log(`⏱️ Stopping match check for user ${telegramId} (no longer searching or in chat)`);
            clearInterval(checkInterval);
            return;
          }
          
          // Update last seen timestamp
          currentUser.lastSeen = Date.now();
          storage.set(`user:online:${telegramId}`, currentUser);
          
          console.log(`⏱️ Periodic match check for user ${telegramId}`);
          tryFindMatch(telegramId, socket);
        }, 3000);
        
        // Clean up interval on disconnect or when no longer searching
        socket.on('disconnect', () => {
          clearInterval(checkInterval);
        });
        
        socket.on('cancel_search', () => {
          clearInterval(checkInterval);
        });
        
      } catch (error) {
        console.error('❌ Error matching users for chat:', error);
        socket.emit('error', { message: 'Failed to set up chat' });
      }
    });
    
    // Function to try finding a match for a user
    function tryFindMatch(telegramId: number, userSocket: any) {
      // Find a random match
      const match = storage.findRandomMatch(telegramId);
      
      if (!match) {
        console.log(`⚠️ No match found for user ${telegramId} during check`);
        // Notify user if this is first try (no need to spam them every check)
        const user = storage.get(`user:online:${telegramId}`);
        if (user && user.searching && !user.notifiedNoMatch) {
          userSocket.emit('no_match', { 
            message: 'No users available. Waiting for someone to connect...'
          });
          user.notifiedNoMatch = true;
          storage.set(`user:online:${telegramId}`, user);
        }
        return false;
      }
      
      console.log(`🎯 Found match for user ${telegramId}: ${match.telegramId}`);
      
      // Mark both users as in chat
      storage.setUserChatStatus(telegramId, true);
      storage.setUserChatStatus(match.telegramId, true);
      
      // Get sockets for both users
      const initiatorSocket = userSocket;
      const receiverSocket = io.sockets.sockets.get(match.socketId);
      
      if (!receiverSocket) {
        console.error(`❌ Receiver socket ${match.socketId} not found - stale connection`);
        // Reset the searching user's status
        storage.setUserChatStatus(telegramId, false);
        storage.setUserSearchingStatus(match.telegramId, false);
        
        // Remove the stale user from online status
        storage.removeUserOnline(match.telegramId);
        
        // Try again with another user
        return tryFindMatch(telegramId, userSocket);
      }
      
      // Verify both sockets are connected
      if (!initiatorSocket.connected || !receiverSocket.connected) {
        console.error(`❌ One of the sockets is not connected - aborting match`);
        
        // Reset statuses
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
      
      // Setup peer-to-peer connection
      const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Join both users to the room
      initiatorSocket.join(roomId);
      receiverSocket.join(roomId);
      
      // Store room ID in user objects for clean up
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
      
      console.log(`🔄 Created room ${roomId} for users ${telegramId} and ${match.telegramId}`);
      
      // Send match info to both users
      initiatorSocket.emit('chat_matched', {
        roomId,
        isInitiator: true,
        peer: {
          telegramId: match.telegramId,
          username: match.username,
          firstName: match.firstName,
          lastName: match.lastName
        }
      });
      
      receiverSocket.emit('chat_matched', {
        roomId,
        isInitiator: false,
        peer: {
          telegramId: telegramId,
          username: storage.get(`user:online:${telegramId}`)?.username,
          firstName: storage.get(`user:online:${telegramId}`)?.firstName,
          lastName: storage.get(`user:online:${telegramId}`)?.lastName
        }
      });
      
      // Update system stats
      console.log('📊 System stats after match:', storage.getStats());
      
      // Broadcast to all clients that online count changed
      io.emit('online_count', storage.getStats());
      
      return true;
    }

    // Handle WebRTC signaling
    socket.on('signal', (data) => {
      const { roomId, signal } = data;
      
      if (!roomId || !signal) {
        socket.emit('error', { message: 'Invalid signaling data' });
        return;
      }
      
      // Update user's last seen timestamp
      if (currentUserTelegramId) {
        const user = storage.get(`user:online:${currentUserTelegramId}`);
        if (user) {
          user.lastSeen = Date.now();
          storage.set(`user:online:${currentUserTelegramId}`, user);
        }
      }
      
      console.log(`📡 Signal from ${socket.id} in room ${roomId} (${signal.type || 'unknown type'})`);
      
      // Broadcast the signal to everyone in the room except the sender
      socket.to(roomId).emit('signal', {
        signal,
        from: socket.id
      });
    });
    
    // Handle chat ending
    socket.on('end_chat', (data) => {
      const { roomId } = data;
      
      if (roomId) {
        console.log(`👋 User ${currentUserTelegramId} ending chat in room ${roomId}`);
        
        // Notify everyone in the room that the chat has ended
        io.to(roomId).emit('chat_ended', { 
          message: 'Chat has ended' 
        });
        
        // Leave the room
        socket.leave(roomId);
      }
      
      // Update user status
      if (currentUserTelegramId) {
        const user = storage.get(`user:online:${currentUserTelegramId}`);
        if (user) {
          user.inChat = false;
          user.currentRoomId = null;
          user.lastSeen = Date.now();
          storage.set(`user:online:${currentUserTelegramId}`, user);
        }
      }
      
      // Update system stats
      console.log('📊 System stats after chat end:', storage.getStats());
      
      // Broadcast to all clients that online count changed
      io.emit('online_count', storage.getStats());
    });

    // Handle ping to keep connection alive and update last seen
    socket.on('ping', () => {
      if (currentUserTelegramId) {
        const user = storage.get(`user:online:${currentUserTelegramId}`);
        if (user) {
          user.lastSeen = Date.now();
          storage.set(`user:online:${currentUserTelegramId}`, user);
        }
      }
      socket.emit('pong');
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('👋 User disconnected:', socket.id, currentUserTelegramId ? `(Telegram ID: ${currentUserTelegramId})` : '');
      
      // If user was in a chat, notify the other user
      if (currentUserTelegramId) {
        const user = storage.get(`user:online:${currentUserTelegramId}`);
        if (user && user.inChat && user.currentRoomId) {
          io.to(user.currentRoomId).emit('chat_ended', { 
            message: 'The other user disconnected' 
          });
        }
      }
      
      // Remove user from online status
      if (currentUserTelegramId) {
        storage.removeUserOnline(currentUserTelegramId);
      }
      
      // Update system stats
      console.log('📊 System stats after disconnect:', storage.getStats());
      
      // Broadcast to all clients that online count changed
      io.emit('online_count', storage.getStats());
    });

    // Handle search cancellation
    socket.on('cancel_search', (data) => {
      try {
        const telegramId = data.telegramId;
        console.log(`🚫 User ${telegramId} canceled search`);
        
        // Update user status using the storage helper
        storage.setUserSearchingStatus(telegramId, false);
        
        // Update last seen timestamp
        const user = storage.get(`user:online:${telegramId}`);
        if (user) {
          user.lastSeen = Date.now();
          storage.set(`user:online:${telegramId}`, user);
        }
        
        // Update system stats
        console.log('📊 System stats after search cancel:', storage.getStats());
        
        // Broadcast to all clients that online count changed
        io.emit('online_count', storage.getStats());
      } catch (error) {
        console.error('❌ Error canceling search:', error);
      }
    });
  });

  return io;
}
