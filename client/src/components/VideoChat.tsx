import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  X,
  VideoIcon,
  Loader2,
  User,
  RefreshCw,
  PlayCircle,
  Settings,
  Heart,
  Wallet,
  Share
} from "lucide-react";
import { initializeSocketConnection } from "@/lib/socketio";
import { SignalData, MatchData, TelegramUserData, TonWalletData } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useTelegramTon } from "../hooks/use-telegram-ton";
import { useTonConnect } from "../hooks/useTonConnect";
import { Badge } from "@/components/ui/badge";

interface VideoChatProps {
  statusMessage: string;
  setStatusMessage: (message: string) => void;
}

const VideoChat = ({ statusMessage, setStatusMessage }: VideoChatProps) => {
  const { toast } = useToast();
  const [isChatStarted, setIsChatStarted] = useState(false);
  const [isMatched, setIsMatched] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [peerUsername, setPeerUsername] = useState<string | null>(null);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  
  const socketRef = useRef<any>(null);
  const peerRef = useRef<any>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Get Telegram integration
  const { 
    telegramUser, 
    isInitialized,
    error: tmaError 
  } = useTelegramTon();
  
  // TON wallet integration
  const { connected: isWalletConnected, wallet: walletAddress } = useTonConnect();

  // Load the simple-peer library dynamically
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/simple-peer@9.11.1/simplepeer.min.js';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // Check TMA and TON initialization
  useEffect(() => {
    if (tmaError) {
      console.error("TMA/TON Error:", tmaError);
      toast({
        title: "Integration Error",
        description: tmaError,
        variant: "destructive"
      });
    }
  }, [tmaError, toast]);

  // Clean up resources when component unmounts
  useEffect(() => {
    return () => {
      // Clean up media streams
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      // Clean up Socket.io connection
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      
      // Clean up WebRTC peer
      if (peerRef.current) {
        peerRef.current.destroy();
      }
      
      // Clean up WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleStartChat = async () => {
    try {
      // Check if Telegram user or TON wallet is available
      const hasIdentity = telegramUser?.id || isWalletConnected;
      
      if (!hasIdentity && isInitialized) {
        toast({
          title: "Authentication Required",
          description: "Please connect your Telegram account or TON wallet to start chatting.",
          variant: "destructive"
        });
        return;
      }

      setIsChatStarted(true);
      setIsWaiting(true);
      setStatusMessage("Requesting camera access...");

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      localStreamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      setStatusMessage("Camera access granted");
      
      // Initialize socket connection
      const socket = await initializeSocketConnection();
      socketRef.current = socket;
      
      // Initialize WebSocket connection as well
      try {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        
        ws.onopen = () => {
          console.log('WebSocket connection established');
          
          // Register identity on WebSocket as well
          if (telegramUser?.id || (isWalletConnected && walletAddress)) {
            ws.send(JSON.stringify({
              type: 'identity',
              identity: {
                telegramId: telegramUser?.id ? telegramUser.id.toString() : undefined,
                telegramUsername: telegramUser?.username,
                tonWalletAddress: isWalletConnected ? walletAddress : undefined
              }
            }));
          }
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('WebSocket message received:', data);
          } catch (err) {
            console.error('Failed to parse WebSocket message:', err);
          }
        };
        
        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
        
        ws.onclose = () => {
          console.log('WebSocket connection closed');
          wsRef.current = null;
        };
      } catch (err) {
        console.error('Failed to establish WebSocket connection:', err);
      }
      
      // Register user identity with socket
      if (telegramUser?.id || (isWalletConnected && walletAddress)) {
        // Prepare identity registration data
        const identityData = {
          telegramId: telegramUser?.id ? telegramUser.id.toString() : undefined,
          telegramUsername: telegramUser?.username,
          tonWalletAddress: isWalletConnected ? walletAddress : undefined
        };
        
        // Log identity data for debugging
        console.log("Registering user identity:", JSON.stringify({
          telegramId: telegramUser?.id ? 'Yes' : 'No',
          telegramUsername: telegramUser?.username ? 'Yes' : 'No',
          tonWalletAddress: isWalletConnected ? 'Yes' : 'No'
        }));
        
        // Send registration info to server
        socket.emit('register', identityData);
        
        setStatusMessage(`Registered with ${telegramUser?.id ? 'Telegram' : ''}${(telegramUser?.id && isWalletConnected) ? ' and ' : ''}${isWalletConnected ? 'TON wallet' : ''}`);
      } else {
        console.warn("No identity available for registration");
        setStatusMessage("Warning: No Telegram or TON identity available");
      }
      
      // Listen for match event
      socket.on('match', (data: MatchData) => {
        setStatusMessage('Connected with a user');
        setIsMatched(true);
        setIsWaiting(false);
        if (data.peerUsername) {
          setPeerUsername(data.peerUsername);
        }
        createPeerConnection(data.initiator);
      });
      
      // Listen for signal data
      socket.on('signal', (data: SignalData) => {
        if (peerRef.current) {
          peerRef.current.signal(data);
        }
      });
      
      // Listen for user disconnected
      socket.on('user-disconnected', () => {
        setStatusMessage('Other user disconnected');
        setIsMatched(false);
        setPeerUsername(null);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
        // Keep the local stream active but reset the peer connection
        if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
        }
      });

      // Listen for no-matches-available event
      socket.on('no-matches-available', () => {
        setStatusMessage('No users available for matching. Waiting...');
      });

      setStatusMessage("Waiting for a match...");
      
    } catch (err) {
      console.error('Failed to start chat:', err);
      setIsChatStarted(false);
      setIsWaiting(false);
      setStatusMessage('Failed to access camera/microphone');
      toast({
        title: "Error",
        description: "Failed to access camera or microphone. Please check your permissions.",
        variant: "destructive"
      });
    }
  };

  const createPeerConnection = (initiator: boolean) => {
    if (!window.SimplePeer) {
      console.error('SimplePeer library not loaded yet');
      return;
    }
    
    try {
      // Create the peer connection
      const peer = new window.SimplePeer({
        initiator,
        trickle: false,
        stream: localStreamRef.current as MediaStream,
      });
      
      peerRef.current = peer;
      
      // Handle signal events (for WebRTC handshake)
      peer.on('signal', (data: SignalData) => {
        if (socketRef.current) {
          socketRef.current.emit('signal', data);
        }
      });
      
      // Handle incoming stream
      peer.on('stream', (stream: MediaStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      });
      
      // Handle errors
      peer.on('error', (err: Error) => {
        console.error('Peer connection error:', err);
        toast({
          title: "Connection Error",
          description: "There was a problem with the video connection.",
          variant: "destructive"
        });
      });
      
    } catch (err) {
      console.error('Failed to create peer connection:', err);
      toast({
        title: "Connection Error",
        description: "Failed to establish peer connection.",
        variant: "destructive"
      });
    }
  };

  const handleEndChat = () => {
    // Reset application state
    setIsChatStarted(false);
    setIsMatched(false);
    setIsWaiting(false);
    setPeerUsername(null);
    setStatusMessage('Chat ended');

    // Close peer connection if exists
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    // Stop local stream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    // Clean up video elements
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    // Disconnect socket
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    // Close WebSocket connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const toggleMicrophone = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMicMuted(!isMicMuted);
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsCameraOff(!isCameraOff);
    }
  };

  return (
    <main className="flex-grow flex flex-col relative">
      {/* Instagram-Style Full Screen Video Container */}
      <div className="relative w-full h-[calc(100vh-0rem)] md:h-[calc(100vh-0rem)] bg-black overflow-hidden">
        {/* Remote Video - Full Screen */}
        <video
          id="remoteVideo"
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`absolute inset-0 w-full h-full object-cover z-10 ${isMatched ? '' : 'opacity-0'}`}
        />
        
        {/* Gradient Overlays - Top and Bottom */}
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/80 to-transparent z-20"></div>
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/80 to-transparent z-20"></div>
        
        {/* Initial Empty State - Centered in View */}
        <div 
          className={`absolute inset-0 flex flex-col items-center justify-center z-20 ${isMatched || isWaiting ? 'hidden' : ''}`}
        >
          <div className="text-center p-6 rounded-3xl bg-black/30 backdrop-blur-md border border-white/10 max-w-xs">
            {!isChatStarted ? (
              <>
                <div className="w-20 h-20 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 mx-auto flex items-center justify-center mb-5">
                  <VideoIcon className="h-10 w-10 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-3">Start Chatting</h3>
                <p className="text-gray-300 text-sm mb-6">
                  Connect with random users through secure Telegram or TON wallet identity
                </p>
                {/* Button moved to bottom of screen */}
              </>
            ) : (
              <>
                <User className="h-14 w-14 text-gray-400 mb-4" />
                <span className="text-xl text-gray-300 font-medium">Looking for someone</span>
                <span className="text-sm text-gray-400 mt-2">Wait a moment...</span>
              </>
            )}
          </div>
        </div>
        
        {/* Top Status Bar - Similar to Instagram Stories */}
        <div className="absolute top-0 inset-x-0 pt-10 px-4 flex items-center justify-between z-30">
          {/* Status Badge - Always Visible */}
          <Badge 
            variant="outline" 
            className={`px-4 py-1.5 text-sm font-medium ${
              isMatched ? 'bg-green-900/60 text-green-300 border-green-800' : 
              isWaiting ? 'bg-yellow-900/60 text-yellow-300 border-yellow-800' : 
              'bg-blue-900/60 text-blue-300 border-blue-800'
            } backdrop-blur-sm shadow-lg`}
          >
            {statusMessage}
          </Badge>
          
          {/* User Profile (Self) Button */}
          <div className="flex items-center">
            <Button 
              variant="ghost" 
              size="icon" 
              className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm border border-white/20"
            >
              <Settings className="h-5 w-5 text-white" />
            </Button>
          </div>
        </div>
        
        {/* Side Action Buttons - Instagram Reels Style */}
        <div className="absolute right-4 bottom-32 flex flex-col gap-4 items-center z-30">
          {/* Profile Button - For Stranger */}
          {isMatched && (
            <div className="flex flex-col items-center gap-1">
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-purple-500 to-purple-700 flex items-center justify-center overflow-hidden border-2 border-white">
                <User className="h-6 w-6 text-white" />
              </div>
              <span className="text-xs font-medium text-white bg-black/40 px-2 py-0.5 rounded-full">
                {peerUsername ? peerUsername : 'Stranger'}
              </span>
            </div>
          )}
          
          {/* Like Button - Similar to Instagram Reels */}
          <Button 
            variant="ghost" 
            size="icon" 
            className={`w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm ${isMatched ? '' : 'opacity-50'}`}
            disabled={!isMatched}
          >
            <Heart className="h-6 w-6 text-white" />
          </Button>
          
          {/* TON Connect Button */}
          <Button 
            variant="ghost" 
            size="icon" 
            className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500/80 to-purple-600/80 backdrop-blur-sm"
          >
            <Wallet className="h-6 w-6 text-white" />
          </Button>
          
          {/* Share Button */}
          <Button 
            variant="ghost" 
            size="icon" 
            className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm"
          >
            <Share className="h-6 w-6 text-white" />
          </Button>
        </div>
        
        {/* Local Video PiP - Draggable Small Circle on Bottom */}
        <div 
          className={`absolute bottom-28 left-4 w-20 h-20 rounded-full overflow-hidden shadow-xl border-2 border-white z-30 ${!isChatStarted ? 'hidden' : ''}`}
        >
          <video
            id="localVideo"
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 w-full h-full object-cover ${isCameraOff ? 'hidden' : ''}`}
          />
          
          {/* Camera Off State for PiP */}
          <div 
            className={`absolute inset-0 flex flex-col items-center justify-center bg-gray-800 ${!isCameraOff ? 'hidden' : ''}`}
          >
            <VideoOff className="h-8 w-8 text-white" />
          </div>
          
          {/* Mic indicator for PiP */}
          {isMicMuted && (
            <div className="absolute top-0 right-0 bg-red-500/90 w-6 h-6 rounded-full flex items-center justify-center">
              <MicOff className="h-3 w-3 text-white" />
            </div>
          )}
        </div>
        
        {/* Bottom Controls - Instagram-Style Fixed Position at Bottom */}
        <div className="absolute bottom-8 inset-x-0 flex justify-center items-center gap-4 z-30">
          {!isChatStarted ? (
            // Start Chat Button - Only when not started
            <Button
              size="lg"
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-medium px-8 py-6 rounded-full shadow-lg w-4/5 max-w-xs"
              onClick={handleStartChat}
            >
              <VideoIcon className="h-5 w-5 mr-2" />
              <span>Start Random Chat</span>
            </Button>
          ) : (
            // Call Controls - Only shown when in chat
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="icon"
                className={`rounded-full w-16 h-16 ${isMicMuted 
                  ? 'bg-red-600/80 hover:bg-red-700/80 text-white border-red-400' 
                  : 'bg-black/40 hover:bg-black/60 text-white border-white/30'}`}
                onClick={toggleMicrophone}
              >
                {isMicMuted ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
              </Button>
              
              <Button
                variant="destructive"
                size="icon"
                className="rounded-full w-16 h-16 bg-red-600 hover:bg-red-700"
                onClick={handleEndChat}
              >
                <X className="h-8 w-8" />
              </Button>
              
              <Button
                variant="outline"
                size="icon"
                className={`rounded-full w-16 h-16 ${isCameraOff 
                  ? 'bg-red-600/80 hover:bg-red-700/80 text-white border-red-400' 
                  : 'bg-black/40 hover:bg-black/60 text-white border-white/30'}`}
                onClick={toggleCamera}
              >
                {isCameraOff ? <VideoOff className="h-7 w-7" /> : <Video className="h-7 w-7" />}
              </Button>
            </div>
          )}
        </div>
        
        {/* Waiting Overlay - Instagram-Style Spinner */}
        <div 
          className={`absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-40 ${isWaiting ? '' : 'hidden'}`}
        >
          <div className="w-24 h-24 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 p-1 animate-pulse flex items-center justify-center mb-8">
            <div className="w-full h-full rounded-full bg-black flex items-center justify-center">
              <Loader2 className="h-12 w-12 text-blue-400 animate-spin" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 mb-3">
            Finding someone to chat with...
          </h2>
          <p className="text-gray-300 text-center max-w-xs mb-6">
            Looking for users with Telegram or TON wallet identity
          </p>
          <div className="flex items-center gap-2 bg-black/50 border border-white/10 px-4 py-2 rounded-full">
            <RefreshCw className="h-4 w-4 text-blue-400 animate-spin" />
            <span className="text-sm text-gray-300">This may take a moment</span>
          </div>
        </div>
      </div>
    </main>
  );
};

declare global {
  interface Window {
    SimplePeer: any;
  }
}

export default VideoChat;
