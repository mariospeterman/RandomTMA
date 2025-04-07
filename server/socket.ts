import { Server as SocketIOServer } from "socket.io";
import { Server } from "http";
import { SignalData, MatchData } from "../shared/schema";

// Enhanced user socket interface with identity information
interface UserSocket {
  id: string;
  peerId?: string;
  telegramId?: string;
  telegramUsername?: string;
  tonWalletAddress?: string;
  registrationTime?: number;
}

export const setupSocketServer = (httpServer: Server) => {
  const io = new SocketIOServer(httpServer);
  
  // Store waiting users
  const waitingUsers: UserSocket[] = [];
  
  // Map of all connected sockets
  const connectedSockets = new Map<string, UserSocket>();

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    // Add to connected sockets map with basic info
    connectedSockets.set(socket.id, { id: socket.id });
    
    // Handle user registration with identity
    socket.on('register', (userData: {
      telegramId?: string;
      telegramUsername?: string;
      tonWalletAddress?: string;
    }) => {
      // Update user with identity information
      const userSocket = connectedSockets.get(socket.id);
      if (userSocket) {
        userSocket.telegramId = userData.telegramId;
        userSocket.telegramUsername = userData.telegramUsername;
        userSocket.tonWalletAddress = userData.tonWalletAddress;
        userSocket.registrationTime = Date.now();
      }
      
      console.log(`User registered with ID: ${socket.id}`, userData);
      
      // Add to waiting queue
      const existingWaitingIndex = waitingUsers.findIndex(u => u.id === socket.id);
      if (existingWaitingIndex >= 0) {
        waitingUsers.splice(existingWaitingIndex, 1);
      }
      
      // Only add to waiting list if they have a Telegram ID or TON wallet
      if (userData.telegramId || userData.tonWalletAddress) {
        waitingUsers.push(connectedSockets.get(socket.id)!);
        console.log(`User ${socket.id} is waiting for a match`);
        
        // Try to match users
        tryMatchUsers();
      }
    });
    
    // When a client signals, forward the signal to the peer
    socket.on('signal', (data: SignalData) => {
      const currentSocket = connectedSockets.get(socket.id);
      if (currentSocket && currentSocket.peerId) {
        io.to(currentSocket.peerId).emit('signal', data);
      }
    });
    
    // Function to match waiting users
    function tryMatchUsers() {
      if (waitingUsers.length >= 2) {
        // Sort by registration time (oldest first)
        waitingUsers.sort((a, b) => 
          (a.registrationTime || 0) - (b.registrationTime || 0)
        );
        
        // Enhanced logging for matching process
        console.log(`Attempting to match from ${waitingUsers.length} waiting users`);
        console.log(`Waiting users:`, waitingUsers.map(u => ({
          id: u.id,
          telegramId: u.telegramId ? `TG_${u.telegramId.substring(0, 5)}` : 'none',
          tonWallet: u.tonWalletAddress ? `TON_${u.tonWalletAddress.substring(0, 5)}` : 'none',
          time: u.registrationTime
        })));
        
        // Get first two users
        const user1 = waitingUsers.shift()!;
        const user2 = waitingUsers.shift()!;
        
        // Update peer connections
        const socket1 = connectedSockets.get(user1.id);
        const socket2 = connectedSockets.get(user2.id);
        
        if (socket1 && socket2) {
          socket1.peerId = user2.id;
          socket2.peerId = user1.id;
          
          // Build enhanced match data with more detailed peer info
          const user1Data: MatchData = {
            initiator: true,
            peerId: user2.id,
            peerUsername: user2.telegramUsername
          };
          
          const user2Data: MatchData = {
            initiator: false,
            peerId: user1.id,
            peerUsername: user1.telegramUsername
          };
          
          // Notify both that they are matched with enhanced data
          io.to(user1.id).emit('match', user1Data);
          io.to(user2.id).emit('match', user2Data);
          
          console.log(`Successfully matched users with identities:`);
          console.log(`User 1: ${JSON.stringify({
            socketId: user1.id.substring(0, 8),
            telegramId: user1.telegramId ? 'Yes' : 'No',
            tonWallet: user1.tonWalletAddress ? 'Yes' : 'No'
          })}`);
          console.log(`User 2: ${JSON.stringify({
            socketId: user2.id.substring(0, 8),
            telegramId: user2.telegramId ? 'Yes' : 'No',
            tonWallet: user2.tonWalletAddress ? 'Yes' : 'No'
          })}`);
        }
      } else if (waitingUsers.length === 1) {
        // Notify the single waiting user that no matches are available
        const user = waitingUsers[0];
        io.to(user.id).emit('no-matches-available');
        console.log(`No matches available for user ${user.id.substring(0, 8)}`);
      }
    }
    
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      
      // Remove from connected sockets
      const disconnectedSocket = connectedSockets.get(socket.id);
      connectedSockets.delete(socket.id);
      
      // Remove from waiting users
      const waitingIndex = waitingUsers.findIndex(u => u.id === socket.id);
      if (waitingIndex >= 0) {
        waitingUsers.splice(waitingIndex, 1);
      }
      
      // Notify the paired peer about disconnect
      if (disconnectedSocket && disconnectedSocket.peerId) {
        io.to(disconnectedSocket.peerId).emit('user-disconnected');
        
        // Also update the peer to no longer have this socket as peer
        const peerSocket = connectedSockets.get(disconnectedSocket.peerId);
        if (peerSocket) {
          peerSocket.peerId = undefined;
          
          // Add peer back to waiting list if they have identity
          if (peerSocket.telegramId || peerSocket.tonWalletAddress) {
            const peerWaitingIndex = waitingUsers.findIndex(u => u.id === peerSocket.id);
            if (peerWaitingIndex === -1) {
              waitingUsers.push(peerSocket);
              
              // Try to match this user with someone else
              tryMatchUsers();
            }
          }
        }
      }
    });
  });
  
  return io;
};
