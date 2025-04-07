// Ensure Buffer is available
import '../buffer';

import { CHAIN, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { Address } from "ton-core";
import { toNano, fromNano } from 'ton';
import { useState, useEffect } from 'react';

// Import environment variables
import { TON_MANIFEST_URL, TON_NETWORK, MERCHANT_WALLET } from '../lib/env';

// Payment types
export type PaymentOptions = {
  amount: string;
  comment: string;
  callback?: (success: boolean, txHash?: string) => void;
};

export type SubscriptionPlan = 'monthly' | 'yearly' | 'custom';

export type SubscriptionOptions = {
  plan: SubscriptionPlan;
  amount?: string; // Optional for custom plans
  comment?: string; // Optional custom comment
  callback?: (success: boolean, txHash?: string, expiryDate?: Date) => void;
};

type SenderArguments = {
  to: { toString: () => string };
  value: { toString: () => string };
  body?: { toBoc: () => Buffer };
};

type Sender = {
  send: (args: SenderArguments) => Promise<void>;
  address?: Address;
};

// Default subscription amounts from environment or fallback values
const SUBSCRIPTION_AMOUNT_MONTHLY = import.meta.env.SUBSCRIPTION_AMOUNT_MONTHLY || '1';
const SUBSCRIPTION_AMOUNT_YEARLY = import.meta.env.SUBSCRIPTION_AMOUNT_YEARLY || '10';

// Get the merchant wallet from environment or use a default for development
const merchantWallet = MERCHANT_WALLET || 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';

// Log configuration in development
if (import.meta.env.DEV) {
  console.log('[TonConnect] Configuration:');
  console.log('  Manifest URL:', TON_MANIFEST_URL);
  console.log('  Network:', TON_NETWORK);
  console.log('  Merchant Wallet:', merchantWallet);
}

export function useTonConnect(): {
  sender: Sender;
  connected: boolean;
  connecting: boolean;
  wallet: string | null;
  network: CHAIN | null;
  disconnect: () => Promise<void>;
  showWalletConnectModal: () => Promise<void>;
  makePayment: (options: PaymentOptions) => Promise<boolean>;
  subscribeUser: (options: SubscriptionOptions) => Promise<boolean>;
  isTestnet: boolean;
} {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [isTestnet, setIsTestnet] = useState<boolean>(true);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  
  // Determine if we're on testnet based on environment and connected wallet
  useEffect(() => {
    if (wallet?.account.chain) {
      setIsTestnet(wallet.account.chain === CHAIN.TESTNET);
      console.log(`[TonConnect] Connected to ${wallet.account.chain} network`);
    } else {
      // Default to environment setting if wallet not connected
      setIsTestnet(TON_NETWORK === 'testnet');
    }
  }, [wallet?.account.chain]);

  // Log wallet status changes
  useEffect(() => {
    if (wallet?.account.address) {
      console.log('[TonConnect] Wallet connected:', wallet.account.address);
      console.log('[TonConnect] Wallet network:', wallet.account.chain);
    }
  }, [wallet?.account.address, wallet?.account.chain]);

  // Modified function to show wallet connect modal
  const showWalletConnectModal = async (): Promise<void> => {
    try {
      console.log('[TonConnect] Opening wallet connect modal');
      setIsConnecting(true);
      await tonConnectUI.openModal();
    } catch (error) {
      console.error('[TonConnect] Error opening wallet modal:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  // Function to make a payment
  const makePayment = async (options: PaymentOptions): Promise<boolean> => {
    if (!wallet?.account.address) {
      console.error("[TonConnect] No wallet connected");
      return false;
    }
    
    try {
      console.log(`[TonConnect] Initiating payment of ${options.amount} TON`);
      
      // Create the transaction
      const result = await tonConnectUI.sendTransaction({
        validUntil: Date.now() + 5 * 60 * 1000, // 5 minutes for user to approve
        messages: [
          {
            address: merchantWallet,
            amount: toNano(options.amount).toString(),
            payload: options.comment ? Buffer.from(options.comment).toString('base64') : undefined,
          },
        ],
      });
      
      console.log("[TonConnect] Payment result:", result);
      
      // Call the callback with success
      if (options.callback) {
        options.callback(true, result.boc);
      }
      
      return true;
    } catch (error) {
      console.error("[TonConnect] Payment failed:", error);
      
      // Call the callback with failure
      if (options.callback) {
        options.callback(false);
      }
      
      return false;
    }
  };
  
  // Function to subscribe a user to a plan
  const subscribeUser = async (options: SubscriptionOptions): Promise<boolean> => {
    // Determine the subscription amount based on the plan
    let amount: string;
    let comment: string;
    
    switch (options.plan) {
      case 'monthly':
        amount = SUBSCRIPTION_AMOUNT_MONTHLY;
        comment = options.comment || 'Monthly subscription';
        break;
      case 'yearly':
        amount = SUBSCRIPTION_AMOUNT_YEARLY;
        comment = options.comment || 'Yearly subscription';
        break;
      case 'custom':
        if (!options.amount) {
          console.error("[TonConnect] Custom plan requires an amount");
          return false;
        }
        amount = options.amount;
        comment = options.comment || 'Custom subscription';
        break;
      default:
        console.error("[TonConnect] Invalid subscription plan");
        return false;
    }
    
    console.log(`[TonConnect] Setting up ${options.plan} subscription`);
    
    // Add the plan type to the comment for identification
    const fullComment = `${comment}|plan=${options.plan}|${Date.now()}`;
    
    // Make the payment
    const success = await makePayment({
      amount,
      comment: fullComment,
      callback: (success, txHash) => {
        if (success && options.callback) {
          // Calculate expiry date based on plan
          const now = new Date();
          let expiryDate: Date;
          
          if (options.plan === 'monthly') {
            expiryDate = new Date(now.setMonth(now.getMonth() + 1));
          } else if (options.plan === 'yearly') {
            expiryDate = new Date(now.setFullYear(now.getFullYear() + 1));
          } else {
            // Default to 30 days for custom plans
            expiryDate = new Date(now.setDate(now.getDate() + 30));
          }
          
          options.callback(success, txHash, expiryDate);
        } else if (options.callback) {
          options.callback(false);
        }
      }
    });
    
    return success;
  };

  // Modified disconnect function
  const disconnect = async (): Promise<void> => {
    try {
      console.log('[TonConnect] Disconnecting wallet');
      await tonConnectUI.disconnect();
    } catch (error) {
      console.error('[TonConnect] Error disconnecting wallet:', error);
    }
  };

  return {
    sender: {
      send: async (args: SenderArguments) => {
        await tonConnectUI.sendTransaction({
          messages: [
            {
              address: args.to.toString(),
              amount: args.value.toString(),
              payload: args.body?.toBoc().toString("base64"),
            },
          ],
          validUntil: Date.now() + 5 * 60 * 1000, // 5 minutes for user to approve
        });
      },
      address: wallet?.account?.address ? Address.parse(wallet.account.address as string) : undefined
    },

    connected: !!wallet?.account.address,
    connecting: isConnecting,
    wallet: wallet?.account.address ?? null,
    network: wallet?.account.chain ?? null,
    isTestnet,
    disconnect,
    showWalletConnectModal,
    makePayment,
    subscribeUser
  };
}