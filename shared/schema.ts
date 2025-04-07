import { pgTable, text, serial, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  socketId: text("socket_id"),
  telegramId: text("telegram_id").unique(),
  telegramUsername: text("telegram_username"),
  tonWalletAddress: text("ton_wallet_address").unique(),
  isOnline: boolean("is_online").default(false),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  telegramId: true,
  telegramUsername: true,
  tonWalletAddress: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// WebRTC connection types
export interface SignalData {
  type?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

export interface MatchData {
  initiator: boolean;
  peerId?: string;
  peerUsername?: string;
}

// Telegram Mini App user data
export interface TelegramUserData {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
}

// TON Connect user data
export interface TonWalletData {
  address: string;
  network: string;
  provider?: string;
}
