declare module 'simple-peer' {
  interface SimplePeerOptions {
    initiator: boolean;
    trickle?: boolean;
    stream?: MediaStream;
    config?: RTCConfiguration;
  }

  interface Instance {
    signal: (data: any) => void;
    destroy: () => void;
    on: (event: string, callback: Function) => void;
  }

  interface SimplePeerConstructor {
    new(opts: SimplePeerOptions): Instance;
    (opts: SimplePeerOptions): Instance;
  }

  const SimplePeer: SimplePeerConstructor;
  export default SimplePeer;
} 