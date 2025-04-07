import { useEffect, useState, useRef, useCallback } from "react";
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
  X
} from "lucide-react";
import { TelegramUserData } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useTonConnect } from "@/hooks/useTonConnect";

// Add type declaration for SimplePeer
declare global {
  interface Window {
    SimplePeer: any;
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

export default function VideoChat({ telegramUser, walletAddress }: VideoChatProps) {
  const { toast } = useToast();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isInChat, setIsInChat] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [peerInfo, setPeerInfo] = useState<PeerInfo | null>(null);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  
  // TON Connect functionality
  const tonConnect = useTonConnect();
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<any>(null);
  
  // Debug logger
  const addDebugLog = useCallback((message: string) => {
    console.log(`[DEBUG] ${message}`);
    setDebugLog(prev => [...prev.slice(-49), `${new Date().toISOString().split('T')[1].split('.')[0]} - ${message}`]);
  }, []);
  
  // Special handling for Telegram Desktop to ensure video visibility
  useEffect(() => {
    if (!remoteStream || !isInChat) return;
    
    // Check if we're in Telegram WebApp environment
    const isTelegramWebApp = !!window.Telegram?.WebApp;
    if (!isTelegramWebApp) return;
    
    // Function to ensure video is playing
    const ensureVideoIsPlaying = () => {
      if (!remoteVideoRef.current || !remoteStream) return;
      
      try {
        // If we have active video tracks but video element is not showing them
        const videoTracks = remoteStream.getVideoTracks();
        if (videoTracks.length > 0 && videoTracks[0].enabled) {
          addDebugLog('Telegram Desktop: Checking video element visibility');
          
          // Check if video has proper dimensions and is playing
          const videoElement = remoteVideoRef.current;
          
          // Force renegotiation for Telegram Desktop
          if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0 || videoElement.readyState < 2) {
            addDebugLog('Telegram Desktop: Video not showing properly, attempting recovery');
            
            // Try to force video display with style modifications
            videoElement.style.display = 'none';
            
            // Force layout recalculation
            setTimeout(() => {
              if (remoteVideoRef.current) {
                // Show video again with explicit size
                remoteVideoRef.current.style.display = 'block';
                
                // Temporarily detach and reattach the stream
                const tempStream = remoteVideoRef.current.srcObject;
                remoteVideoRef.current.srcObject = null;
                
                // Trigger renegotiation if possible
                if (peerRef.current && peerRef.current.negotiated) {
                  addDebugLog('Attempting to renegotiate connection');
                  try {
                    peerRef.current.negotiate();
                  } catch (err) {
                    addDebugLog(`Negotiation attempt failed: ${err}`);
                    // Continue with stream reattachment anyway
                  }
                }
                
                // Reattach with a slight delay
                setTimeout(() => {
                  if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = tempStream;
                    remoteVideoRef.current.play().catch(err => {
                      addDebugLog(`Failed to play video after reattach: ${err.message}`);
                      
                      // Last resort for Telegram Desktop - create a new element
                      const parentElement = remoteVideoRef.current?.parentElement;
                      if (parentElement) {
                        addDebugLog('Creating backup video element for Telegram Desktop');
                        const backupVideo = document.createElement('video');
                        backupVideo.autoplay = true;
                        backupVideo.playsInline = true;
                        backupVideo.muted = false;
                        backupVideo.style.position = 'absolute';
                        backupVideo.style.inset = '0';
                        backupVideo.style.width = '100%';
                        backupVideo.style.height = '100%';
                        backupVideo.style.objectFit = 'cover';
                        backupVideo.style.zIndex = '11';
                        backupVideo.style.backgroundColor = 'black';
                        backupVideo.srcObject = tempStream;
                        
                        // Add it to the DOM
                        parentElement.appendChild(backupVideo);
                        
                        // Try to play it
                        backupVideo.play().catch(e => {
                          addDebugLog(`Backup video also failed: ${e.message}`);
                        });
                      }
                    });
                  }
                }, 300);
              }
            }, 200);
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
  }, [remoteStream, isInChat, peerRef]);
  
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
  
  // Initialize socket connection
  useEffect(() => {
    // Get explicit URL - don't rely on window.origin which can be unstable
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${window.location.protocol}//${host}`;
    
    addDebugLog(`Socket connecting to explicit URL: ${url}`);
    
    const newSocket = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
    
    newSocket.on('connect', () => {
      addDebugLog(`Socket connected successfully with ID: ${newSocket.id}`);
      setSocket(newSocket);
    });
    
    // Ping server to keep connection alive
    const pingInterval = setInterval(() => {
      if (newSocket.connected) {
        addDebugLog('Sending heartbeat ping');
        newSocket.emit('ping');
      } else {
        addDebugLog('Heartbeat skipped - not connected');
      }
    }, 20000); // every 20 seconds
    
    newSocket.on('pong', () => {
      addDebugLog('Received pong from server');
    });
    
    newSocket.on('connect_error', (error) => {
      addDebugLog(`Socket connection error: ${error.message}`);
      console.error("Socket connection error:", error);
      toast({
        title: 'Connection Error',
        description: 'Unable to connect to the chat server. Please try again later.',
        variant: 'destructive',
      });
    });
    
    // Cleanup on unmount
    return () => {
      addDebugLog("Cleaning up socket and streams");
      clearInterval(pingInterval);
      if (newSocket) {
        newSocket.disconnect();
      }
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, []);
  
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
  
  // Setup socket event listeners
  useEffect(() => {
    if (!socket) return;
    
    addDebugLog("Setting up socket event listeners");
    
    // When matched with another user
    socket.on('chat_matched', async (data) => {
      addDebugLog(`Matched with peer: ${JSON.stringify(data.peer)}`);
      setIsSearching(false);
      setIsInChat(true);
      setPeerInfo(data.peer);
      setCurrentRoomId(data.roomId);
      
      // Create a new peer connection
      await startPeerConnection(data.isInitiator, data.roomId);
      
      // Notify user
      toast({
        title: 'Connected!',
        description: `You're now chatting with ${data.peer.firstName || data.peer.username || 'Someone'}`,
        variant: 'default',
      });
      
      // For Telegram Desktop, add a delayed check to verify connection is working
      if (window.Telegram?.WebApp) {
        setTimeout(() => {
          if (isInChat && !remoteStream) {
            addDebugLog('No remote stream received after delay - potential connection issue');
            
            // Try to restart the peer connection
            if (peerRef.current && currentRoomId) {
              addDebugLog('Attempting connection recovery...');
              try {
                // First notify user about connection issue
                toast({
                  title: 'Connection Issue',
                  description: 'Trying to reconnect video...',
                  variant: 'default',
                });
                
                // Negotiate a new connection
                peerRef.current.destroy();
                startPeerConnection(data.isInitiator, currentRoomId);
              } catch (err) {
                addDebugLog(`Recovery attempt failed: ${err}`);
              }
            }
          }
        }, 8000); // Wait 8 seconds before checking connection
      }
    });
    
    // When no match is found
    socket.on('no_match', (data) => {
      addDebugLog(`No match found: ${data.message}`);
      
      // Keep searching state but show a toast
      toast({
        title: 'Waiting for a match',
        description: data.message,
        variant: 'default',
      });
    });
    
    // When receiving a WebRTC signal
    socket.on('signal', (data) => {
      addDebugLog(`Received signal from: ${data.from}, type: ${data.signal.type || 'unknown type'}`);
      if (peerRef.current) {
        peerRef.current.signal(data.signal);
      } else {
        addDebugLog('ERROR: Received signal but peer connection not initialized');
        console.error('Received signal but peer connection not initialized');
      }
    });
    
    // When chat is ended by peer
    socket.on('chat_ended', () => {
      addDebugLog('Chat ended by peer');
      endCurrentChat();
      toast({
        title: 'Chat Ended',
        description: 'The other person ended the chat',
        variant: 'default',
      });
    });
    
    // Error handling
    socket.on('error', (data) => {
      addDebugLog(`Socket error: ${data.message}`);
      console.error('Socket error:', data);
      toast({
        title: 'Error',
        description: data.message,
        variant: 'destructive',
      });
    });
    
    // Socket disconnection
    socket.on('disconnect', (reason) => {
      addDebugLog(`Socket disconnected: ${reason}`);
      toast({
        title: 'Disconnected',
        description: 'Lost connection to server. Trying to reconnect...',
        variant: 'destructive',
      });
    });
    
    // Socket reconnection
    socket.on('reconnect', (attemptNumber) => {
      addDebugLog(`Socket reconnected after ${attemptNumber} attempts`);
      if (telegramUser) {
        addDebugLog(`Re-registering user after reconnection`);
        // Re-register after reconnection
        socket.emit('register', {
          telegramId: telegramUser.id,
          username: telegramUser.username,
          firstName: telegramUser.firstName,
          lastName: telegramUser.lastName
        });
      }
    });
    
    // Set up a periodic check to get online count
    const interval = setInterval(() => {
      if (socket.connected) {
        socket.emit('get_online_count');
      } else {
        addDebugLog(`Skipping online count request - socket not connected`);
      }
    }, 10000); // every 10 seconds
    
    return () => {
      addDebugLog("Removing socket event listeners");
      socket.off('chat_matched');
      socket.off('no_match');
      socket.off('signal');
      socket.off('chat_ended');
      socket.off('error');
      socket.off('disconnect');
      socket.off('reconnect');
      clearInterval(interval);
    };
  }, [socket, toast]);
  
  // Initialize local media stream
  const initLocalStream = useCallback(async () => {
    try {
      addDebugLog("Initializing local media stream");
      
      // Check if we're in Telegram WebApp environment
      const isTelegramWebApp = !!window.Telegram?.WebApp;
      
      // Get user media with optimized constraints for compatibility
      const constraints = {
        video: isTelegramWebApp ? 
          // More conservative constraints for Telegram WebApp
          {
            width: { ideal: 320, max: 640 },
            height: { ideal: 240, max: 480 },
            frameRate: { ideal: 15, max: 24 },
            facingMode: "user"
          } : 
          // Regular constraints for other environments
          {
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 },
            frameRate: { ideal: 15, max: 30 },
            facingMode: "user"
          }, 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Reduce audio quality for better performance on slower connections
          channelCount: isTelegramWebApp ? 1 : 2
        } 
      };
      
      addDebugLog(`Using ${isTelegramWebApp ? 'Telegram-optimized' : 'standard'} media constraints`);
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      addDebugLog(`Local stream obtained successfully: tracks=${stream.getTracks().length}`);
      setLocalStream(stream);
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      return stream;
    } catch (error) {
      const err = error as Error;
      addDebugLog(`Error accessing media devices: ${err.name} - ${err.message}`);
      console.error('Error accessing media devices:', error);
      
      // Try fallback with just audio if video fails
      if (err.name === "NotAllowedError" || err.name === "NotFoundError") {
        try {
          addDebugLog("Attempting fallback to audio-only");
          const audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true, 
            video: false 
          });
          
          addDebugLog(`Fallback audio stream obtained: tracks=${audioStream.getTracks().length}`);
          setLocalStream(audioStream);
          setIsVideoEnabled(false);
          
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = audioStream;
          }
          
          // Show toast about video access
          toast({
            title: 'Video Disabled',
            description: 'Using audio only mode. Enable camera access for video.',
            variant: 'default',
          });
          
          return audioStream;
        } catch (audioErr) {
          addDebugLog(`Audio fallback also failed: ${(audioErr as Error).message}`);
        }
      }
      
      toast({
        title: 'Camera Access Failed',
        description: 'Please allow camera and microphone access to use video chat',
        variant: 'destructive',
      });
      return null;
    }
  }, [toast]);
  
  // Start peer connection
  const startPeerConnection = async (isInitiator: boolean, roomId: string) => {
    try {
      addDebugLog(`Starting peer connection as ${isInitiator ? 'initiator' : 'receiver'} for room ${roomId}`);
      
      // Make sure we have a local stream
      let stream = localStream;
      if (!stream) {
        addDebugLog("No local stream available, initializing");
        stream = await initLocalStream();
        if (!stream) {
          addDebugLog("Failed to get local stream");
          return;
        }
      }
      
      // Clean up any existing peer
      if (peerRef.current) {
        addDebugLog('Destroying existing peer connection');
        peerRef.current.destroy();
      }
      
      // Check if we're in Telegram WebApp environment
      const isTelegramWebApp = !!window.Telegram?.WebApp;
      
      // Create a new peer connection
      const peerOptions = {
        initiator: isInitiator,
        trickle: true,
        stream,
        config: {
          iceServers: [
            // Standard STUN servers
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            // Non-Google STUN servers for better compatibility
            { urls: 'stun:stun.stunprotocol.org:3478' },
            { urls: 'stun:stun.voiparound.com:3478' },
            // TURN servers with different transport protocols
            { 
              urls: 'turn:openrelay.metered.ca:80',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            {
              urls: 'turn:openrelay.metered.ca:443',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            {
              urls: 'turn:openrelay.metered.ca:443?transport=tcp',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            // Additional TURN servers for better compatibility
            {
              urls: 'turn:global.turn.twilio.com:3478?transport=udp',
              username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
              credential: 'w1WpauM/VwP/JnAK0ckJxuDHsgiAs7XjgMGhkjpNbus='
            }
          ],
          iceCandidatePoolSize: 10
        },
        sdpTransform: (sdp: string) => {
          // Force H.264 for better compatibility with all browsers/clients
          let modifiedSdp = sdp;
          if (isTelegramWebApp) {
            addDebugLog('Applying SDP transform for Telegram WebApp compatibility');
            
            // Modify bandwidth for better performance on mobile networks
            modifiedSdp = modifiedSdp.replace(/a=mid:video\r\n/g, 
              'a=mid:video\r\na=bandwidth:AS:300\r\n');
            
            // Lower resolution for better performance
            modifiedSdp = modifiedSdp.replace(/a=fmtp:(.*) profile-level-id=(.*)/g, 
              'a=fmtp:$1 profile-level-id=42e01f'); // Forces H.264 Baseline profile
            
            // Move H.264 to top of preference list
            modifiedSdp = modifiedSdp.replace(/m=video.*\r\n/g, (line) => {
              const parts = line.split(' ');
              const h264Indices = [];
              
              // Find all H.264 codec indices
              for (let i = 3; i < parts.length; i++) {
                if (sdp.indexOf(`a=rtpmap:${parts[i]} H264/`) !== -1) {
                  h264Indices.push(i);
                }
              }
              
              // If found, move them to front
              if (h264Indices.length > 0) {
                const newParts = parts.slice(0, 3); // Keep prefix
                
                // Add H.264 codecs first
                for (const index of h264Indices) {
                  newParts.push(parts[index]);
                }
                
                // Add remaining codecs
                for (let i = 3; i < parts.length; i++) {
                  if (!h264Indices.includes(i)) {
                    newParts.push(parts[i]);
                  }
                }
                
                return newParts.join(' ') + '\r\n';
              }
              
              // Return original if no H.264 found
              return line;
            });
          }
          return modifiedSdp;
        }
      };
      
      addDebugLog(`Creating peer with options: ${JSON.stringify({
        initiator: peerOptions.initiator,
        trickle: peerOptions.trickle,
        hasStream: !!peerOptions.stream,
        iceServers: peerOptions.config.iceServers.length
      })}`);
      
      const peer = new SimplePeer(peerOptions);
      
      // Handle peer events
      peer.on('signal', (signal: any) => {
        addDebugLog(`Generated signal data to send: ${signal.type || 'unknown signal type'}`);
        if (socket) {
          socket.emit('signal', { roomId, signal });
        } else {
          addDebugLog("ERROR: Socket not available to send signal");
        }
      });
      
      peer.on('connect', () => {
        addDebugLog('Peer connection established!');
        toast({
          title: 'Connected',
          description: 'WebRTC connection established successfully',
          variant: 'default',
        });
      });
      
      peer.on('stream', (remoteMediaStream: MediaStream) => {
        addDebugLog(`Received remote stream with ${remoteMediaStream.getTracks().length} tracks`);
        
        // Log track details for debugging
        remoteMediaStream.getTracks().forEach((track, i) => {
          addDebugLog(`Remote track ${i}: kind=${track.kind}, enabled=${track.enabled}, readyState=${track.readyState}`);
        });
        
        setRemoteStream(remoteMediaStream);
        
        if (remoteVideoRef.current) {
          // Make sure element is fully initialized before setting stream
          setTimeout(() => {
            try {
              addDebugLog('Attaching remote stream to video element');
              
              // Force video element to be visible
              if (remoteVideoRef.current) {
                remoteVideoRef.current.style.display = 'block';
                remoteVideoRef.current.style.backgroundColor = 'black';
                
                // Apply critical styles directly to ensure visibility
                remoteVideoRef.current.style.width = '100%';
                remoteVideoRef.current.style.height = '100%';
                remoteVideoRef.current.style.objectFit = 'cover';
              }
              
              // Clean up any existing srcObject first
              if (remoteVideoRef.current!.srcObject) {
                addDebugLog('Removing existing srcObject from remote video element');
                remoteVideoRef.current!.srcObject = null;
              }
              
              // Set new stream
              remoteVideoRef.current!.srcObject = remoteMediaStream;
              
              // Add metadata loaded handler to ensure video starts playing
              remoteVideoRef.current!.onloadedmetadata = () => {
                addDebugLog('Remote video metadata loaded, attempting to play');
                
                // Ensure video plays with a promise catch
                remoteVideoRef.current!.play()
                  .then(() => {
                    addDebugLog('Remote video playback started successfully');
                  })
                  .catch(err => {
                    addDebugLog(`Error playing remote video: ${err.message}`);
            console.error('Error playing remote video:', err);
                    
                    // Try a different approach for Telegram Desktop
                    if (window.Telegram?.WebApp) {
                      addDebugLog('Attempting alternative play method for Telegram WebApp');
                      
                      // Try with user interaction notification
                      toast({
                        title: 'Video Available',
                        description: 'Tap on the screen to see the other person',
                        variant: 'default',
                      });
                      
                      // Also try an automatic approach - add a click event listener to the document
                      document.addEventListener('click', function videoClickHandler() {
                        if (remoteVideoRef.current) {
                          remoteVideoRef.current.play().catch(e => 
                            addDebugLog(`Still failed after click: ${e.message}`)
                          );
                        }
                        // Remove the handler after first click
                        document.removeEventListener('click', videoClickHandler);
                      }, { once: true });
                    }
                  });
              };
            } catch (err: any) {
              addDebugLog(`Error setting remote video srcObject: ${err.message}`);
              console.error('Error setting remote video srcObject:', err);
            }
          }, 500); // Small delay to ensure DOM is ready
        } else {
          addDebugLog("ERROR: Remote video reference not available");
        }
      });
      
      peer.on('error', (err: Error) => {
        addDebugLog(`Peer connection error: ${err.name} - ${err.message}`);
        console.error('Peer connection error:', err);
        
        // Don't show errors for common WebRTC issues unless debugging
        const isCommonError = err.message.includes('ICE connection') || 
                              err.message.includes('ICE failed') ||
                              err.message.includes('negotiation');
        
        if (!isCommonError) {
        toast({
          title: 'Connection Error',
          description: 'There was a problem with the video chat connection',
          variant: 'destructive',
        });
        }
        
        // Attempt recovery for specific errors
        if (err.message.includes('ICE failed') && currentRoomId && socket) {
          // We can try to renegotiate
          addDebugLog('ICE connection failed, attempting reconnection');
          
          // Small delay before recovery attempt
          setTimeout(() => {
            if (isInChat && currentRoomId) {
              // Destroy old connection
              if (peerRef.current) {
                peerRef.current.destroy();
                peerRef.current = null;
              }
              
              // Start new connection
              startPeerConnection(true, currentRoomId);
              
              // Notify partner through signaling server
              socket.emit('reconnect_attempt', { roomId: currentRoomId });
            }
          }, 1000);
        }
      });
      
      peer.on('close', () => {
        addDebugLog('Peer connection closed');
        endCurrentChat();
      });
      
      peer.on('iceStateChange', (state: string) => {
        addDebugLog(`ICE connection state changed: ${state}`);
        
        // Handle disconnection/failure states
        if (state === 'disconnected' || state === 'failed') {
          addDebugLog(`ICE connection ${state}, may attempt recovery`);
          
          // Show UI indication of connection issues
          if (state === 'failed') {
            toast({
              title: 'Connection Issue',
              description: 'Video connection interrupted, trying to reconnect...',
              variant: 'default',
            });
            
            // Attempt reconnection for failed state
            setTimeout(() => {
              if (isInChat && currentRoomId && peerRef.current && socket) {
                try {
                  // Attempt a direct renegotiation if possible
                  if (typeof peerRef.current.restartIce === 'function') {
                    addDebugLog('Attempting ICE restart');
                    peerRef.current.restartIce();
                  } else {
                    // If restart isn't available, recreate the connection
                    addDebugLog('Recreating peer connection after failure');
                    const wasInitiator = peerRef.current.initiator;
                    peerRef.current.destroy();
                    startPeerConnection(wasInitiator, currentRoomId);
                  }
                } catch (err) {
                  addDebugLog(`Recovery failed: ${err}`);
                }
              }
            }, 2000);
          }
        } else if (state === 'connected' || state === 'completed') {
          // We have a good connection
          addDebugLog(`ICE connection established: ${state}`);
        }
      });
      
      peerRef.current = peer;
      
    } catch (error) {
      const err = error as Error;
      addDebugLog(`Error starting peer connection: ${err.name} - ${err.message}`);
      console.error('Error starting peer connection:', error);
    }
  };
  
  // Start searching for a random chat
  const startRandomChat = async () => {
    if (!telegramUser) {
      addDebugLog("Authentication required - no Telegram user");
      toast({
        title: 'Authentication Required',
        description: 'Please connect with Telegram to use the chat feature',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      addDebugLog("Starting search for random chat");
      setIsSearching(true);
      
      // Make sure we have a local stream
      if (!localStream) {
        addDebugLog("No local stream available, initializing");
        await initLocalStream();
      }
      
      // Request a random chat
      if (socket) {
        if (socket.connected) {
          addDebugLog("Emitting request_random_chat event");
        socket.emit('request_random_chat');
        
        // Update online count
        socket.emit('get_online_count');
        } else {
          addDebugLog("ERROR: Socket not connected - can't request chat");
          toast({
            title: 'Connection Error',
            description: 'Not connected to the server. Please refresh the page.',
            variant: 'destructive',
          });
          setIsSearching(false);
        }
      } else {
        addDebugLog("ERROR: Socket not initialized - can't request chat");
        toast({
          title: 'Connection Error',
          description: 'Server connection not initialized. Please refresh the page.',
          variant: 'destructive',
        });
        setIsSearching(false);
      }
    } catch (error) {
      const err = error as Error;
      addDebugLog(`Error starting random chat: ${err.name} - ${err.message}`);
      setIsSearching(false);
      console.error('Error starting random chat:', error);
    }
  };
  
  // Cancel search for a random chat
  const cancelSearch = () => {
    addDebugLog("Cancelling search for random chat");
    setIsSearching(false);
    
    // Notify server that user is no longer searching
    if (socket && telegramUser) {
      if (socket.connected) {
        addDebugLog("Emitting cancel_search event");
      socket.emit('cancel_search', { telegramId: telegramUser.id });
      
      // Update online count
      socket.emit('get_online_count');
      } else {
        addDebugLog("ERROR: Socket not connected - can't cancel search");
      }
    } else {
      addDebugLog("ERROR: Socket or telegramUser not available - can't cancel search");
    }
  };
  
  // End the current chat
  const endCurrentChat = () => {
    addDebugLog("Ending current chat");
    setIsInChat(false);
    setPeerInfo(null);
    
    if (currentRoomId && socket) {
      if (socket.connected) {
        addDebugLog(`Emitting end_chat event for room ${currentRoomId}`);
      socket.emit('end_chat', { roomId: currentRoomId });
      } else {
        addDebugLog("ERROR: Socket not connected - can't end chat properly");
      }
    }
    
    if (peerRef.current) {
      addDebugLog("Destroying peer connection");
      peerRef.current.destroy();
      peerRef.current = null;
    }
    
    if (remoteStream) {
      addDebugLog("Stopping remote stream tracks");
      remoteStream.getTracks().forEach(track => track.stop());
      setRemoteStream(null);
    }
    
    setCurrentRoomId(null);
    
    // Update online count
    if (socket && socket.connected) {
      socket.emit('get_online_count');
    }
  };
  
  // Toggle video
  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !isVideoEnabled;
        addDebugLog(`Video ${!isVideoEnabled ? 'enabled' : 'disabled'}`);
        setIsVideoEnabled(!isVideoEnabled);
      }
    }
  };
  
  // Toggle audio
  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !isAudioEnabled;
        addDebugLog(`Audio ${!isAudioEnabled ? 'enabled' : 'disabled'}`);
        setIsAudioEnabled(!isAudioEnabled);
      }
    }
  };
  
  // Toggle profile sidebar
  const toggleProfile = () => {
    addDebugLog(`Profile sidebar ${!showProfile ? 'opened' : 'closed'}`);
    setShowProfile(!showProfile);
  };
  
  // Connect wallet
  const connectWallet = () => {
    addDebugLog("Opening TON wallet connect dialog");
    tonConnect.showWalletConnectModal();
  };
  
  // Disconnect wallet
  const disconnectWallet = () => {
    addDebugLog("Disconnecting TON wallet");
    tonConnect.disconnect();
  };
  
  // Handle profile menu item clicks
  const handleEditProfile = () => {
    addDebugLog("Edit profile clicked");
    // For now just show a toast since this is not implemented
    toast({
      title: 'Edit Profile',
      description: 'Profile editing will be available in a future update',
      variant: 'default',
    });
  };
  
  const handleManageSubscription = () => {
    addDebugLog("Manage subscription clicked");
    // For now just show a toast since this is not implemented
    toast({
      title: 'Manage Subscription',
      description: 'Subscription management will be available soon',
      variant: 'default',
    });
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      {/* Full-screen Remote Video (Instagram-style) */}
      {remoteStream ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          muted={false}
          controls={false}
          loop={false}
          disablePictureInPicture={true}
          disableRemotePlayback={true}
          className="absolute inset-0 w-full h-full object-cover z-10 bg-black"
          style={{ objectFit: 'cover' }}
          onClick={() => {
            // Force play on click - helps with Telegram Desktop
            if (remoteVideoRef.current) {
              remoteVideoRef.current.play().catch(err => 
                addDebugLog(`Play on click failed: ${err.message}`)
              );
            }
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-gray-900 to-black z-10"></div>
      )}
      
      {/* Gradient Overlays */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent z-20"></div>
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/70 to-transparent z-20"></div>
      
      {/* User Profile Button (top right) */}
      <div className="absolute top-6 right-6 z-30">
        <button 
          onClick={toggleProfile}
          className="w-12 h-12 rounded-full bg-black/30 backdrop-blur-sm border border-white/30 flex items-center justify-center hover:bg-black/50 hover:border-white/50 transition-all"
        >
          {telegramUser?.photoUrl ? (
            <img 
              src={telegramUser.photoUrl} 
              alt="Profile" 
              className="w-11 h-11 rounded-full object-cover"
            />
          ) : (
            <User className="w-6 h-6 text-white" />
          )}
        </button>
      </div>
      
      {/* Online Count Display */}
      <div className="absolute top-6 left-6 z-30">
        <div className="bg-black/30 backdrop-blur-sm rounded-full px-4 py-2 text-white text-sm flex items-center">
          <div className={`w-2 h-2 rounded-full ${socket?.connected ? 'bg-green-500' : 'bg-red-500'} mr-2`}></div>
          <span>{onlineCount} Online</span>
        </div>
      </div>
      
      {/* Profile Sidebar */}
      <div className={`absolute inset-y-0 right-0 w-3/4 max-w-sm bg-black/80 backdrop-blur-md border-l border-white/10 z-50 transition-transform duration-300 overflow-y-auto ${showProfile ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full p-6">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-xl font-bold text-white">Your Profile</h3>
            <button onClick={toggleProfile} className="p-2 text-white hover:bg-white/10 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex items-center mb-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center overflow-hidden">
              {telegramUser?.photoUrl ? (
                <img src={telegramUser.photoUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-8 h-8 text-white" />
              )}
            </div>
            <div className="ml-4">
              <p className="text-white font-medium text-lg">
                {telegramUser?.firstName} {telegramUser?.lastName}
              </p>
              <p className="text-gray-400 text-sm">@{telegramUser?.username || 'username'}</p>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {/* Menu Items */}
            <div className="space-y-2">
              <button 
                onClick={handleEditProfile}
                className="w-full p-3 hover:bg-white/10 rounded-lg flex items-center justify-between"
              >
                <div className="flex items-center">
                  <Settings className="w-5 h-5 text-blue-400 mr-3" />
                  <span className="text-white">Edit Profile</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </button>
              
              <button 
                onClick={handleManageSubscription}
                className="w-full p-3 hover:bg-white/10 rounded-lg flex items-center justify-between"
              >
                <div className="flex items-center">
                  <Wallet className="w-5 h-5 text-purple-400 mr-3" />
                  <span className="text-white">Manage Subscription</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </button>
              
              <button 
                onClick={walletAddress ? disconnectWallet : connectWallet}
                className="w-full p-3 hover:bg-white/10 rounded-lg flex items-center justify-between"
              >
                <div className="flex items-center">
                  <Wallet className="w-5 h-5 text-green-400 mr-3" />
                  <span className="text-white">
                    {walletAddress ? "Disconnect Wallet" : "Connect Wallet"}
                  </span>
                </div>
                <div className="flex items-center">
                  <span className="text-gray-500 text-xs mr-2">
                    {walletAddress ? "Connected" : "Not Connected"}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                </div>
              </button>
            </div>
            
            {/* Wallet Info */}
            {walletAddress && (
              <div className="mt-6 p-4 bg-gray-900/50 rounded-lg border border-gray-800">
                <p className="text-gray-400 text-sm mb-1">Connected Wallet</p>
                <p className="text-white text-xs font-mono break-all">
                  {walletAddress.substring(0, 12)}...{walletAddress.substring(walletAddress.length - 8)}
                </p>
              </div>
            )}
            
            {/* Connection Status */}
            <div className="mt-6 p-4 bg-gray-900/50 rounded-lg border border-gray-800">
              <p className="text-gray-400 text-sm mb-1">Connection Status</p>
              <div className="flex items-center">
                <div className={`w-2 h-2 rounded-full ${socket?.connected ? 'bg-green-500' : 'bg-red-500'} mr-2`}></div>
                <p className="text-white text-sm">
                  {checkConnectionStatus()}
                </p>
              </div>
            </div>
            
            {/* Debug Log */}
            <div className="mt-6">
              <div className="flex justify-between items-center mb-2">
                <p className="text-gray-400 text-sm">Debug Log</p>
                <button
                  onClick={() => {
                    const logText = debugLog.join('\n');
                    navigator.clipboard.writeText(logText);
                    toast({
                      title: 'Debug Log Copied',
                      description: 'The debug log has been copied to your clipboard',
                      variant: 'default',
                    });
                  }}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Copy Log
                </button>
              </div>
              <div className="bg-black/50 rounded-lg border border-gray-800 h-48 overflow-y-auto p-2 text-xs font-mono">
                {debugLog.length > 0 ? (
                  debugLog.map((log, index) => (
                    <div key={index} className="text-gray-300 border-b border-gray-800/50 py-1">
                      {log}
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 italic">No logs yet</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Local Video (small overlay) */}
      {localStream && (
        <div className="absolute bottom-20 right-4 w-28 h-40 rounded-xl overflow-hidden border-2 border-white/30 shadow-lg z-30">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted={true}
            disablePictureInPicture={true}
            disableRemotePlayback={true}
            className="w-full h-full object-cover bg-black"
          />
          
          {/* Camera Status Overlay */}
          {!isVideoEnabled && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <VideoOff className="w-8 h-8 text-red-500" />
            </div>
          )}
          
          {/* Microphone Status Indicator */}
          {!isAudioEnabled && (
            <div className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
              <MicOff className="w-3 h-3 text-white" />
            </div>
          )}
        </div>
      )}
      
      {/* Main Action Button (center) - Start Chat when not started */}
      {!isInChat && !isSearching && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-30">
          <div className="w-24 h-24 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center mb-6 animate-pulse">
            <PhoneCall className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">Start Random Chat</h2>
          <p className="text-gray-300 text-center max-w-xs mb-6">Connect with strangers around the world through video chat</p>
          <Button 
            onClick={startRandomChat}
            className="bg-white hover:bg-gray-100 text-black font-medium px-8 py-6 rounded-full text-lg"
          >
            Start Now
          </Button>
        </div>
      )}
      
      {/* Searching Overlay */}
      {isSearching && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-30">
          <div className="w-20 h-20 rounded-full border-4 border-blue-500 border-t-transparent animate-spin mb-6"></div>
          <h2 className="text-2xl font-bold text-white mb-3">Searching...</h2>
          <p className="text-gray-300 text-center max-w-xs mb-6">Looking for someone interesting to chat with</p>
          <Button 
            onClick={cancelSearch}
            variant="outline"
            className="border-white/30 text-white hover:bg-white/10 font-medium px-6 py-2 rounded-full"
          >
            Cancel
          </Button>
        </div>
      )}
      
      {/* Peer Info (when chatting) */}
      {isInChat && peerInfo && (
        <div className="absolute bottom-24 left-0 right-0 flex items-center px-6 z-30">
          <div className="w-12 h-12 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center mr-3 overflow-hidden">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-white font-medium">{peerInfo.firstName || peerInfo.username || 'Anonymous'}</p>
            {peerInfo.location && (
              <div className="flex items-center text-gray-300 text-sm">
                <MapPin className="w-3 h-3 mr-1" />
                <span>{peerInfo.location}</span>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Bottom Controls */}
      {isInChat && (
        <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-3 z-30">
          <Button
            onClick={toggleAudio}
            variant={isAudioEnabled ? "default" : "destructive"}
            size="icon"
            className={`w-14 h-14 rounded-full shadow-lg ${isAudioEnabled ? 'bg-gray-800 hover:bg-gray-700' : ''}`}
          >
            {isAudioEnabled ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
          </Button>
          
          <Button
            onClick={endCurrentChat}
            variant="destructive"
            size="icon"
            className="w-14 h-14 rounded-full shadow-lg"
          >
            <PhoneOff className="h-6 w-6" />
          </Button>
          
          <Button
            onClick={toggleVideo}
            variant={isVideoEnabled ? "default" : "destructive"}
            size="icon"
            className={`w-14 h-14 rounded-full shadow-lg ${isVideoEnabled ? 'bg-gray-800 hover:bg-gray-700' : ''}`}
          >
            {isVideoEnabled ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
          </Button>
        </div>
      )}
      
      {/* Side Action Buttons (when in chat) */}
      {isInChat && (
        <div className="absolute right-6 bottom-32 flex flex-col gap-4 z-30">
          <button className="w-12 h-12 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center">
            <Heart className="w-6 h-6 text-white" />
          </button>
          
          <button className="w-12 h-12 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center">
            <MoreVertical className="w-6 h-6 text-white" />
          </button>
        </div>
      )}
    </div>
  );
}
