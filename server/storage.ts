import { users, type User, type InsertUser } from "@shared/schema";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

// Simple in-memory storage for development
// This would be replaced with a proper database in production

type StorageData = {
  [key: string]: any;
};

type OnlineUser = {
  telegramId: number;
  socketId: string;
  lastSeen: number;
  inChat: boolean;
  searching: boolean;
  username?: string;
  firstName?: string;
  lastName?: string;
  notifiedNoMatch?: boolean;
  currentRoomId?: string | null;
};

class MemStorage {
  private data: StorageData = {};

  set(key: string, value: any): void {
    this.data[key] = value;
  }

  get(key: string): any {
    return this.data[key];
  }

  remove(key: string): void {
    delete this.data[key];
  }

  // Get all items with a certain prefix
  getByPrefix(prefix: string): Record<string, any> {
    const result: Record<string, any> = {};
    
    for (const key in this.data) {
      if (key.startsWith(prefix)) {
        result[key] = this.data[key];
      }
    }
    
    return result;
  }

  // Get all online users (for peer matching)
  getOnlineUsers(): Record<string, OnlineUser> {
    return this.getByPrefix('user:online:');
  }
  
  // Get array of all online users
  getOnlineUsersArray(): OnlineUser[] {
    const onlineUsers = this.getOnlineUsers();
    return Object.values(onlineUsers);
  }
  
  // Count users with specific status
  countUsersWithStatus(searching: boolean = false, inChat: boolean = false): number {
    const users = this.getOnlineUsersArray();
    return users.filter(u => u.searching === searching && u.inChat === inChat).length;
  }
  
  // Set a user as online with their Telegram ID
  setUserOnline(telegramId: number, socketId: string, metadata: any = {}): void {
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
  removeUserOnline(telegramId: number): void {
    this.remove(`user:online:${telegramId}`);
    console.log(`User ${telegramId} removed from online users. Remaining: ${Object.keys(this.getOnlineUsers()).length}`);
  }
  
  // Find a random online user excluding the given user
  findRandomMatch(telegramId: number): OnlineUser | null {
    const onlineUsers = this.getOnlineUsers();
    console.log(`Finding match for user ${telegramId}. Total online users: ${Object.keys(onlineUsers).length}`);
    
    // Extract the actual user objects from the object keys
    const usersArray = Object.values(onlineUsers);
    
    // Filter out the requesting user, users already in chat, and users not searching
    const eligibleUsers = usersArray.filter(
      (user: OnlineUser) => {
        const isEligible = 
          user.telegramId !== telegramId && // Not the requesting user
          !user.inChat && // Not already in a chat
          user.searching; // Actively searching
          
        console.log(`User ${user.telegramId} eligible: ${isEligible} (inChat: ${user.inChat}, searching: ${user.searching})`);
        return isEligible;
      }
    );
    
    console.log(`Found ${eligibleUsers.length} eligible users for matching with user ${telegramId}`);
    
    if (eligibleUsers.length === 0) {
      return null;
    }
    
    // Return a random user
    const selectedUser = eligibleUsers[Math.floor(Math.random() * eligibleUsers.length)];
    console.log(`Selected random user for matching: ${selectedUser.telegramId} (${selectedUser.firstName || selectedUser.username || 'Anonymous'})`);
    return selectedUser;
  }
  
  // Set a user's chat status
  setUserChatStatus(telegramId: number, inChat: boolean): void {
    const user = this.get(`user:online:${telegramId}`);
    if (user) {
      user.inChat = inChat;
      // If putting in chat, also set not searching
      if (inChat) {
        user.searching = false;
      }
      this.set(`user:online:${telegramId}`, user);
      console.log(`User ${telegramId} chat status updated: inChat=${inChat}`);
    }
  }
  
  // Set a user's searching status
  setUserSearchingStatus(telegramId: number, searching: boolean): void {
    const user = this.get(`user:online:${telegramId}`);
    if (user) {
      user.searching = searching;
      // Reset notification flag when starting to search again
      if (searching) {
        user.notifiedNoMatch = false;
      }
      this.set(`user:online:${telegramId}`, user);
      console.log(`User ${telegramId} searching status updated: searching=${searching}`);
    }
  }
  
  // Get system stats for debugging
  getStats(): any {
    const onlineUsers = this.getOnlineUsersArray();
    return {
      totalOnline: onlineUsers.length,
      searching: onlineUsers.filter(u => u.searching && !u.inChat).length,
      inChat: onlineUsers.filter(u => u.inChat).length,
      idle: onlineUsers.filter(u => !u.searching && !u.inChat).length
    };
  }
}

// Singleton instance
export const storage = new MemStorage();
