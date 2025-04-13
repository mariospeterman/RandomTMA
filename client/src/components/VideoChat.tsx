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

// Extend SimplePeer types to include connected property
declare module 'simple-peer' {
  interface Instance {
    connected?: boolean;
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
  
  // Replace the signal buffer state with a ref for better persistence between component updates
  const signalBufferRef = useRef<{[roomId: string]: any[]}>({});
  
  // Create function refs to break circular dependencies
  const addPlayButtonRef = useRef<(stream: MediaStream) => void>();
  const monitorVideoPlaybackRef = useRef<(stream: MediaStream) => void>();
  const attachStreamToVideoRef = useRef<(stream: MediaStream) => void>();
  const startPeerConnectionRef = useRef<(isInitiator: boolean, roomId: string) => Promise<void>>();
  const endCurrentChatRef = useRef<() => void>();
  
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
    
    // Reference to connection timeout
    let connectionTimeoutRef: ReturnType<typeof setTimeout> | null = null;
    
    // When matched with another user
    socket.on('chat_matched', async (data) => {
      addDebugLog(`Matched with peer: ${JSON.stringify(data.peer)}`);
      setIsSearching(false);
      setIsInChat(true);
      setPeerInfo(data.peer);
      setCurrentRoomId(data.roomId);
      
      // Create a new peer connection
      try {
        await startPeerConnection(data.isInitiator, data.roomId);
        
        // Set a timeout to detect if connection fails
        connectionTimeoutRef = setTimeout(() => {
          if (isInChat && !remoteStream && currentRoomId === data.roomId) {
            addDebugLog('Connection timeout - no remote stream received after 15s');
            
            toast({
              title: 'Connection Failed',
              description: 'Could not establish media connection. Please try again.',
              variant: 'destructive',
            });
            
            endCurrentChat();
          }
        }, 15000); // 15 second timeout
        
        // Notify user
        toast({
          title: 'Connected!',
          description: `You're now chatting with ${data.peer.firstName || data.peer.username || 'Someone'}`,
          variant: 'default',
        });
      } catch (err) {
        addDebugLog(`Error creating peer connection: ${err}`);
        
        toast({
          title: 'Connection Error',
          description: 'Failed to establish connection. Please try again.',
          variant: 'destructive',
        });
        
        // Clean up failed connection attempt
        setIsInChat(false);
        setPeerInfo(null);
        setCurrentRoomId(null);
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
      // Log basic info for debugging
      addDebugLog(`Received signal from: ${data.from}, type=${data.signal.type || 'unknown'}`);
      
      if (!peerRef.current) {
        addDebugLog('ERROR: Received signal but peer connection not initialized');
        console.error('Received signal but peer connection not initialized');
        return;
      }
      
      try {
        // Simply pass the signal to SimplePeer - it handles proper WebRTC signaling internally
        peerRef.current.signal(data.signal);
        addDebugLog(`Signal passed to SimplePeer`);
      } catch (err) {
        addDebugLog(`Error handling signal: ${err}`);
        console.error('Error handling signal:', err);
      }
    });
    
    // When chat is ended by peer
    socket.on('chat_ended', () => {
      // Clear connection timeout if it exists
      if (connectionTimeoutRef) {
        clearTimeout(connectionTimeoutRef);
        connectionTimeoutRef = null;
      }
      
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
      // Clear any pending connection timeout
      if (connectionTimeoutRef) {
        clearTimeout(connectionTimeoutRef);
      }
      
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
  }, [socket, toast, remoteStream, isInChat, currentRoomId]);
  
  // Initialize local media stream with specific browser optimizations
  const initLocalStream = useCallback(async () => {
    try {
      addDebugLog("Initializing local media stream");
      
      // Check if we're in Telegram WebApp environment
      const isTelegramWebApp = !!window.Telegram?.WebApp;
      
      // Detect browser for specific optimizations
      const userAgent = navigator.userAgent;
      const isSafari = /^((?!chrome|android).)*safari/i.test(userAgent);
      const isFirefox = userAgent.toLowerCase().indexOf('firefox') > -1;
      const isChrome = userAgent.toLowerCase().indexOf('chrome') > -1 && !isSafari;
      
      addDebugLog(`Browser detection: Safari=${isSafari}, Firefox=${isFirefox}, Chrome=${isChrome}`);
      
      // Base constraints - conservative first attempt
      const baseConstraints = {
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
            frameRate: { ideal: 24, max: 30 },
            facingMode: "user"
          }, 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: isTelegramWebApp ? 1 : 2
        } 
      };
      
      // Browser-specific constraints
      let constraints = baseConstraints;
      
      if (isSafari) {
        // Safari has issues with some WebRTC features
        constraints.video = {
          width: { ideal: 640, max: 960 },
          height: { ideal: 480, max: 640 },
          frameRate: { ideal: 20, max: 24 },
          facingMode: "user"
        };
      } else if (isFirefox) {
        // Firefox works better with specific H.264 configuration
        constraints.video = {
          ...constraints.video,
        };
        // Apply codec as any type to bypass type checking
        (constraints.video as any).codec = { ideal: "h264" };
      }
      
      addDebugLog(`Using ${isTelegramWebApp ? 'Telegram-optimized' : 'standard'} media constraints`);
      
      try {
        // First attempt with ideal constraints
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        addDebugLog(`Local stream obtained successfully: tracks=${stream.getTracks().length}`);
        
        // Log detailed track information
        stream.getTracks().forEach(track => {
          addDebugLog(`Track: kind=${track.kind}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
          
          // Add specific browser settings to tracks
          if (track.kind === 'audio') {
            // Ensure audio tracks have appropriate settings
            try {
              const audioTrack = track as MediaStreamTrack;
              if (audioTrack.getSettings) {
                const settings = audioTrack.getSettings();
                addDebugLog(`Audio settings: ${JSON.stringify(settings)}`);
              }
            } catch (e) {
              addDebugLog(`Error getting audio settings: ${e}`);
            }
          }
        });
        
        setLocalStream(stream);
        
        if (localVideoRef.current) {
          // Ensure proper video element configuration
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.muted = true; // Always mute local video to prevent echo
          localVideoRef.current.playsInline = true;
          
          // For Safari compatibility
          if (isSafari) {
            localVideoRef.current.setAttribute('playsinline', 'playsinline');
          }
          
          // Try to play the stream
          try {
            await localVideoRef.current.play();
            addDebugLog('Local video playback started');
          } catch (playErr) {
            addDebugLog(`Warning: Auto-play prevented for local video: ${playErr}`);
            // We'll proceed anyway since local video isn't critical
          }
        }
        
        return stream;
      } catch (initialErr) {
        // Log the initial error
        addDebugLog(`Initial media access failed, trying fallback: ${initialErr}`);
        
        // Try a more conservative approach with just video
        try {
          const videoOnlyConstraints = { 
            video: { 
              width: { ideal: 320, max: 480 },
              height: { ideal: 240, max: 360 },
              frameRate: { max: 15 }
            },
            audio: false
          };
          
          addDebugLog('Attempting video-only fallback');
          const videoStream = await navigator.mediaDevices.getUserMedia(videoOnlyConstraints);
          
          // Now try to get audio separately
          try {
            addDebugLog('Adding audio to video-only stream');
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            
            // Combine the streams
            audioStream.getAudioTracks().forEach(track => {
              videoStream.addTrack(track);
            });
            
            addDebugLog(`Combined stream created: tracks=${videoStream.getTracks().length}`);
          } catch (audioErr) {
            addDebugLog(`Couldn't add audio: ${audioErr}`);
          }
          
          setLocalStream(videoStream);
          setIsVideoEnabled(true);
          
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = videoStream;
            localVideoRef.current.muted = true;
          }
          
          return videoStream;
        } catch (videoErr) {
          // Last resort: try audio only
          addDebugLog(`Video fallback also failed: ${videoErr}, trying audio-only`);
          
          try {
            const audioOnlyStream = await navigator.mediaDevices.getUserMedia({ 
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }, 
              video: false 
            });
            
            addDebugLog(`Audio-only stream obtained: tracks=${audioOnlyStream.getTracks().length}`);
            setLocalStream(audioOnlyStream);
            setIsVideoEnabled(false);
            
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = null;
            }
            
            // Show toast about video access
            toast({
              title: 'Audio Only Mode',
              description: 'Video could not be accessed. Using audio only.',
              variant: 'default',
            });
            
            return audioOnlyStream;
          } catch (audioOnlyErr) {
            addDebugLog(`All media access failed: ${audioOnlyErr}`);
            throw new Error('Unable to access camera or microphone');
          }
        }
      }
    } catch (error) {
      const err = error as Error;
      addDebugLog(`❌ Error accessing media devices: ${err.name} - ${err.message}`);
      console.error('Error accessing media devices:', error);
      
      toast({
        title: 'Media Access Failed',
        description: 'Please allow camera and microphone access to use video chat',
        variant: 'destructive',
      });
      return null;
    }
  }, [toast]);
  
  // Update the startPeerConnection function for better timing handling
  const startPeerConnection = useCallback(async (isInitiator: boolean, roomId: string) => {
    try {
      addDebugLog(`Starting new peer connection as ${isInitiator ? 'initiator' : 'receiver'} for room ${roomId}`);
      
      // Store room ID immediately to ensure it's available for all signals
      setCurrentRoomId(roomId);
      
      // Make sure any previous peer connection is properly destroyed
      if (peerRef.current) {
        addDebugLog('Destroying existing peer connection for clean start');
        peerRef.current.destroy();
        peerRef.current = null;
      }
      
      // Make sure we have a local stream - crucial step that must complete before proceeding
      let stream = localStream;
      if (!stream) {
        addDebugLog("No local stream available, initializing");
        stream = await initLocalStream();
        if (!stream) {
          addDebugLog("❌ Failed to get local stream - cannot proceed with connection");
          toast({
            title: 'Media Error',
            description: 'Unable to access camera or microphone. Please check permissions.',
            variant: 'destructive',
          });
          return;
        }
      }
      
      // Double check all tracks are enabled
      stream.getTracks().forEach(track => {
        if (!track.enabled) {
          addDebugLog(`Enabling previously disabled ${track.kind} track`);
          track.enabled = true;
        }
      });
      
      // Create a new peer with simple but effective configuration
      const peerOptions = {
        initiator: isInitiator,
        trickle: true,
        stream: stream,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { 
              urls: 'turn:openrelay.metered.ca:80',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            {
              urls: 'turn:openrelay.metered.ca:443',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            }
          ]
        },
        sdpTransform: (sdp: string) => {
          // Modify SDP to prioritize H.264 video codec for better compatibility
          const sdpLines = sdp.split('\r\n');
          const videoIndex = sdpLines.findIndex(line => line.includes('m=video'));
          
          if (videoIndex >= 0) {
            // Find video codec lines and adjust based on availability
            const codecLines = sdpLines.slice(videoIndex, sdpLines.length)
                                       .filter(line => line.includes('a=rtpmap:') && 
                                       (line.includes('H264') || line.includes('VP8')));
                                       
            if (codecLines.length > 0) {
              // If H.264 is available, prioritize it
              const h264Line = codecLines.find(line => line.includes('H264'));
              if (h264Line) {
                const h264PayloadType = h264Line.split(':')[1].split(' ')[0];
                addDebugLog(`Prioritizing H.264 codec with payload type ${h264PayloadType}`);
                
                // Update the m=video line to prioritize H.264
                const mVideoLineIndex = sdpLines.findIndex(line => line.startsWith('m=video'));
                if (mVideoLineIndex >= 0) {
                  const mVideoLine = sdpLines[mVideoLineIndex];
                  const parts = mVideoLine.split(' ');
                  
                  // Move the payload type to the front of the list (after the first 3 parts)
                  const formats = parts.slice(3);
                  const newFormats = [h264PayloadType, ...formats.filter(f => f !== h264PayloadType)];
                  
                  sdpLines[mVideoLineIndex] = `${parts[0]} ${parts[1]} ${parts[2]} ${newFormats.join(' ')}`;
                }
              }
            }
          }
          
          return sdpLines.join('\r\n');
        }
      };
      
      addDebugLog(`Creating new SimplePeer instance with options: ${JSON.stringify({
        initiator: isInitiator,
        trickle: true,
        streamTracks: stream.getTracks().length
      })}`);
      
      // Create peer instance
      const peer = new SimplePeer(peerOptions);
      
      // Store the peer reference immediately to ensure signal handling works
      peerRef.current = peer;
      
      // Add connection state monitoring
      let connectionEstablished = false;
      
      // Debug timer to monitor connection progress
      const connectionTimer = setTimeout(() => {
        if (!connectionEstablished && peerRef.current) {
          addDebugLog('⚠️ Connection taking longer than expected - no remote stream after 10s');
          
          try {
            // Attempt to restart ICE gathering if we have a peer
            if (peerRef.current && !(peerRef.current as any).connected) {
              addDebugLog('Attempting to restart connection...');
              // Send renegotiation signal
              if (socket && socket.connected && currentRoomId) {
                socket.emit('signal', { 
                  roomId: currentRoomId, 
                  signal: { type: 'renegotiate' }
                });
              }
            }
          } catch (e) {
            addDebugLog(`Error in connection restart: ${e}`);
          }
        }
      }, 10000);
      
      // Set up event handlers
      peer.on('signal', (signal: any) => {
        addDebugLog(`Generated signal: type=${signal.type || 'candidate'}, sending to room ${roomId}`);
        if (socket && socket.connected) {
          socket.emit('signal', { roomId, signal });
        } else {
          addDebugLog("⚠️ Socket not connected - can't send signal");
        }
      });
      
      peer.on('connect', () => {
        connectionEstablished = true;
        addDebugLog('✅ Peer connection established!');
        
        // Mark peer as connected for TypeScript compatibility
        (peer as any).connected = true;
        
        toast({
          title: 'Connected',
          description: 'Connection established successfully',
          variant: 'default',
        });
        
        // Additional connection check - if no stream arrives within 3s of connect, try to trigger renegotiation
        setTimeout(() => {
          if (!remoteStream && peerRef.current && peerRef.current === peer) {
            addDebugLog('Connection established but no stream - requesting media again');
            try {
              // Explicit renegotiation request
              if (socket && socket.connected && currentRoomId) {
                socket.emit('signal', { 
                  roomId: currentRoomId, 
                  signal: { type: 'renegotiate' }
                });
              }
            } catch (e) {
              addDebugLog(`Error in stream renegotiation: ${e}`);
            }
          }
        }, 3000);
      });
      
      peer.on('stream', (remoteMediaStream: MediaStream) => {
        clearTimeout(connectionTimer); // Clear the timeout once we get a stream
        connectionEstablished = true;
        
        addDebugLog(`✅ Received remote stream with ${remoteMediaStream.getTracks().length} tracks`);
        
        // Ensure all tracks are enabled and log details
        remoteMediaStream.getTracks().forEach((track, i) => {
          addDebugLog(`Remote track ${i}: kind=${track.kind}, enabled=${track.enabled}, readyState=${track.readyState}`);
          track.enabled = true;
        });
        
        // Store remote stream in state
        setRemoteStream(remoteMediaStream);
        
        // IMPORTANT: Use a brief timeout to ensure React has updated before attaching stream
        setTimeout(() => {
          if (attachStreamToVideoRef.current) {
            attachStreamToVideoRef.current(remoteMediaStream);
          } else {
            addDebugLog("⚠️ attachStreamToVideo function not available");
          }
        }, 100);
      });
      
      peer.on('error', (err: Error) => {
        addDebugLog(`⚠️ Peer error: ${err.name} - ${err.message}`);
        console.error('Peer error:', err);
        
        // For ICE failures, try to recover
        if (err.message.includes('ICE') || err.message.includes('timeout')) {
          addDebugLog('Attempting to recover from ICE failure...');
          // Allow some time for potential recovery
          setTimeout(() => {
            if (peerRef.current === peer && !(peer as any).connected) {
              addDebugLog('Connection failed to recover, restarting');
              // Clean up this failed connection
              peer.destroy();
              peerRef.current = null;
              // Try again with the same parameters
              startPeerConnection(isInitiator, roomId);
            }
          }, 5000);
        }
      });
      
      peer.on('close', () => {
        addDebugLog('Peer connection closed');
        // Clean up if this is still the current peer
        if (peerRef.current === peer) {
          peerRef.current = null;
        }
      });
      
      // Process any buffered signals that arrived before peer was ready
      if (signalBufferRef.current[roomId] && signalBufferRef.current[roomId].length > 0) {
        addDebugLog(`Processing ${signalBufferRef.current[roomId].length} buffered signals for room ${roomId}`);
        // Sort signals to process offers first, then candidates
        const sortedSignals = [...signalBufferRef.current[roomId]].sort((a, b) => {
          // Process offers first
          if (a.signal.type === 'offer') return -1;
          if (b.signal.type === 'offer') return 1;
          return 0;
        });
        
        // Process each buffered signal
        sortedSignals.forEach(data => {
          try {
            addDebugLog(`Processing buffered signal: ${data.signal.type || 'candidate'}`);
            peer.signal(data.signal);
          } catch (err) {
            addDebugLog(`Error processing buffered signal: ${err}`);
          }
        });
        
        // Clear the buffer after processing
        signalBufferRef.current[roomId] = [];
      } else {
        addDebugLog(`No buffered signals for room ${roomId}`);
      }
      
    } catch (error) {
      const err = error as Error;
      addDebugLog(`Error starting peer connection: ${err.name} - ${err.message}`);
      console.error('Error in peer connection setup:', error);
    }
  }, [addDebugLog, initLocalStream, localStream, socket, toast, currentRoomId]);
  
  // Update signal handling for better persistence across reconnections
  useEffect(() => {
    if (!socket) return;
    
    // Cleanup and re-add the signal handler for better reliability
    const handleSignal = (data: any) => {
      addDebugLog(`Received signal from: ${data.from}, type=${data.signal.type || 'candidate'}`);
      
      // Store the roomId from the signal
      const roomId = data.roomId;
      
      // Initialize buffer for this room if needed
      if (!signalBufferRef.current[roomId]) {
        signalBufferRef.current[roomId] = [];
      }
      
      if (!peerRef.current) {
        // If the peer isn't ready yet, buffer the signal for later processing
        addDebugLog(`Buffering signal for later processing (peer not ready) for room ${roomId}`);
        signalBufferRef.current[roomId].push(data);
        return;
      }
      
      try {
        // SimplePeer handles all signal types correctly internally
        peerRef.current.signal(data.signal);
        addDebugLog(`Signal processed by SimplePeer`);
      } catch (err) {
        addDebugLog(`Error processing signal: ${err}`);
      }
    };
    
    // Update the signal handler
    socket.off('signal');
    socket.on('signal', handleSignal);
    
    return () => {
      socket.off('signal', handleSignal);
    };
  }, [socket, peerRef, addDebugLog]);
  
  // Improve the endCurrentChat function to ensure proper cleanup
  const endCurrentChat = () => {
    addDebugLog("Ending current chat with full cleanup");
    setIsInChat(false);
    setPeerInfo(null);
    
    // Send end_chat event to server
    if (currentRoomId && socket) {
      if (socket.connected) {
        addDebugLog(`Emitting end_chat event for room ${currentRoomId}`);
        socket.emit('end_chat', { roomId: currentRoomId });
      } else {
        addDebugLog("⚠️ Socket not connected - can't end chat properly");
      }
      
      // Clear any buffered signals for this room
      if (signalBufferRef.current[currentRoomId]) {
        addDebugLog(`Clearing ${signalBufferRef.current[currentRoomId].length} buffered signals for room ${currentRoomId}`);
        delete signalBufferRef.current[currentRoomId];
      }
    }
    
    // Clean up peer connection
    if (peerRef.current) {
      addDebugLog("Destroying peer connection");
      try {
        peerRef.current.destroy();
      } catch (err) {
        addDebugLog(`Error destroying peer: ${err}`);
      }
      peerRef.current = null;
    }
    
    // Clean up remote stream
    if (remoteStream) {
      addDebugLog("Stopping all remote stream tracks");
      try {
        remoteStream.getTracks().forEach(track => {
          addDebugLog(`Stopping remote track: ${track.kind}`);
          track.stop();
        });
      } catch (err) {
        addDebugLog(`Error stopping remote tracks: ${err}`);
      }
      
      // Clear video element
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      
      setRemoteStream(null);
    }
    
    // Clean up any backup video or audio elements that may have been created
    try {
      const backupVideo = document.getElementById('backup-video');
      if (backupVideo) {
        addDebugLog('Removing backup video element');
        (backupVideo as HTMLVideoElement).srcObject = null;
        backupVideo.remove();
      }
      
      const fallbackAudio = document.getElementById('fallback-audio');
      if (fallbackAudio) {
        addDebugLog('Removing fallback audio element');
        (fallbackAudio as HTMLAudioElement).srcObject = null;
        fallbackAudio.remove();
      }
      
      const playButtonContainer = document.getElementById('play-button-container');
      if (playButtonContainer) {
        addDebugLog('Removing play button container');
        playButtonContainer.remove();
      }
      
      const audioIndicator = document.getElementById('audio-indicator');
      if (audioIndicator) {
        audioIndicator.remove();
      }
    } catch (err) {
      addDebugLog(`Error cleaning up DOM elements: ${err}`);
    }
    
    // Reset room state
    setCurrentRoomId(null);
    
    // Update online count
    if (socket && socket.connected) {
      socket.emit('get_online_count');
    }

    // Force a small delay before allowing new connections to ensure cleanup
    setTimeout(() => {
      addDebugLog("Chat cleanup completed, ready for new connections");
    }, 500);
  };
  
  // Add an improved socket event listener for chat_ended to ensure proper cleanup
  useEffect(() => {
    if (!socket) return;
    
    // When chat is ended by peer
    const handleChatEnded = () => {
      addDebugLog('Chat ended by peer or server');
      
      // Perform full cleanup
      if (peerRef.current) {
        try {
          peerRef.current.destroy();
        } catch (err) {
          addDebugLog(`Error destroying peer on chat_ended: ${err}`);
        }
        peerRef.current = null;
      }
      
      // Stop all remote media tracks
      if (remoteStream) {
        try {
          remoteStream.getTracks().forEach(track => {
            track.stop();
          });
        } catch (err) {
          addDebugLog(`Error stopping remote tracks on chat_ended: ${err}`);
        }
        
        // Clear video element
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
        
        setRemoteStream(null);
      }
      
      // Reset UI state
      setIsInChat(false);
      setPeerInfo(null);
      setCurrentRoomId(null);
      
      toast({
        title: 'Chat Ended',
        description: 'The other person ended the chat',
        variant: 'default',
      });
    };
    
    // Update the handler
    socket.off('chat_ended');
    socket.on('chat_ended', handleChatEnded);
    
    return () => {
      socket.off('chat_ended', handleChatEnded);
    };
  }, [socket, remoteStream, peerRef, toast]);
  
  // Enhance connection and cleanup between sessions
  useEffect(() => {
    // Cleanup function that will run when component unmounts or dependencies change
    return () => {
      addDebugLog('Running enhanced cleanup for component lifecycle');
      
      // Clear any signal buffers
      signalBufferRef.current = {};
      
      // Stop all local tracks if any
      if (localStream) {
        addDebugLog('Stopping all local tracks');
        localStream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (err) {
            addDebugLog(`Error stopping local track: ${err}`);
          }
        });
      }
      
      // Stop all remote tracks if any
      if (remoteStream) {
        addDebugLog('Stopping all remote tracks');
        remoteStream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (err) {
            addDebugLog(`Error stopping remote track: ${err}`);
          }
        });
      }
      
      // Destroy peer connection
      if (peerRef.current) {
        addDebugLog('Destroying peer connection in cleanup');
        try {
          peerRef.current.destroy();
        } catch (err) {
          addDebugLog(`Error destroying peer in cleanup: ${err}`);
        }
        peerRef.current = null;
      }
      
      // Clean up video elements
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      
      // Clean up any other media elements created dynamically
      try {
        ['backup-video', 'fallback-audio', 'play-button-container', 'audio-indicator'].forEach(id => {
          const elem = document.getElementById(id);
          if (elem) {
            if (elem instanceof HTMLMediaElement) {
              elem.srcObject = null;
            }
            elem.remove();
          }
        });
      } catch (err) {
        addDebugLog(`Error cleaning up DOM elements in final cleanup: ${err}`);
      }
    };
  }, []);
  
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

  // Function to create a canvas-based video renderer for Telegram Desktop
  const createCanvasRenderer = (stream: MediaStream) => {
    addDebugLog('Setting up canvas renderer for Telegram Desktop');
    
    // Find video tracks
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      addDebugLog('No video track found in remote stream for canvas rendering');
      return;
    }
    
    // Create temporary video element for capturing frames
    const tempVideo = document.createElement('video');
    tempVideo.srcObject = new MediaStream([videoTrack]);
    tempVideo.autoplay = true;
    tempVideo.muted = true;
    tempVideo.style.display = 'none';
    document.body.appendChild(tempVideo);
    
    // Create canvas element
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.objectFit = 'cover';
    
    // Replace video element with canvas
    const parentElement = remoteVideoRef.current?.parentElement;
    if (parentElement && remoteVideoRef.current) {
      remoteVideoRef.current.style.display = 'none';
      parentElement.appendChild(canvas);
      
      // Add status indicator
      const statusIndicator = document.createElement('div');
      statusIndicator.innerText = 'Telegram Desktop Mode';
      statusIndicator.style.position = 'absolute';
      statusIndicator.style.top = '10px';
      statusIndicator.style.right = '10px';
      statusIndicator.style.backgroundColor = 'rgba(0,0,0,0.5)';
      statusIndicator.style.color = 'white';
      statusIndicator.style.padding = '5px 10px';
      statusIndicator.style.borderRadius = '4px';
      statusIndicator.style.fontSize = '12px';
      parentElement.appendChild(statusIndicator);
    } else {
      addDebugLog('ERROR: Cannot add canvas renderer - no parent element');
      tempVideo.remove();
      return;
    }
    
    // Draw video frames to canvas
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      addDebugLog('ERROR: Cannot get 2D context from canvas');
      tempVideo.remove();
      return;
    }
    
    let animationFrameId: number;
    
    // Start rendering loop
    const renderFrame = () => {
      if (tempVideo.readyState >= 2) {
        try {
          canvas.width = tempVideo.videoWidth || 640;
          canvas.height = tempVideo.videoHeight || 480;
          ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
        } catch (err) {
          addDebugLog(`Error drawing to canvas: ${err}`);
        }
      }
      animationFrameId = requestAnimationFrame(renderFrame);
    };
    
    // Handle video playing
    tempVideo.onplay = () => {
      addDebugLog('Canvas renderer source video is playing');
      renderFrame();
    };
    
    // Clean up on component unmount
    return () => {
      cancelAnimationFrame(animationFrameId);
      tempVideo.remove();
      canvas.remove();
    };
  };

  // Function to create an audio-only element when video isn't working
  const createAudioOnlyElement = (stream: MediaStream) => {
    addDebugLog('Creating audio-only element as fallback');
    
    // Find audio tracks
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      addDebugLog('No audio tracks found in remote stream');
      return;
    }
    
    // Create audio element
    let audioElement = document.getElementById('fallback-audio') as HTMLAudioElement;
    if (!audioElement) {
      audioElement = document.createElement('audio');
      audioElement.id = 'fallback-audio';
      audioElement.controls = false;
      audioElement.autoplay = true;
      audioElement.style.display = 'none';
      document.body.appendChild(audioElement);
    }
    
    // Create a stream with only audio
    const audioStream = new MediaStream(audioTracks);
    
    // Set audio element source
    audioElement.srcObject = audioStream;
    
    // Play with error handling
    audioElement.play()
      .then(() => {
        addDebugLog('Audio-only playback started successfully');
        
        // Add audio indicator to the UI
        const parentElement = remoteVideoRef.current?.parentElement;
        if (parentElement) {
          let audioIndicator = document.getElementById('audio-indicator');
          if (!audioIndicator) {
            audioIndicator = document.createElement('div');
            audioIndicator.id = 'audio-indicator';
            audioIndicator.innerText = '🔊 Audio Active';
            audioIndicator.style.position = 'absolute';
            audioIndicator.style.bottom = '10px';
            audioIndicator.style.left = '50%';
            audioIndicator.style.transform = 'translateX(-50%)';
            audioIndicator.style.backgroundColor = 'rgba(0,0,0,0.5)';
            audioIndicator.style.color = 'white';
            audioIndicator.style.padding = '5px 10px';
            audioIndicator.style.borderRadius = '4px';
            parentElement.appendChild(audioIndicator);
          }
        }
      })
      .catch((err) => {
        addDebugLog(`Error playing audio-only element: ${err.message}`);
      });
  };

  // Add a function to create a visible play button
  const addPlayButton = useCallback((stream: MediaStream) => {
    addDebugLog('Adding play button overlay for manual playback');
    
    // Create container if it doesn't exist
    let playButtonContainer = document.getElementById('play-button-container');
    if (!playButtonContainer) {
      playButtonContainer = document.createElement('div');
      playButtonContainer.id = 'play-button-container';
      playButtonContainer.style.position = 'absolute';
      playButtonContainer.style.top = '50%';
      playButtonContainer.style.left = '50%';
      playButtonContainer.style.transform = 'translate(-50%, -50%)';
      playButtonContainer.style.zIndex = '1000';
      playButtonContainer.style.display = 'flex';
      playButtonContainer.style.flexDirection = 'column';
      playButtonContainer.style.alignItems = 'center';
      playButtonContainer.style.gap = '10px';
      
      const parentElement = remoteVideoRef.current?.parentElement;
      if (parentElement) {
        parentElement.style.position = 'relative';
        parentElement.appendChild(playButtonContainer);
      } else {
        addDebugLog('ERROR: Cannot add play button - no parent element');
        return;
      }
    }
    
    // Clear existing content
    playButtonContainer.innerHTML = '';
    
    // Add status text
    const statusText = document.createElement('div');
    statusText.innerText = 'Tap to enable media';
    statusText.style.color = '#ffffff';
    statusText.style.fontWeight = 'bold';
    statusText.style.textShadow = '0 0 3px rgba(0,0,0,0.5)';
    playButtonContainer.appendChild(statusText);
    
    // Create play button
    const playButton = document.createElement('button');
    playButton.innerHTML = '▶️';
    playButton.style.fontSize = '40px';
    playButton.style.width = '80px';
    playButton.style.height = '80px';
    playButton.style.borderRadius = '50%';
    playButton.style.border = '2px solid white';
    playButton.style.backgroundColor = 'rgba(0,0,0,0.5)';
    playButton.style.color = 'white';
    playButton.style.cursor = 'pointer';
    
    // Add click handler
    playButton.onclick = () => {
      addDebugLog('Play button clicked, attempting to play media');
      
      // Try to play the video first
      if (remoteVideoRef.current) {
        remoteVideoRef.current.muted = false;
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play()
          .then(() => {
            addDebugLog('Video playback started via play button');
            playButtonContainer?.remove();
          })
          .catch((err) => {
            addDebugLog(`Still failed to play video: ${err.message}`);
            
            // Fall back to audio at minimum
            createAudioOnlyElement(stream);
            
            // Update status text
            statusText.innerText = 'Video unavailable, audio only';
          });
      }
    };
    
    playButtonContainer.appendChild(playButton);
  }, [addDebugLog]);
  
  // Store in ref for use in other functions
  addPlayButtonRef.current = addPlayButton;
  
  // Add a function to monitor video playback and recover if needed
  const monitorVideoPlayback = useCallback((stream: MediaStream) => {
    addDebugLog('Starting video playback monitoring');
    
    // Monitor video status to check for frozen frames or stalls
    const videoMonitorInterval = setInterval(() => {
      if (!remoteVideoRef.current || !isInChat) {
        clearInterval(videoMonitorInterval);
        return;
      }
      
      const videoElem = remoteVideoRef.current;
      
      // Check for common issues
      const hasValidDimensions = videoElem.videoWidth > 0 && videoElem.videoHeight > 0;
      const isPlaying = !videoElem.paused && videoElem.readyState >= 3;
      
      if (!hasValidDimensions || !isPlaying) {
        addDebugLog(`Video check: issues detected - dims=${videoElem.videoWidth}x${videoElem.videoHeight}, playing=${!videoElem.paused}, state=${videoElem.readyState}`);
        
        // Try to fix by resetting and trying again
        try {
          // Quick fix attempt - reset srcObject and play again
          const tempStream = videoElem.srcObject;
          videoElem.srcObject = null;
          
          // Force layout recalculation
          setTimeout(() => {
            if (remoteVideoRef.current && isInChat) {
              remoteVideoRef.current.srcObject = tempStream;
              remoteVideoRef.current.play().catch(() => {
                // If this fails, we'll catch it on the next monitoring cycle
                addDebugLog('Recovery attempt failed');
              });
            }
          }, 200);
        } catch (e) {
          addDebugLog(`Recovery attempt error: ${e}`);
        }
      } else {
        // Video seems to be playing fine
        addDebugLog('Video check: playing correctly');
      }
    }, 3000);
    
    // Return cleanup function
    return () => {
      clearInterval(videoMonitorInterval);
    };
  }, [addDebugLog, isInChat]);
  
  // Store in ref for use in other functions
  monitorVideoPlaybackRef.current = monitorVideoPlayback;
  
  // Add a function to reliably attach streams to video elements
  const attachStreamToVideo = useCallback((stream: MediaStream) => {
    // We'll try multiple approaches to ensure the stream attaches properly
    addDebugLog(`Attaching stream to video element: ${stream.id} with ${stream.getTracks().length} tracks`);
    
    if (!remoteVideoRef.current) {
      addDebugLog('⚠️ No remote video element reference available');
      return;
    }
    
    try {
      // Make sure all tracks are enabled and active
      stream.getTracks().forEach(track => {
        addDebugLog(`Enabling track: ${track.kind}, id=${track.id}`);
        track.enabled = true;
      });
      
      // Standard procedure: 
      // 1. Reset everything
      // 2. Attach stream
      // 3. Try to play immediately
      
      // Clear existing srcObject and reset video properties
      remoteVideoRef.current.srcObject = null;
      remoteVideoRef.current.muted = false;
      remoteVideoRef.current.volume = 1.0;
      remoteVideoRef.current.controls = false;
      remoteVideoRef.current.playsInline = true;
      remoteVideoRef.current.autoplay = true;
      
      // Provide the stream to the video element
      remoteVideoRef.current.srcObject = stream;
      
      // Function to attempt playback
      const attemptPlay = (retries = 0) => {
        if (!remoteVideoRef.current || retries >= 3) {
          // Too many retries or element is gone - give up and try alternatives
          if (retries >= 3) {
            addDebugLog('Maximum retry attempts reached');
            if (addPlayButtonRef.current) addPlayButtonRef.current(stream);
            createAudioOnlyElement(stream);
          }
          return;
        }
        
        // Try to play the video
        remoteVideoRef.current.play()
          .then(() => {
            addDebugLog('✅ Remote video playback started successfully');
            
            // Success - now set up monitoring to make sure it stays playing
            if (monitorVideoPlaybackRef.current) monitorVideoPlaybackRef.current(stream);
          })
          .catch((err) => {
            addDebugLog(`Attempt ${retries + 1} failed: ${err.message}`);
            
            if (retries < 2) {
              // Retry with a delay, but increase delay with each retry
              setTimeout(() => attemptPlay(retries + 1), (retries + 1) * 500);
            } else {
              // Last resort: add play button and fallback to audio
              if (addPlayButtonRef.current) addPlayButtonRef.current(stream);
              createAudioOnlyElement(stream);
            }
          });
      };
      
      // Approach 1: Try to play immediately
      attemptPlay();
      
      // Provide helpful user feedback
      toast({
        title: 'Video Connected',
        description: 'Stream received, starting playback...',
        variant: 'default',
      });
    } catch (err: any) {
      addDebugLog(`Error attaching stream: ${err.message}`);
      
      // Ultimate fallback: create separate audio and video elements
      createAudioOnlyElement(stream);
      if (addPlayButtonRef.current) addPlayButtonRef.current(stream);
    }
  }, [addDebugLog, toast, createAudioOnlyElement]);
  
  // Store in ref for use in other functions
  attachStreamToVideoRef.current = attachStreamToVideo;
  
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
      // First, ensure any previous chat is fully ended
      if (isInChat) {
        addDebugLog("Ending previous chat before starting new one");
        endCurrentChat();
        
        // Small delay to ensure cleanup completes
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      addDebugLog("Starting search for random chat");
      setIsSearching(true);
      
      // Make sure we have a local stream
      if (!localStream) {
        addDebugLog("No local stream available, initializing");
        await initLocalStream();
      } else {
        // Re-enable tracks that might have been disabled
        addDebugLog("Re-enabling any disabled tracks");
        localStream.getVideoTracks().forEach(track => {
          if (!track.enabled && isVideoEnabled) {
            track.enabled = true;
          }
        });
        
        localStream.getAudioTracks().forEach(track => {
          if (!track.enabled && isAudioEnabled) {
            track.enabled = true;
          }
        });
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

  // Set up socket event listeners for signaling
  useEffect(() => {
    if (!socket) return;
    
    // Handle signals from other peer
    const handleSignal = (data: { roomId: string; signal: any }) => {
      // Only process signals for the current room
      if (data.roomId !== currentRoomId) {
        addDebugLog(`⚠️ Ignoring signal for room ${data.roomId} - we are in room ${currentRoomId || 'none'}`);
        return;
      }
      
      // Check if peer exists
      if (!peerRef.current) {
        addDebugLog(`⚠️ Received signal but peer not initialized - buffering signal`);
        
        // Buffer the signal for when peer is initialized
        if (!signalBufferRef.current[data.roomId]) {
          signalBufferRef.current[data.roomId] = [];
        }
        
        signalBufferRef.current[data.roomId].push({ signal: data.signal, type: 'incoming' });
        return;
      }
      
      addDebugLog(`Received signal: ${data.signal.type || 'candidate'} for room ${data.roomId}`);
      
      try {
        // Apply the signal to the peer connection
        peerRef.current.signal(data.signal);
      } catch (err) {
        addDebugLog(`Error processing signal: ${err}`);
      }
    };
    
    // Handle room_full event
    const handleRoomFull = () => {
      addDebugLog('Room is full');
      setIsSearching(false);
      
      toast({
        title: 'Room Full',
        description: 'The room is full. Please try again later.',
        variant: 'destructive',
      });
    };
    
    // Handle chat_request_cancelled event
    const handleChatRequestCancelled = () => {
      addDebugLog('Chat request cancelled');
      setIsSearching(false);
      
      toast({
        title: 'Search Cancelled',
        description: 'Your chat request was cancelled. Please try again.',
        variant: 'default',
      });
    };
    
    // Register event handlers
    socket.on('signal', handleSignal);
    socket.on('room_full', handleRoomFull);
    socket.on('chat_request_cancelled', handleChatRequestCancelled);
    
    // Clean up event handlers
    return () => {
      socket.off('signal', handleSignal);
      socket.off('room_full', handleRoomFull);
      socket.off('chat_request_cancelled', handleChatRequestCancelled);
    };
  }, [socket, currentRoomId, peerRef, toast]);
  
  // Define a handler for matched_user events that will be used after all functions are declared
  useEffect(() => {
    if (!socket) return;
    
    const handleMatchedUser = async (data: { roomId: string; isInitiator: boolean; peer: any }) => {
      addDebugLog(`Matched with peer: ${JSON.stringify(data.peer)}`);
      setIsSearching(false);
      setIsInChat(true);
      setPeerInfo(data.peer);
      setCurrentRoomId(data.roomId);
      
      // Create a new peer connection
      try {
        await startPeerConnection(data.isInitiator, data.roomId);
        
        // Notify user
        toast({
          title: 'Connected!',
          description: `You're now chatting with ${data.peer.firstName || data.peer.username || 'Someone'}`,
          variant: 'default',
        });
      } catch (err) {
        const error = err as Error;
        addDebugLog(`Error creating peer connection: ${error.message}`);
        
        toast({
          title: 'Connection Error',
          description: 'Failed to establish connection. Please try again.',
          variant: 'destructive',
        });
        
        // Clean up failed connection attempt
        setIsInChat(false);
        setPeerInfo(null);
        setCurrentRoomId(null);
      }
    };
    
    socket.on('matched_user', handleMatchedUser);
    
    return () => {
      socket.off('matched_user', handleMatchedUser);
    };
  }, [socket, addDebugLog, startPeerConnection, toast]);

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
