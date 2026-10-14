// Handle exposed by the mock backend in Vite "e2e" mode (src/test/mock-backend.ts).
interface Window {
  __termlinkMock?: {
    state: {
      knownHosts: {
        id: number;
        host: string;
        port: number;
        algorithm: string;
        publicKey: string;
        fingerprint: string;
        addedAt: number;
        lastSeenAt: number | null;
      }[];
      writes: { id: string; data: string }[];
      settings: { appearance: { theme: string } };
    };
  };
}
