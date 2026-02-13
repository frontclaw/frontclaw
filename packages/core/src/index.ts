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
  PluginWorkerBridge,
  PermissionGuard,
  PermissionDeniedError,
  createSysCallHandler,
  type BridgeConfig,
  type SysCallHandler,
  type SystemLogger,
  type DBAdapter,
  type SysCallDependencies,
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
  type ChatMessage,
  type ChatCompletionOptions,
  type ChatCompletionResult,
  type StreamChunk,
  type ToolDefinition,
  type ToolCall,
  type ToolResult,
  type EmbeddingOptions,
  type EmbeddingResult,
  type StructuredOutputOptions,
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
