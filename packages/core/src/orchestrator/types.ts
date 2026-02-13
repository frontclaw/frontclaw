import type { SysCallDependencies } from "../bridge/index.js";
import type { LoaderConfig } from "../loader/index.js";
import type { MemoryService } from "../memory/index.js";

/** Orchestrator configuration */
export interface OrchestratorConfig {
  /** Plugin loader configuration */
  loader: LoaderConfig;
  /** System call dependencies */
  dependencies: SysCallDependencies;
  /** Memory service (optional) */
  memoryService?: MemoryService;
  /** Hook timeout in milliseconds */
  hookTimeout?: number;
}

/** Pipeline execution result */
export interface PipelineResult<T> {
  success: boolean;
  result?: T;
  interceptedBy?: string;
  error?: {
    pluginId: string;
    code: string;
    message: string;
  };
}
