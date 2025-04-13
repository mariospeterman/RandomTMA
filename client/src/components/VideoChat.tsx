import React, { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import SimplePeer from "simple-peer";
import { Button } from "@/components/ui/button";
import { 
  Video, 
  VideoOff, 
  Mic, 
  MicOff, 
  PhoneCall, 
  PhoneOff, 
  UserRoundX,
  User,
  Settings,
  Wallet,
  MapPin,
  ChevronRight,
  Heart,
  MoreVertical,
  X,
  Play,
  UserCircle,
  Bug,
  AlertTriangle
} from "lucide-react";
import { TelegramUserData } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useTonConnect } from "@/hooks/useTonConnect";
import { Loader2 } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import './VideoChat.css';

// Fix type declarations
declare global {
  interface Window {
    SimplePeer: any;
  }
}

// Define RTCIceServer interface
interface RTCIceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// Define missing RTC types
type RTCSdpSemantics = 'plan-b' | 'unified-plan';

// Define SimplePeer namespace for TypeScript
declare namespace SimplePeer {
  interface Instance {
    connected?: boolean;
    on(event: string, callback: Function): void;
    signal(data: any): void;
    destroy(): void;
  }
  
  interface SimplePeerOptions {
    initiator?: boolean;
    stream?: MediaStream | undefined;
    trickle?: boolean;
    config?: any;
    debug?: boolean;
    sdpTransform?: (sdp: string) => string;
  }
}

interface VideoChatProps {
  telegramUser: TelegramUserData | null;
  walletAddress: string | null;
}

interface PeerInfo {
  telegramId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  location?: string;
}

// Parse TURN server configuration from environment variables
const getTurnServerConfig = () => {
  const turnUrls = import.meta.env.VITE_TURN_SERVER_URLS?.split(',') || [];
  const turnUsername = import.meta.env.VITE_TURN_USERNAME || 'openrelayproject';
  const turnPassword = import.meta.env.VITE_TURN_PASSWORD || 'openrelayproject';
  const forceRelay = import.meta.env.VITE_FORCE_TURN_RELAY === 'true';
  
  return {
    turnUrls,
    turnUsername,
    turnPassword,
    iceTransportPolicy: forceRelay ? 'relay' as RTCIceTransportPolicy : 'all' as RTCIceTransportPolicy
  };
};

// Get optimized WebRTC configuration for cross-platform compatibility
const getOptimizedPeerConfig = () => {
  const { turnUrls, turnUsername, turnPassword, iceTransportPolicy } = getTurnServerConfig();
  
  // Standard ICE servers
  const iceServers: RTCIceServerConfig[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ];
  
  // Add custom TURN servers if provided
  if (turnUrls.length > 0) {
    turnUrls.forEach((url: string) => {
      iceServers.push({
        urls: url,
        username: turnUsername,
        credential: turnPassword
      });
    });
  }
  
  return {
    iceServers,
    iceTransportPolicy,
    sdpSemantics: 'unified-plan' as RTCSdpSemantics,
    // Force codec priorities that work well across platforms
    sdpTransform: (sdp: string) => {
      // Prioritize H.264 and VP8 codecs that have better support
      let modifiedSdp = sdp;
      
      // Prioritize common codecs by manipulating payload types
      if (modifiedSdp.includes('m=video')) {
        // This is a simple approach - a more robust solution would parse the SDP properly
        // and reorder based on payload types, but this is effective in most cases
        modifiedSdp = modifiedSdp.replace(/(m=video .*?)( [0-9]+)+/g, (match, prefix) => {
          // Extract all payload types
          const payloads = match.substring(prefix.length).trim().split(' ');
          
          // Identify H.264 and VP8 payload types
          const h264Payloads = payloads.filter(payload => 
            modifiedSdp.includes(`a=rtpmap:${payload} H264/`));
          const vp8Payloads = payloads.filter(payload => 
            modifiedSdp.includes(`a=rtpmap:${payload} VP8/`));
          const otherPayloads = payloads.filter(payload => 
            !h264Payloads.includes(payload) && !vp8Payloads.includes(payload));
          
          // Put H.264 and VP8 first, then others
          const reorderedPayloads = [...h264Payloads, ...vp8Payloads, ...otherPayloads];
          return `${prefix} ${reorderedPayloads.join(' ')}`;
        });
      }
      
      return modifiedSdp;
    }
  };
};

