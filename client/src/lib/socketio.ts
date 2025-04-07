import { io, Socket } from "socket.io-client";
import { SignalData, MatchData } from "@shared/schema";

let socket: Socket | null = null;

export const initializeSocketConnection = async (): Promise<Socket> => {
  if (socket) {
    return socket;
  }

  // Determine the server URL
  const serverUrl = window.location.origin;
  
  // Create a new socket connection
  socket = io(serverUrl, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  return new Promise((resolve, reject) => {
    socket!.on('connect', () => {
      console.log('Socket connected with ID:', socket!.id);
      resolve(socket!);
    });

    socket!.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      reject(error);
    });

    // Handle socket disconnection
    socket!.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });
  });
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
};
