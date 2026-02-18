/**
 * @workspace/core
 *
 * Frontclaw Core - Plugin Orchestration Engine
 */

// Utilities
export * from "./lib/utils.js";

// Orchestrator
export {
  Orchestrator,
  type OrchestratorConfig,
  type PipelineResult,
} from "./orchestrator/index.js";

// Bridge
export {
  createSysCallHandler,
  PermissionDeniedError,
  PermissionGuard,
  PluginWorkerBridge,
  type BridgeConfig,
  type DBAdapter,
  type SysCallDependencies,
  type SysCallHandler,
  type SystemLogger,
} from "./bridge/index.js";

// Loader
export {
  PluginLoader,
  PluginLoadError,
  type LoaderConfig,
} from "./loader/index.js";

// AI
export {
  AIClient,
  createAIClient,
  defaultAIClient,
  type AIClientConfig,
  type ChatCompletionOptions,
  type ChatCompletionResult,
  type ChatMessage,
  type EmbeddingOptions,
  type EmbeddingResult,
  type StreamChunk,
  type StructuredOutputOptions,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
} from "./ai/index.js";

// Memory
export {
  InMemoryService,
  RedisMemoryService,
  SecureMemoryService,
  type MemoryService,
  type RedisMemoryOptions,
  type SecureMemoryOptions,
} from "./memory/index.js";
