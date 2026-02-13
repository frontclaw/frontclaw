/**
 * Bridge Module
 * Re-exports bridge components
 */

export {
  PluginWorkerBridge,
  type BridgeConfig,
  type SysCallHandler,
} from "./worker-bridge.js";
export { PermissionGuard, PermissionDeniedError } from "./permission-guard.js";
export {
  createSysCallHandler,
} from "./syscall-handler.js";
export type {
  SystemLogger,
  DBAdapter,
  SysCallDependencies,
  SysCallOrchestrator,
} from "./types.js";
