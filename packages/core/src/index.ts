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
  DockerPluginBridge,
  PermissionDeniedError,
  PermissionGuard,
  type BridgeConfig,
  type LLMAdapter,
  type PluginBridge,
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

// Runtime
export {
  createAIRuntimeManager,
  type AIClientInstance,
  type AIRuntimeManager,
  type AIRuntimeManagerOptions,
} from "./runtime/ai-runtime.js";
export {
  createOrchestratorRuntime,
  type OrchestratorRuntime,
  type OrchestratorRuntimeOptions,
  type RuntimeAppLogger,
} from "./runtime/orchestrator-runtime.js";

// Plugins
export {
  readPluginCatalog,
  setPluginEnabled,
  type PluginCatalogEntry,
} from "./plugins/catalog.js";

// Context
export {
  buildConversationMetrics,
  compactConversationContext,
  computeConversationContextMetrics,
  estimateMessagesTokens,
  estimateTokens,
  loadContextCompactionConfigFromDisk,
  parsePagingValue,
  resolveContextCompactionConfig,
  type ContextCompactionResult,
  type ContextCompactionRuntimeConfig,
  type ContextMessage,
  type ConversationHistoryMessage,
  type ConversationContextMetrics,
  toContextMessages,
  toConversationHistoryMessages,
} from "./context/management.js";

// Chat
export {
  buildToolContext,
  createToolExecutor,
  deriveConversationTitle,
  fallbackFromToolResults,
  hasConversationTitle,
  normalizeConversationTitle,
  resolveToolOutputRouting,
  toLLMMessages,
  toPreview,
  toTextContent,
  wantsStream,
  ToolTerminalResponseError,
  type ChatPipelineMessage,
  type ExecutedToolContext,
  type PersistedToolEvent,
  type ToolExecutionMode,
} from "./chat/pipeline.js";
export {
  buildAIToolDefinitions,
  buildFinalSystemPrompt,
  DEFAULT_PERSONALITY_SYSTEM_PROMPT,
  runConversationCompaction,
} from "./chat/service.js";
export {
  executeChatRequest,
  type ChatExecutionDeps,
  type ChatExecutionResult,
  type ChatRequestBody,
} from "./chat/execute-chat.js";
export {
  executeConversationCompactionRequest,
  executeConversationContextRequest,
  executeConversationMetricsRequest,
} from "./chat/context-apis.js";

// Stream
export {
  appendSSESessionEvent,
  closeSSESession,
  createSSESession,
  createSSESessionReadable,
  hasSSESession,
} from "./stream/sse-session-store.js";