export default function VideoChat({ telegramUser, walletAddress }: VideoChatProps) {
  const { toast } = useToast();
  const [isInChat, setIsInChat] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [remoteVideoPlaying, setRemoteVideoPlaying] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [peerInfo, setPeerInfo] = useState<PeerInfo | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showPlayButton, setShowPlayButton] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [waitTime, setWaitTime] = useState(0);
  const [socketConnected, setSocketConnected] = useState(false);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [hasLocalStream, setHasLocalStream] = useState(false);
  const [showRemotePlayButton, setShowRemotePlayButton] = useState(false);
  const [showLocalPlayButton, setShowLocalPlayButton] = useState(false);
  const [hasPermissions, setHasPermissions] = useState(false);
  const [localVideoPlaying, setLocalVideoPlaying] = useState(false);

  // References
  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const connectionAttempts = useRef(0);
  const hasInitiatedCall = useRef(false);
  const peerConnection = useRef<RTCPeerConnection | null>(null);

  // Add debug logs for troubleshooting
  const addDebugLog = useCallback((message: string) => {
    const timestamp = new Date().toISOString().substring(11, 23);
    const logEntry = `${timestamp}: ${message}`;
    console.log(logEntry);
    setDebugLogs(prevLogs => {
      const newLogs = [...prevLogs, logEntry];
      // Keep only the last 100 logs to prevent memory issues
      return newLogs.slice(-100);
    });
  }, []);

  // Handle errors with proper typing
  const handleError = useCallback((error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    } else if (typeof error === 'string') {
      return error;
    } else {
      return 'Unknown error';
    }
  }, []);

  // Reset chat state function to handle disconnections
  const resetChatState = useCallback(() => {
    setIsInChat(false);
    setIsSearching(false);
    setPeerInfo(null);
    setCurrentRoomId(null);
    setRemoteVideoPlaying(false);
    setShowPlayButton(false);
    setHasRemoteStream(false);
    setPeerId(null);
    
    // Clean up peer connections
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    
    // Clean up remote stream
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
      setRemoteStream(null);
      
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    }
    
    addDebugLog('Chat state reset successfully');
  }, [remoteStream, addDebugLog]);

  // Create a peer connection with the optimized configuration
  const startPeerConnection = useCallback(async (isInitiator: boolean, roomId: string) => {
    try {
      addDebugLog(`Starting peer connection as ${isInitiator ? 'initiator' : 'receiver'} in room ${roomId}`);
      
      // Clean up any existing peer connection
      if (peerRef.current) {
        addDebugLog('Cleaning up existing peer connection');
        peerRef.current.destroy();
        peerRef.current = null;
      }
      
      // Reset connection attempts counter
      connectionAttempts.current = 0;
      
      // Ensure we have a local media stream
      if (!localStream) {
        addDebugLog('Acquiring local media stream');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24 }
          },
          audio: true
        });
        
        // Enable all tracks by default
        stream.getTracks().forEach(track => {
          track.enabled = true;
        });
        
        setLocalStream(stream);
        
        // Attach to local video element
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.muted = true; // Always mute local video to prevent feedback
          localVideoRef.current.play().catch(err => {
            addDebugLog(`Failed to play local video: ${err.message}`);
          });
        }
      }
      
      // Get optimized peer configuration
      const peerConfig = getOptimizedPeerConfig();
      addDebugLog(`Using peer config: ${JSON.stringify(peerConfig)}`);
      
      // Create the peer with optimized configuration
      const peer = new SimplePeer({
        initiator: isInitiator,
        stream: localStream || undefined,
        trickle: true,
        config: peerConfig,
      });
      
      peerRef.current = peer;
      // Handle signals to be sent to the remote peer
      peer.on('signal', (signalData: any) => {
        const signalType = signalData.type || 'candidate';
        addDebugLog(`Sending signal: ${signalType}`);
        
        if (socket) {
          socket.emit('signal', {
            roomId,
            signalData,
          });
        }
      });
      
      // Handle receiving remote stream
      peer.on('stream', (stream: MediaStream) => {
        addDebugLog(`Received remote stream with ${stream.getVideoTracks().length} video tracks and ${stream.getAudioTracks().length} audio tracks`);
        
        // Ensure all tracks are enabled explicitly
        stream.getTracks().forEach(track => {
          track.enabled = true;
          addDebugLog(`Remote track: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState}`);
        });
        
        setRemoteStream(stream);
        
        // Use a robust method to attach stream to video element
        const attachStreamToVideo = () => {
          if (remoteVideoRef.current) {
            // Explicitly set srcObject
            remoteVideoRef.current.srcObject = null;
            remoteVideoRef.current.srcObject = stream;
            
            // Ensure autoplay and muted attributes are set correctly
            remoteVideoRef.current.autoplay = true;
            remoteVideoRef.current.muted = false;
            
            // Try to play the video
            const playPromise = remoteVideoRef.current.play();
            
            if (playPromise !== undefined) {
              playPromise
                .then(() => {
                  addDebugLog('Remote video playback started successfully');
                  setRemoteVideoPlaying(true);
                  setShowPlayButton(false);
                })
                .catch((error: Error) => {
                  addDebugLog(`Failed to autoplay remote video: ${error.message}`);
                  setShowPlayButton(true);
                  
                  // Schedule a retry after a short delay
                  setTimeout(attachStreamToVideo, 1000);
                });
            }
          } else {
            addDebugLog('Remote video ref is not available');
            // Try again shortly
            setTimeout(attachStreamToVideo, 500);
          }
        };
        
        // Start the attachment process
        attachStreamToVideo();
      });
      
      // Handle connection status
      peer.on('connect', () => {
        addDebugLog('Peer connection established');
        toast({
          title: 'Connected',
          description: 'Video connection established',
        });
      });
      
      // Handle connection errors
      peer.on('error', (error: Error) => {
        addDebugLog(`Peer connection error: ${error.message}`);
        
        // Implement a more robust reconnection strategy
        if (isInChat && connectionAttempts.current < 3) {
          connectionAttempts.current += 1;
          addDebugLog(`Attempting reconnection (${connectionAttempts.current}/3)...`);
          
          setTimeout(() => {
            if (isInChat && socket) {
              startPeerConnection(isInitiator, roomId);
            }
          }, 2000);
        } else {
          toast({
            title: 'Connection Error',
            description: 'Failed to establish video chat connection',
            variant: 'destructive',
          });
          
          // Force end the chat if reconnection fails
          if (isInChat && socket) {
            addDebugLog('Ending chat due to connection failure');
            socket.emit('end_chat', { roomId });
            cleanupChat();
          }
        }
      });
      
    } catch (error: unknown) {
      addDebugLog(`Error starting peer connection: ${handleError(error)}`);
      console.error('Error starting peer connection:', error);
      
      toast({
        title: 'Media Error',
        description: `Could not access camera/microphone: ${handleError(error)}`,
        variant: 'destructive',
      });
      
      // Report detailed error for debugging
      if (socket) {
        socket.emit('error_report', {
          type: 'peer_connection',
          error: handleError(error),
          userAgent: navigator.userAgent
        });
      }
    }
  }, [videoEnabled, audioEnabled, localStream, isInChat, socket, handleError]);
  
  // Handle incoming signals
  useEffect(() => {
    if (!socket) return;
    
    const handleSignal = (data: any) => {
      addDebugLog(`Received signal: ${data.signalData.type || 'candidate'}`);
      if (peerRef.current && isInChat) {
        try {
          peerRef.current.signal(data.signalData);
        } catch (err: any) {
          addDebugLog(`Error processing signal: ${err.message}`);
        }
      } else {
        addDebugLog('Received signal but peer is not ready');
      }
    };
    
    socket.on('signal', handleSignal);
    
    return () => {
      socket.off('signal', handleSignal);
    };
  }, [socket, isInChat]);
  
  // Monitor remote video to ensure it's playing correctly
  useEffect(() => {
    if (!remoteStream || !isInChat || !remoteVideoRef.current) return;
    
    const ensureVideoIsPlaying = () => {
      try {
        if (remoteVideoRef.current && remoteStream) {
          // If video element doesn't have the remote stream properly attached
          if (remoteVideoRef.current.srcObject !== remoteStream) {
            addDebugLog('Re-attaching remote stream to video element');
            remoteVideoRef.current.srcObject = remoteStream;
            
            remoteVideoRef.current.play()
              .then(() => setRemoteVideoPlaying(true))
              .catch(err => {
                addDebugLog(`Failed to play remote video: ${err.message}`);
                setShowPlayButton(true);
              });
          }
          
          // If video is paused, try to play it
          if (remoteVideoRef.current.paused) {
            addDebugLog('Remote video is paused, attempting to play');
            
            remoteVideoRef.current.play()
              .then(() => {
                setRemoteVideoPlaying(true);
                setShowPlayButton(false);
              })
              .catch(err => {
                addDebugLog(`Failed to resume video: ${err.message}`);
                setShowPlayButton(true);
              });
          }
        }
      } catch (err: any) {
        addDebugLog(`Error in video visibility check: ${err.message}`);
      }
    };
    
    // Run immediately and then periodically at a higher frequency for better recovery
    ensureVideoIsPlaying();
    const intervalId = setInterval(ensureVideoIsPlaying, 2000); // Check every 2 seconds
    
    return () => clearInterval(intervalId);
  }, [remoteStream, isInChat]);
  
  // Check connection status - memoized to prevent infinite renders
  const checkConnectionStatus = useCallback(() => {
    if (!socket) {
      return "Not initialized";
    }
    
    if (socket.connected) {
      return "Connected";
    } else {
      return "Disconnected";
    }
  }, [socket]);
  
  // Setup socket connection
  useEffect(() => {
    addDebugLog('Setting up socket connection');
    
    // Create socket connection
    const newSocket = io(`${import.meta.env.VITE_API_URL || ''}/video-chat`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000
    });
    
    setSocket(newSocket);
    
    // Socket event handlers
    newSocket.on('connect', () => {
      addDebugLog(`Socket connected: ${newSocket.id}`);
      setSocketConnected(true);
    });
    
    newSocket.on('disconnect', () => {
      addDebugLog(`Socket disconnected`);
      setSocketConnected(false);
      
      // Clean up chat state if we were in a chat
      if (isInChat) {
        toast({
          title: 'Connection lost',
          description: 'You were disconnected from the server.',
          variant: 'destructive',
        });
        resetChatState();
      }
    });
    
    newSocket.on('error', (error) => {
      addDebugLog(`Socket error: ${error}`);
      toast({
        title: 'Connection Error',
        description: 'There was a problem with the connection.',
        variant: 'destructive',
      });
    });
    
    newSocket.on('connect_error', (error) => {
      addDebugLog(`Socket connect_error: ${error.message}`);
      toast({
        title: 'Connection Error',
        description: 'Could not connect to the server. Will retry automatically.',
        variant: 'destructive',
      });
    });
    
    newSocket.on('online-count', (count: number) => {
      setOnlineCount(count);
    });
    
    return () => {
      addDebugLog('Cleaning up socket connection');
      newSocket.off('connect');
      newSocket.off('disconnect');
      newSocket.off('error');
      newSocket.off('connect_error');
      newSocket.off('online-count');
      newSocket.off('match-found');
      newSocket.off('chat-ended');
      newSocket.off('ice-candidate');
      newSocket.off('offer');
      newSocket.off('answer');
      newSocket.close();
    };
  }, []);

  // Handle socket reconnection
  useEffect(() => {
    if (!socket) return;
    
    // Re-register for searching if we were searching before disconnect
    if (socketConnected && isSearching) {
      addDebugLog('Re-registering for search after reconnection');
      socket.emit('start-searching');
    }
  }, [socketConnected, isSearching, socket]);

  // Set up signaling after socket is established
  useEffect(() => {
    if (!socket || !socketConnected) return;
    
    addDebugLog('Setting up signaling event handlers');
    
    // Handler for when a match is found
    socket.on('match-found', (data: { peerId: string }) => {
      addDebugLog(`Match found with peer: ${data.peerId}`);
      setPeerId(data.peerId);
      setIsInChat(true);
      setIsSearching(false);
      setWaitTime(0);
      
      toast({
        title: 'Match found!',
        description: 'You are now connected with someone.',
      });
      
      // Initialize WebRTC connection as the initiator
      initializeWebRTC(true);
    });
    
    // Handler for when the other person ends the chat
    socket.on('chat-ended', () => {
      addDebugLog('Chat ended by peer');
      toast({
        title: 'Chat Ended',
        description: 'The other person has left the chat.',
      });
      resetChatState();
    });
    
    // Handler for ICE candidates
    socket.on('ice-candidate', (iceCandidate: RTCIceCandidate) => {
      addDebugLog(`Received ICE candidate: ${iceCandidate.candidate.substring(0, 50)}...`);
      
      if (peerConnection.current && peerConnection.current.signalingState !== 'closed') {
        peerConnection.current.addIceCandidate(iceCandidate)
          .then(() => addDebugLog('Added ICE candidate successfully'))
          .catch(err => addDebugLog(`Error adding ICE candidate: ${err.message}`));
      } else {
        addDebugLog('Cannot add ICE candidate: peer connection is null or closed');
      }
    });
    
    // Handler for offer
    socket.on('offer', async (offer: RTCSessionDescriptionInit) => {
      addDebugLog(`Received offer: ${JSON.stringify(offer).substring(0, 50)}...`);
      
      // Initialize WebRTC as the non-initiator
      await initializeWebRTC(false);
      
      try {
        if (peerConnection.current) {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
          addDebugLog('Set remote description from offer');
          
          const answer = await peerConnection.current.createAnswer();
          await peerConnection.current.setLocalDescription(answer);
          addDebugLog('Created and set local answer');
          
          socket.emit('answer', answer, peerId);
          addDebugLog('Sent answer to peer');
        } else {
          addDebugLog('Cannot process offer: peer connection is null');
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        addDebugLog(`Error handling offer: ${errorMessage}`);
        toast({
          title: 'Connection Error',
          description: 'Failed to establish video connection.',
          variant: 'destructive',
        });
      }
    });
    
    // Handler for answer
    socket.on('answer', (answer: RTCSessionDescriptionInit) => {
      addDebugLog(`Received answer: ${JSON.stringify(answer).substring(0, 50)}...`);
      
      if (peerConnection.current && peerConnection.current.signalingState !== 'closed') {
        peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer))
          .then(() => addDebugLog('Set remote description from answer'))
          .catch(err => addDebugLog(`Error setting remote description: ${err.message}`));
      } else {
        addDebugLog('Cannot process answer: peer connection is null or closed');
      }
    });
    
    return () => {
      // Cleanup handled in the main socket cleanup
    };
  }, [socket, socketConnected, peerId]);
  
  // Register with server when user data is available
  useEffect(() => {
    if (socket && telegramUser) {
      // Register with the server using Telegram user data
      addDebugLog(`Registering user with server: ${telegramUser.id}`);
      
      // Ensure telegramId is sent as a number, not string
      const telegramId = typeof telegramUser.id === 'string' 
        ? parseInt(telegramUser.id, 10) 
        : telegramUser.id;
      
      socket.emit('register', {
        telegramId,
        username: telegramUser.username,
        firstName: telegramUser.firstName,
        lastName: telegramUser.lastName
      });
      
      // Listen for registration confirmation
      socket.on('registered', (data) => {
        addDebugLog(`Registration successful: ${JSON.stringify(data)}`);
        // Request online user count after registration
        socket.emit('get_online_count');
      });
      
      // Listen for online user count updates
      socket.on('online_count', (data) => {
        addDebugLog(`Online users: ${data.count}, Searching: ${data.searching}, In Chat: ${data.inChat}`);
        setOnlineCount(data.count);
      });
    }
  }, [socket, telegramUser]);
  
  // Start searching for a chat partner
  const startSearching = useCallback(() => {
    if (!socket) {
      addDebugLog('Cannot start searching - socket not connected');
      toast({
        title: 'Connection Error',
        description: 'Not connected to the server',
        variant: 'destructive',
      });
      return;
    }
    
    if (!telegramUser) {
      addDebugLog('Cannot start searching - no Telegram user data');
      toast({
        title: 'Authentication Required',
        description: 'Please ensure you are logged into Telegram',
        variant: 'destructive',
      });
      return;
    }
    
    // Request camera/mic access before searching
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        // Store the stream
        setLocalStream(stream);
        
        // Attach local stream to video element
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play()
            .catch(err => {
              addDebugLog(`Error playing local video: ${err.message}`);
            });
        }
        
        // Then start searching
        addDebugLog('Starting search for chat partner');
        setIsSearching(true);
        socket.emit('start_matching');
        
        toast({
          title: 'Searching',
          description: 'Looking for someone to chat with...',
        });
      })
      .catch(err => {
        addDebugLog(`Media access error: ${err.message}`);
        toast({
          title: 'Camera/Microphone Error',
          description: 'Please allow access to your camera and microphone.',
          variant: 'destructive',
        });
      });
  }, [socket, telegramUser]);
  
  // Cancel searching
  const cancelSearch = useCallback(() => {
    if (socket && isSearching) {
      addDebugLog('Cancelling search');
      socket.emit('cancel_matching');
      setIsSearching(false);
      
      // Stop local stream
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        setLocalStream(null);
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
      }
      
      toast({
        title: 'Search Cancelled',
        description: 'You have cancelled the search',
      });
    }
  }, [socket, isSearching, localStream]);
  
  // End current chat
  const endChat = useCallback(() => {
    if (socket && isInChat && currentRoomId) {
      addDebugLog(`Ending chat in room ${currentRoomId}`);
      socket.emit('end_chat', { roomId: currentRoomId });
      cleanupChat();
      
      toast({
        title: 'Chat Ended',
        description: 'You have ended the chat',
      });
    }
  }, [socket, isInChat, currentRoomId]);
  
  // Clean up resources when chat ends
  const cleanupChat = useCallback(() => {
    addDebugLog('Cleaning up chat resources');
    resetChatState();
  }, [resetChatState, addDebugLog]);
  
  // Toggle video
  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setVideoEnabled(!videoEnabled);
      
      addDebugLog(`Video ${!videoEnabled ? 'enabled' : 'disabled'}`);
    }
  }, [localStream, videoEnabled]);
  
  // Toggle audio
  const toggleAudio = useCallback(() => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setAudioEnabled(!audioEnabled);
      
      addDebugLog(`Audio ${!audioEnabled ? 'enabled' : 'disabled'}`);
    }
  }, [localStream, audioEnabled]);
  
  // Function to handle manual play of remote video
  const handleManualPlay = () => {
    addDebugLog('Manual play button clicked');
    if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
      remoteVideoRef.current.play()
        .then(() => {
          addDebugLog('Remote video started playing after manual intervention');
          setRemoteVideoPlaying(true);
          setShowPlayButton(false);
        })
        .catch(err => {
          addDebugLog(`Still failed to play after manual intervention: ${err.message}`);
          toast({
            title: 'Playback Error',
            description: 'Could not play video. Please check your browser settings.',
            variant: 'destructive',
          });
        });
    } else {
      addDebugLog('Cannot play: remoteVideoRef or srcObject is null');
      toast({
        title: 'Video Error',
        description: 'No video stream available to play',
        variant: 'destructive',
      });
    }
  };

  // Check for remote video health
  useEffect(() => {
    if (!remoteStream || !isInChat) return;
    
    const videoInterval = setInterval(() => {
      if (remoteVideoRef.current) {
        // Check if video element is actually playing
        const isPlaying = !remoteVideoRef.current.paused && 
                          !remoteVideoRef.current.ended && 
                          remoteVideoRef.current.readyState > 2;
                          
        // Log status periodically for debugging
        if (remoteStream) {
          const videoTracks = remoteStream.getVideoTracks();
          const audioTracks = remoteStream.getAudioTracks();
          
          addDebugLog(`Remote video health check: playing=${isPlaying}, ` +
                      `videoTracks=${videoTracks.length} (${videoTracks.map(t => t.enabled ? 'enabled' : 'disabled').join(',')}), ` +
                      `audioTracks=${audioTracks.length} (${audioTracks.map(t => t.enabled ? 'enabled' : 'disabled').join(',')})` +
                      `readyState=${remoteVideoRef.current.readyState}, ` +
                      `networkState=${remoteVideoRef.current.networkState}`);
        }
        
        // Update UI state based on actual playback status
        setRemoteVideoPlaying(isPlaying);
        setShowPlayButton(!isPlaying);
        
        // If video is not playing after receiving stream, try to play it again
        if (!isPlaying && remoteStream && !showPlayButton) {
          addDebugLog('Detected video not playing despite having stream, attempting to restart playback');
          remoteVideoRef.current.play().catch(err => {
            addDebugLog(`Auto-recovery play failed: ${err.message}`);
            setShowPlayButton(true);
          });
        }
      }
    }, 5000);  // Check every 5 seconds
    
    return () => clearInterval(videoInterval);
  }, [remoteStream, isInChat, showPlayButton]);

  // Initialize WebRTC connection
  const initializeWebRTC = async (isInitiator: boolean) => {
    addDebugLog(`Initializing WebRTC as ${isInitiator ? 'initiator' : 'receiver'}`);
    
    try {
      // Close any existing connection
      if (peerConnection.current) {
        peerConnection.current.close();
        addDebugLog('Closed existing peer connection');
      }
      
      // Create a new RTCPeerConnection
      const configuration = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
        ],
        iceCandidatePoolSize: 10
      };
      
      const pc = new RTCPeerConnection(configuration);
      peerConnection.current = pc;
      addDebugLog('Created new peer connection');
      
      // Set up event handlers for the peer connection
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          addDebugLog(`Generated ICE candidate: ${event.candidate.candidate.substring(0, 50)}...`);
          socket?.emit('ice-candidate', event.candidate, peerId);
        }
      };
      
      pc.oniceconnectionstatechange = () => {
        addDebugLog(`ICE connection state changed to: ${pc.iceConnectionState}`);
        
        if (pc.iceConnectionState === 'disconnected' || 
            pc.iceConnectionState === 'failed' || 
            pc.iceConnectionState === 'closed') {
          addDebugLog(`ICE connection ${pc.iceConnectionState}, handling potential disconnect`);
          
          if (isInChat) {
            toast({
              title: 'Connection Issue',
              description: `Media connection ${pc.iceConnectionState}. Trying to recover...`,
              variant: 'destructive',
            });
            
            // If the connection is completely failed, reset the chat
            if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
              resetChatState();
            }
          }
        }
      };
      
      pc.ontrack = (event) => {
        addDebugLog(`Received remote track: ${event.track.kind}`);
        
        // Create a new MediaStream if we don't have one
        if (!remoteStream) {
          const newRemoteStream = new MediaStream();
          addDebugLog('Created new remote MediaStream');
          setRemoteStream(newRemoteStream);
          
          // Add the track to our remote stream
          newRemoteStream.addTrack(event.track);
          addDebugLog(`Added remote ${event.track.kind} track to remote stream`);
          
          // Attach the stream to the video element with retry mechanism
          attachStreamToVideo('remoteVideo', newRemoteStream);
        } else {
          // Make sure we don't add the same track twice
          const trackExists = remoteStream.getTracks().some(
            t => t.id === event.track.id
          );
          
          if (!trackExists) {
            remoteStream.addTrack(event.track);
            addDebugLog(`Added ${event.track.kind} track to existing remote stream`);
          }
        }
      };
      
      // Get local media stream
      try {
        // Request basic video and audio to maximize compatibility
        const constraints = {
          video: true,
          audio: true
        };
        
        // Get media stream with the specified constraints
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setLocalStream(stream);
        addDebugLog(`Got local stream with ${stream.getVideoTracks().length} video tracks and ${stream.getAudioTracks().length} audio tracks`);
        
        // Ensure all tracks are enabled
        stream.getTracks().forEach(track => {
          track.enabled = true;
          addDebugLog(`Enabled ${track.kind} track: ${track.label}`);
        });
        
        // Add all tracks to the peer connection
        stream.getTracks().forEach(track => {
          addDebugLog(`Adding ${track.kind} track to peer connection`);
          pc.addTrack(track, stream);
        });
        
        // Attach the stream to the video element
        attachStreamToVideo('localVideo', stream);
        
        // Create and send offer if we are the initiator
        if (isInitiator) {
          addDebugLog('Creating offer as initiator');
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
          });
          
          await pc.setLocalDescription(offer);
          addDebugLog('Set local description from offer');
          
          socket?.emit('offer', offer, peerId);
          addDebugLog('Sent offer to peer');
        }
        
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        addDebugLog(`Error getting local stream: ${errorMessage}`);
        toast({
          title: 'Media Error',
          description: 'Could not access camera or microphone. Please check permissions.',
          variant: 'destructive',
        });
      }
      
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      addDebugLog(`Error initializing WebRTC: ${errorMessage}`);
      toast({
        title: 'Connection Error',
        description: 'Failed to initialize video connection.',
        variant: 'destructive',
      });
    }
  };

  // Helper function to attach a stream to a video element with retry
  const attachStreamToVideo = (videoId: string, stream: MediaStream) => {
    addDebugLog(`Attaching stream to ${videoId}`);
    
    const videoElement = document.getElementById(videoId) as HTMLVideoElement;
    if (!videoElement) {
      addDebugLog(`Video element ${videoId} not found`);
      return;
    }
    
    // Set the srcObject to the stream
    videoElement.srcObject = stream;
    
    // Add playback controls for troubleshooting
    videoElement.controls = true;
    
    // Function to handle playback
    const attemptPlay = async () => {
      try {
        addDebugLog(`Attempting to play ${videoId}`);
        await videoElement.play();
        addDebugLog(`${videoId} playback started successfully`);
        
        // Add a visible indicator that video is playing
        if (videoId === 'remoteVideo') {
          setRemoteVideoPlaying(true);
        } else {
          setLocalVideoPlaying(true);
        }
        
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        addDebugLog(`Error playing ${videoId}: ${errorMessage}`);
        
        // If autoplay fails, show a play button overlay
        if (videoId === 'remoteVideo') {
          setShowRemotePlayButton(true);
        } else {
          setShowLocalPlayButton(true);
        }
        
        // Try again with a timeout in case it's a temporary issue
        setTimeout(attemptPlay, 1000);
      }
    };
    
    // Start playing as soon as metadata is loaded
    videoElement.onloadedmetadata = () => {
      addDebugLog(`${videoId} metadata loaded`);
      attemptPlay();
    };
  };

  return (
    <div className="video-chat-container">
      <div className="video-container">
        <div className="video-wrapper local-video-wrapper">
          <video
            ref={localVideoRef}
            className="local-video"
            autoPlay
            playsInline
            muted
          />
          {showLocalPlayButton && (
            <div className="play-button-overlay" onClick={handleManualPlay}>
              <button className="play-button">
                <svg width="50" height="50" viewBox="0 0 24 24">
                  <path fill="white" d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          )}
          {hasLocalStream && (
            <div className="stream-status local">
              <span className="status-dot active"></span> Your camera
            </div>
          )}
        </div>
        
        <div className="video-wrapper remote-video-wrapper">
          <video
            ref={remoteVideoRef}
            className="remote-video"
            autoPlay
            playsInline
          />
          {showRemotePlayButton && (
            <div className="play-button-overlay" onClick={handleManualPlay}>
              <button className="play-button">
                <svg width="50" height="50" viewBox="0 0 24 24">
                  <path fill="white" d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          )}
          {hasRemoteStream && (
            <div className="stream-status remote">
              <span className="status-dot active"></span> Stranger's camera
            </div>
          )}
          {isInChat && !hasRemoteStream && (
            <div className="stream-status remote warning">
              <span className="status-dot inactive"></span> Waiting for stranger's video...
            </div>
          )}
        </div>
      </div>

      <div className="controls">
        {!isInChat && !isSearching && (
          <button
            className="start-button"
            onClick={startSearching}
            disabled={!socketConnected || !hasPermissions}
          >
            Start Random Chat
          </button>
        )}
        {isSearching && (
          <div className="searching-indicator">
            <div className="spinner"></div>
            <p>Searching for a partner... {waitTime > 0 ? `${waitTime}s` : ''}</p>
            <p className="online-count">{onlineCount} people online</p>
            <button className="cancel-button" onClick={cancelSearch}>
              Cancel
            </button>
          </div>
        )}
        {isInChat && (
          <button className="end-button" onClick={endChat}>
            End Chat & Find New
          </button>
        )}
      </div>

      {/* Debug logs */}
      <div className="debug-logs">
        <button
          onClick={() => {
            // Toggle display of logs
            const logsElement = document.querySelector('.logs');
            if (logsElement) {
              logsElement.classList.toggle('show');
            }
          }}
        >
          Toggle Logs
        </button>
        <div className="logs">
          {debugLogs.map((log, index) => (
            <div key={index} className="log-entry">
              {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
