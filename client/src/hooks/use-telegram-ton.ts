import { useState, useEffect, useCallback } from 'react';
import { TelegramUserData } from '@shared/schema';
import { useToast } from './use-toast';
import { useTonConnect } from './useTonConnect';

// Import from environment settings
import { TELEGRAM_BOT_URL } from '../lib/env';

// Type for window to include Telegram object
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            username?: string;
            first_name?: string;
            last_name?: string;
            photo_url?: string;
          };
          start_param?: string;
        };
        ready: () => void;
        expand: () => void;
        showAlert: (message: string) => void;
        showConfirm: (message: string) => Promise<boolean>;
        MainButton: {
          text: string;
          color: string;
          textColor: string;
          isVisible: boolean;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
          show: () => void;
          hide: () => void;
          enable: () => void;
          disable: () => void;
        };
        backgroundColor?: string;
        headerColor?: string;
        isExpanded?: boolean;
        viewportHeight?: number;
        viewportStableHeight?: number;
      };
    };
  }
}

export function useTelegramTon() {
  const { toast } = useToast();
  const [telegramUser, setTelegramUser] = useState<TelegramUserData | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isNotInTelegram, setIsNotInTelegram] = useState<boolean>(false);
  const [startParam, setStartParam] = useState<string | null>(null);
  
  // Get TonConnect to synchronize wallet connection
  const { connected: isWalletConnected, wallet: walletAddress } = useTonConnect();

  // Function to help debug Telegram WebApp data
  const debugTelegramWebApp = useCallback(() => {
    if (!window.Telegram?.WebApp) return;
    
    const webApp = window.Telegram.WebApp;
    console.log('Telegram WebApp initData:', webApp.initData);
    console.log('Telegram WebApp initDataUnsafe:', webApp.initDataUnsafe);
    console.log('Telegram WebApp user:', webApp.initDataUnsafe.user);
    
    // Log other properties
    console.log('Telegram WebApp isExpanded:', webApp.isExpanded);
    console.log('Telegram WebApp viewportHeight:', webApp.viewportHeight);
    console.log('Telegram WebApp start_param:', webApp.initDataUnsafe.start_param);
  }, []);

  // Function to validate Telegram WebApp data
  const verifyTelegramData = useCallback(async (initData: string) => {
    if (!initData) return false;
    
    try {
      // Send to our server endpoint for verification
      const response = await fetch('/api/verify-telegram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ initData }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to verify Telegram data with server');
      }
      
      const result = await response.json();
      return result.verified;
    } catch (error) {
      console.error('Error verifying Telegram data:', error);
      
      // Fallback verification (client-side only) for development
      if (import.meta.env.DEV) {
        console.log("DEV: Using client-side verification fallback");
        const data = new URLSearchParams(initData);
        const hasHash = data.has('hash');
        const hasUser = data.has('user');
        return hasHash && hasUser;
      }
      
      return false;
    }
  }, []);

  // Function to sync wallet address with server
  const syncWalletWithServer = useCallback(async (userId: number, walletAddress: string | null) => {
    if (!userId || !walletAddress) return;
    
    try {
      const response = await fetch('/api/user/wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          telegramId: userId,
          walletAddress,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to sync wallet with server');
      }
      
      console.log('Wallet synced with server successfully');
    } catch (error) {
      console.error('Error syncing wallet with server:', error);
    }
  }, []);

  useEffect(() => {
    const initializeTelegram = async () => {
      try {
        // Check if we're in Telegram WebApp environment
        if (window.Telegram?.WebApp) {
          // Debug information
          debugTelegramWebApp();
          
          // Get WebApp instance
          const webApp = window.Telegram.WebApp;
          
          // Tell Telegram WebApp we're ready
          webApp.ready();
          
          // Expand the WebApp
          webApp.expand();
          
          // Verify the data integrity
          const isValidData = await verifyTelegramData(webApp.initData);
          
          if (!isValidData && import.meta.env.PROD) {
            console.error("Invalid Telegram WebApp data");
            setError("Invalid Telegram data. Please try opening the app again.");
            setIsNotInTelegram(true);
            setIsInitialized(true);
            return;
          }
          
          // Extract start parameter if available
          if (webApp.initDataUnsafe.start_param) {
            setStartParam(webApp.initDataUnsafe.start_param);
          }
          
          // Extract user info from initDataUnsafe
          const user = webApp.initDataUnsafe.user;
          
          if (user) {
            // Format user data to our schema
            const userData: TelegramUserData = {
              id: user.id,
              username: user.username || `user_${user.id}`,
              firstName: user.first_name || 'Telegram',
              lastName: user.last_name || 'User',
              photoUrl: user.photo_url
            };
            
            setTelegramUser(userData);
            console.log("Telegram user initialized:", userData);
            
            // Trigger a toast to notify successful connection
            toast({
              title: "Telegram Connected",
              description: `Welcome, ${userData.firstName}!`,
              variant: "default",
              duration: 3000,
            });
          } else {
            // Handle no user data case
            console.log("No user data in Telegram WebApp");
            
            // Try with mock user for development - only in development!
            if (import.meta.env.DEV) {
              console.log("DEV: Using mock Telegram user for development");
              const mockUser: TelegramUserData = {
                id: Date.now(), // Generate a temporary unique ID
                username: "dev_user",
                firstName: "Development",
                lastName: "User"
              };
              setTelegramUser(mockUser);
            }
          }
        } else {
          console.log("Not running in Telegram Mini App environment");
          setIsNotInTelegram(true);
          
          // Show toast notification to redirect to Telegram
          setTimeout(() => {
            toast({
              title: "Open in Telegram",
              description: "For the best experience, please open this app from Telegram",
              variant: "default",
              duration: 5000,
            });
          }, 1000);
        }
        
        setIsInitialized(true);
      } catch (err) {
        console.error("Error initializing Telegram:", err);
        setError(err instanceof Error ? err.message : "Unknown error initializing Telegram");
        setIsInitialized(true);
      }
    };

    initializeTelegram();
  }, [toast, debugTelegramWebApp, verifyTelegramData]);
  
  // If user has wallet connected, sync this information with the server
  useEffect(() => {
    if (telegramUser?.id && isWalletConnected && walletAddress) {
      syncWalletWithServer(telegramUser.id, walletAddress);
    }
  }, [telegramUser?.id, isWalletConnected, walletAddress, syncWalletWithServer]);
  
  // Function to open the app in Telegram
  const openInTelegram = () => {
    window.open(TELEGRAM_BOT_URL, '_blank');
  };

  return {
    telegramUser,
    isInitialized,
    isNotInTelegram,
    openInTelegram,
    error,
    startParam
  };
}