/**
 * Bridge Module
 * Re-exports bridge components
 */

export {
  type BridgeConfig,
  type SysCallHandler,
} from "./bridge-types.js";
export { DockerPluginBridge } from "./docker-bridge.js";
export type { PluginBridge } from "./plugin-bridge.js";
export { PermissionGuard, PermissionDeniedError } from "./permission-guard.js";
export {
  createSysCallHandler,
} from "./syscall-handler.js";
export type {
  SystemLogger,
  LLMAdapter,
  SysCallDependencies,
  SysCallOrchestrator,
} from "./types.js";
