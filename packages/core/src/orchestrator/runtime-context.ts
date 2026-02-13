import type { LoadedPluginManifest } from "@workspace/plugin-sdk";
import type { PluginWorkerBridge } from "../bridge/index.js";

export interface PluginRuntimeContext {
  manifests: LoadedPluginManifest[];
  bridges: Map<string, PluginWorkerBridge>;
}
