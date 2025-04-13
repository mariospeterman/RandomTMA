import { io, Socket } from "socket.io-client";
import { SignalData, MatchData } from "@shared/schema";

let socket: Socket | null = null;

// Event handlers that should persist across reconnections
const persistentHandlers: Record<string, Array<(...args: any[]) => void>> = {};

export const initializeSocketConnection = async (): Promise<Socket> => {
  if (socket && socket.connected) {
    return socket;
  }

  // Clean up existing socket if it exists but is disconnected
  if (socket) {
    socket.off();
    socket.close();
    socket = null;
  }

  // Determine the server URL
  const serverUrl = window.location.origin;
  
  // Create a new socket connection with enhanced options
  socket = io(serverUrl, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity, // Never stop trying to reconnect
    reconnectionDelay: 1000, // Start with 1 second delay
    reconnectionDelayMax: 30000, // Maximum of 30 seconds between reconnection attempts
    timeout: 20000, // Connection timeout
    transports: ['websocket', 'polling'], // Prefer websocket but fallback to polling
    // Additional reliability options
    forceNew: false, // Reuse existing connections when possible
    multiplex: true, // Enable multiplexing (reuse connections)
  });

  // Monitor connection events for better debugging
  socket.on('connect', () => {
    console.log('Socket connected with ID:', socket!.id);
    console.log('Recovery was successful:', socket!.recovered);
    
    // Reattach persistent event handlers if needed
    Object.entries(persistentHandlers).forEach(([event, handlers]) => {
      handlers.forEach(handler => {
        socket!.on(event, handler);
      });
    });
  });

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error.message);
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log(`Socket reconnected after ${attemptNumber} attempts`);
  });

  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`Socket reconnection attempt #${attemptNumber}`);
  });

  socket.on('reconnect_error', (error) => {
    console.error('Socket reconnection error:', error.message);
  });

  socket.on('reconnect_failed', () => {
    console.error('Socket reconnection failed after all attempts');
  });

  // Handle socket disconnection
  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
    if (reason === 'io server disconnect') {
      // The server has forcefully disconnected the socket
      // Manual reconnection is needed
      setTimeout(() => {
        socket?.connect();
      }, 1000);
    }
    // Else the socket will automatically try to reconnect
  });

  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Failed to initialize socket'));
      return;
    }

    // If already connected, resolve immediately
    if (socket.connected) {
      resolve(socket);
      return;
    }

    // Set up one-time handlers for the connection process
    socket.once('connect', () => {
      resolve(socket!);
    });

    socket.once('connect_error', (error) => {
      reject(error);
    });

    // Ensure connection is attempted
    if (!socket.connected) {
      socket.connect();
    }
  });
};

// Helper function to add persistent event handlers that will be reattached on reconnection
export const addPersistentHandler = (event: string, handler: (...args: any[]) => void): void => {
  if (!persistentHandlers[event]) {
    persistentHandlers[event] = [];
  }
  persistentHandlers[event].push(handler);
  
  // Add to current socket if it exists
  if (socket) {
    socket.on(event, handler);
  }
};

// Helper function to remove persistent event handlers
export const removePersistentHandler = (event: string, handler: (...args: any[]) => void): void => {
  if (persistentHandlers[event]) {
    const index = persistentHandlers[event].indexOf(handler);
    if (index !== -1) {
      persistentHandlers[event].splice(index, 1);
    }
  }
  
  // Remove from current socket if it exists
  if (socket) {
    socket.off(event, handler);
  }
};

// Helper to check if socket is connected
export const isSocketConnected = (): boolean => {
  return !!socket?.connected;
};

// Helper to get the socket instance
export const getSocket = (): Socket | null => {
  return socket;
};

// Keep alive ping mechanism to prevent timeouts
export const startKeepAlivePing = (interval = 30000): () => void => {
  if (!socket) return () => {};
  
  const pingTimer = setInterval(() => {
    if (socket?.connected) {
      socket.emit('ping');
    }
  }, interval);
  
  return () => clearInterval(pingTimer);
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export default {
  initializeSocketConnection,
  disconnectSocket,
  addPersistentHandler,
  removePersistentHandler,
  isSocketConnected,
  getSocket,
  startKeepAlivePing,
};
