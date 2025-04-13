declare module 'simple-peer' {
  interface SimplePeerOptions {
    initiator: boolean;
    trickle?: boolean;
    stream?: MediaStream;
    config?: {
      iceServers: Array<{
        urls: string | string[];
        username?: string;
        credential?: string;
      }>;
      iceCandidatePoolSize?: number;
      iceTransportPolicy?: RTCIceTransportPolicy;
      bundlePolicy?: RTCBundlePolicy;
      rtcpMuxPolicy?: RTCRtcpMuxPolicy;
      sdpSemantics?: string;
    };
    sdpTransform?: (sdp: string) => string;
  }

  interface Instance {
    signal: (data: any) => void;
    destroy: () => void;
    on: (event: string, callback: Function) => void;
    send: (data: any) => void;
    addStream: (stream: MediaStream) => void;
    removeStream: (stream: MediaStream) => void;
    addTrack: (track: MediaStreamTrack, stream: MediaStream) => void;
    removeTrack: (track: MediaStreamTrack, stream: MediaStream) => void;
    connected?: boolean;
  }

  interface SimplePeerConstructor {
    new(opts: SimplePeerOptions): Instance;
    (opts: SimplePeerOptions): Instance;
  }

  const SimplePeer: SimplePeerConstructor;
  export default SimplePeer;
} 