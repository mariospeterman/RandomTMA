// Ensure Buffer is available
import './buffer';

import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { useEffect, useState } from 'react';
import { useTelegramTon } from "./hooks/use-telegram-ton";

// Import environment configuration
import { TON_MANIFEST_URL, TELEGRAM_BOT_URL } from './lib/env';

function Router() {
  // Get the Telegram status
  const { isNotInTelegram, isInitialized, telegramUser } = useTelegramTon();
  
  // Track if we've already shown the redirect prompt
  const [redirectPrompted, setRedirectPrompted] = useState(false);
  
  // If not in Telegram and initialized, redirect to Telegram app
  useEffect(() => {
    if (isInitialized && isNotInTelegram && !redirectPrompted && !telegramUser) {
      setRedirectPrompted(true);
      
      // Short delay to allow the application to render first
      const timer = setTimeout(() => {
        // Only redirect if the user hasn't interacted with the app yet
        const shouldRedirect = confirm(
          "This app works best when opened in Telegram. Would you like to open it in Telegram now?"
        );
        
        if (shouldRedirect) {
          window.open(TELEGRAM_BOT_URL, '_blank');
        }
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [isNotInTelegram, isInitialized, redirectPrompted, telegramUser]);
  
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // Log when the app is starting
  useEffect(() => {
    console.log('App starting up...');
    
    // Check if we're in Telegram WebApp environment
    const isTelegramWebApp = !!window.Telegram?.WebApp;
    console.log('Is Telegram WebApp:', isTelegramWebApp);
    
    // If TON manifest URL is missing, log a warning
    if (!TON_MANIFEST_URL) {
      console.warn('TON_MANIFEST_URL is not set in the environment. TON Connect may not work correctly.');
    } else {
      console.log('TON Connect configured with manifest URL:', TON_MANIFEST_URL);
    }
    
    // Inform Telegram that the WebApp is ready
    if (isTelegramWebApp && window.Telegram?.WebApp) {
      try {
        // Expand the WebApp to use full height
        window.Telegram.WebApp.expand();
        
        // Use the ready method to finalize initialization
        window.Telegram.WebApp.ready();
        console.log('Notified Telegram WebApp that we are ready');
      } catch (error) {
        console.error('Error initializing Telegram WebApp:', error);
      }
    }
  }, []);
  
  // Use the configured manifest URL
  const manifestUrl = TON_MANIFEST_URL || 
    'https://raw.githubusercontent.com/ton-connect/demo-dapp-with-react-ui/main/public/tonconnect-manifest.json';

  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <QueryClientProvider client={queryClient}>
        <Router />
        <Toaster />
      </QueryClientProvider>
    </TonConnectUIProvider>
  );
}

export default App;
