import { useState, useEffect } from "react";
import Header from "../components/Header";
import VideoChat from "../components/VideoChat";
import Footer from "../components/Footer";
import { useTelegramTon } from "../hooks/use-telegram-ton";
import { useTonConnect } from "../hooks/useTonConnect";
import { Button } from "../components/ui/button";
import { Wallet, MessageCircle, User, ExternalLink, LogOut, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
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

  // Handle wallet connect UI - opens TON Connect modal
  const handleConnectWallet = async () => {
    try {
      if (tonConnect.showWalletConnectModal) {
        await tonConnect.showWalletConnectModal();
      } else {
        // Fallback in case the modal function isn't available
        toast({
          title: "TON Connect",
          description: "Please approve connection in your TON wallet.",
          variant: "default"
        });
      }
    } catch (err) {
      console.error("Failed to open wallet connect modal:", err);
      toast({
        title: "Connection Error",
        description: "Could not open wallet connection dialog",
        variant: "destructive"
      });
    }
  };

  // Handle wallet disconnect
  const handleDisconnectWallet = async () => {
    try {
      await disconnectWallet();
      toast({
        title: "TON Wallet Disconnected",
        description: "Your wallet has been disconnected.",
        variant: "default"
      });
    } catch (err) {
      console.error("Failed to disconnect wallet:", err);
      toast({
        title: "Error",
        description: "Failed to disconnect wallet.",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-gray-900 to-black text-gray-100">
      <Header statusMessage={statusMessage} />
      
      {/* Mobile-Friendly User Identity - Full width on mobile, converts to drawer-like component on scroll */}
      {isInitialized && (
        <div className="container mx-auto">
          <div className="px-4 py-2 md:py-6 sticky top-16 z-40">
            <Card className="bg-gray-800/70 border-gray-700 shadow-xl overflow-hidden backdrop-blur-md">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-600/10 opacity-50"></div>
              
              {/* Mobile Card Header with toggle */}
              <div className="md:hidden">
                <CardHeader className="pb-1 relative z-10 cursor-pointer" onClick={() => {
                  // Find the identity-content element
                  const content = document.getElementById('identity-content');
                  if (content) {
                    content.classList.toggle('hidden');
                  }
                }}>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                      Your Identity
                    </CardTitle>
                    <div className="flex items-center space-x-2">
                      {telegramUser && (
                        <div className="flex items-center space-x-1">
                          <div className="h-5 w-5 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
                            <User className="h-3 w-3 text-white" />
                          </div>
                          <span className="text-xs text-blue-300">
                            {telegramUser.username || telegramUser.firstName}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>
                
                {/* Mobile collapsible content */}
                <CardContent id="identity-content" className="relative z-10 hidden pt-0">
                  <div className="space-y-4">
                    {/* Telegram Section */}
                    <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <MessageCircle className="h-4 w-4 mr-2 text-blue-400" />
                          <h3 className="font-medium text-sm">Telegram</h3>
                        </div>
                        
                        {telegramUser ? (
                          <Badge variant="outline" className="bg-blue-900/50 text-blue-300 border-blue-800 text-xs py-0 px-2">
                            Connected
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-700/50 text-gray-400 border-gray-600 text-xs py-0 px-2">
                            Not Connected
                          </Badge>
                        )}
                      </div>
                      
                      {telegramUser ? (
                        <div className="mt-2">
                          <div className="flex items-center gap-2">
                            <div>
                              <p className="text-xs text-gray-300">
                                Signed in as <span className="font-medium text-white">{telegramUser.firstName} {telegramUser.lastName}</span>
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center justify-between">
                          <p className="text-xs text-gray-300">
                            Open in Telegram
                          </p>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 bg-blue-900/20 hover:bg-blue-800/30 text-blue-300 border-blue-800 text-xs"
                            onClick={openInTelegram}
                          >
                            <ExternalLink className="mr-1 h-3 w-3" />
                            Open
                          </Button>
                        </div>
                      )}
                    </div>
                    
                    {/* TON Wallet Section */}
                    <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <Wallet className="h-4 w-4 mr-2 text-purple-400" />
                          <h3 className="font-medium text-sm">TON Wallet</h3>
                        </div>
                        
                        {isConnecting ? (
                          <div className="flex items-center">
                            <Loader2 className="h-3 w-3 text-purple-400 animate-spin mr-1" />
                            <span className="text-xs text-purple-300">Connecting</span>
                          </div>
                        ) : isWalletConnected ? (
                          <Badge variant="outline" className="bg-purple-900/50 text-purple-300 border-purple-800 text-xs py-0 px-2">
                            Connected
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-700/50 text-gray-400 border-gray-600 text-xs py-0 px-2">
                            Not Connected
                          </Badge>
                        )}
                      </div>
                      
                      {isConnecting ? (
                        <div className="mt-2 flex items-center justify-center">
                          <p className="text-xs text-gray-300">
                            Connecting to wallet...
                          </p>
                        </div>
                      ) : isWalletConnected && walletAddress ? (
                        <div className="mt-2 flex items-center justify-between">
                          <p className="text-xs font-mono text-purple-300 truncate w-40">
                            {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                          </p>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 bg-purple-900/20 hover:bg-purple-800/30 text-purple-300 border-purple-800 text-xs"
                            onClick={handleDisconnectWallet}
                          >
                            <LogOut className="mr-1 h-3 w-3" />
                            Disconnect
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center justify-between">
                          <p className="text-xs text-gray-300">
                            Connect your wallet
                          </p>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 bg-purple-900/20 hover:bg-purple-800/30 text-purple-300 border-purple-800 text-xs"
                            onClick={handleConnectWallet}
                          >
                            <Wallet className="mr-1 h-3 w-3" />
                            Connect
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </div>
              
              {/* Desktop Card */}
              <div className="hidden md:block">
                <CardHeader className="pb-3 relative z-10">
                  <CardTitle className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                    Your Identity
                  </CardTitle>
                  <CardDescription className="text-gray-300">
                    Connect your Telegram account or TON wallet for a secure chat experience
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative z-10">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Telegram Section */}
                    <div className="space-y-3 p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                      <div className="flex items-center">
                        <MessageCircle className="h-5 w-5 mr-2 text-blue-400" />
                        <h3 className="font-medium">Telegram Identity</h3>
                      </div>
                      
                      {telegramUser ? (
                        <div className="space-y-3">
                          <Badge variant="outline" className="bg-blue-900/50 text-blue-300 border-blue-800">
                            Connected
                          </Badge>
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
                              <User className="h-5 w-5 text-white" />
                            </div>
                            <div>
                              <p className="font-medium">
                                {telegramUser.firstName} {telegramUser.lastName}
                              </p>
                              {telegramUser.username && (
                                <p className="text-sm text-blue-300">@{telegramUser.username}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <Badge variant="outline" className="bg-gray-700/50 text-gray-400 border-gray-600">
                            Not Connected
                          </Badge>
                          <p className="text-sm text-gray-300">
                            Open this app from Telegram to connect your account
                          </p>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="bg-blue-900/20 hover:bg-blue-800/30 text-blue-300 border-blue-800"
                            onClick={openInTelegram}
                          >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open in Telegram
                          </Button>
                        </div>
                      )}
                    </div>
                    
                    {/* TON Wallet Section */}
                    <div className="space-y-3 p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                      <div className="flex items-center">
                        <Wallet className="h-5 w-5 mr-2 text-purple-400" />
                        <h3 className="font-medium">TON Wallet</h3>
                      </div>
                      
                      {isConnecting ? (
                        <div className="space-y-3 flex flex-col items-center justify-center min-h-[140px]">
                          <Loader2 className="h-8 w-8 text-purple-400 animate-spin" />
                          <p className="text-sm text-gray-300">
                            Connecting to TON Wallet...
                          </p>
                        </div>
                      ) : isWalletConnected && walletAddress ? (
                        <div className="space-y-3">
                          <Badge variant="outline" className="bg-purple-900/50 text-purple-300 border-purple-800">
                            Connected
                          </Badge>
                          <div>
                            <p className="text-sm font-medium">TON Wallet</p>
                            <p className="text-xs font-mono text-purple-300 break-all">
                              {walletAddress}
                            </p>
                            {walletNetwork && (
                              <p className="text-xs text-gray-400 mt-1">
                                Network: <span className="text-purple-300">{walletNetwork}</span>
                              </p>
                            )}
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="bg-purple-900/20 hover:bg-purple-800/30 text-purple-300 border-purple-800"
                            onClick={handleDisconnectWallet}
                          >
                            <LogOut className="mr-2 h-4 w-4" />
                            Disconnect
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <Badge variant="outline" className="bg-gray-700/50 text-gray-400 border-gray-600">
                            Not Connected
                          </Badge>
                          <p className="text-sm text-gray-300">
                            Connect your TON wallet to start chatting
                          </p>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="bg-purple-900/20 hover:bg-purple-800/30 text-purple-300 border-purple-800"
                            onClick={handleConnectWallet}
                          >
                            <Wallet className="mr-2 h-4 w-4" />
                            Connect Wallet
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </div>
            </Card>
          </div>
        </div>
      )}
      
      <VideoChat 
        setStatusMessage={setStatusMessage} 
        statusMessage={statusMessage}
      />
      <Footer />
    </div>
  );
}
