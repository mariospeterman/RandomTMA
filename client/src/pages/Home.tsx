import { useState, useEffect } from "react";
import VideoChat from "../components/VideoChat";
import { useTelegramTon } from "../hooks/use-telegram-ton";
import { useTonConnect } from "../hooks/useTonConnect";
import { useToast } from "../hooks/use-toast";

export default function Home() {
  const { toast } = useToast();
  const [statusMessage, setStatusMessage] = useState<string>("Ready to start");
  const { 
    telegramUser, 
    isInitialized, 
    isNotInTelegram, 
    openInTelegram 
  } = useTelegramTon();
  
  // TON Connect functionality
  const tonConnect = useTonConnect();
  const { 
    connected: isWalletConnected, 
    connecting: isConnecting,
    wallet: walletAddress,
    network: walletNetwork,
    disconnect: disconnectWallet
  } = tonConnect;

  // Update status message based on auth status
  useEffect(() => {
    if (isInitialized) {
      if (telegramUser) {
        setStatusMessage("Authentication successful. Ready to start chat.");
      } else if (isWalletConnected) {
        setStatusMessage("TON wallet connected. Ready to start chat.");
      } else {
        setStatusMessage("Please connect Telegram or TON wallet to start.");
      }
    }
  }, [telegramUser, isInitialized, isWalletConnected]);

  // Format TON wallet data for display
  const tonWallet = isWalletConnected && walletAddress ? {
    address: walletAddress,
    network: walletNetwork || 'unknown'
  } : null;

  return (
    <div className="w-full h-screen overflow-hidden">
      <VideoChat 
        telegramUser={telegramUser} 
        walletAddress={walletAddress} 
      />
    </div>
  );
}
