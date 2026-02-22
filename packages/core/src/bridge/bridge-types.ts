import type { LoadedPluginManifest } from "@workspace/plugin-sdk";

/** Bridge configuration */
export interface BridgeConfig {
  /** Hook timeout in milliseconds */
  hookTimeout: number;
  /** System call timeout in milliseconds */
  sysCallTimeout: number;
}

/** System call handler function */
export type SysCallHandler = (
  method: string,
  payload: unknown,
  manifest: LoadedPluginManifest,
) => Promise<unknown>;

