export interface PluginBridge {
  readonly ready: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  callHook<T = unknown>(method: string, payload: unknown): Promise<T | undefined>;
}

