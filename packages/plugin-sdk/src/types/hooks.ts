/**
 * Plugin Hook Types
 * Defines the lifecycle hooks that plugins can implement
 */

import type {
  PluginContext,
  SocketClient,
  PluginInterceptResult,
} from "./context";

/** Tool definition for LLM function calling */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: string[];
      }
    >;
    required?: string[];
  };
}

/** Tool execution result */
export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/** Skill definition */
export interface SkillDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: string[];
      }
    >;
    required?: string[];
  };
  outputSchema?: {
    type: string;
    description?: string;
  };
  tags?: string[];
}

/** Skill execution result */
export interface SkillResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/** Chat message structure */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Search options */
export interface SearchOptions {
  query: string;
  limit?: number;
  filters?: Record<string, unknown>;
}

/** HTTP request context for custom routes */
export interface HTTPRequestContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

/** HTTP response builder */
export interface HTTPResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

/**
 * Plugin Hooks Interface
 * All hooks are optional. Plugins implement only what they need.
 */
export interface PluginHooks {
  // ─────────────────────────────────────────────────────────────
  // LIFECYCLE HOOKS
  // ─────────────────────────────────────────────────────────────

  /** Called when the plugin is loaded */
  onLoad?(ctx: PluginContext): Promise<void>;

  /** Called when the plugin is about to be unloaded */
  onUnload?(ctx: PluginContext): Promise<void>;

  // ─────────────────────────────────────────────────────────────
  // PROMPT PIPELINE HOOKS
  // ─────────────────────────────────────────────────────────────

  /**
   * Intercept and transform user prompts before processing
   * Return transformed prompt or throw PluginError to block
   */
  onPromptReceived?(
    ctx: PluginContext,
    prompt: string,
  ): Promise<string | PluginInterceptResult<unknown>>;

  /**
   * Transform the system message before sending to LLM
   * Plugins can append security layers, context, etc.
   */
  transformSystemMessage?(
    ctx: PluginContext,
    systemMessage: string,
  ): Promise<string>;

  /**
   * Called before sending to LLM, after all transformations
   * Last chance to intercept
   */
  beforeLLMCall?(
    ctx: PluginContext,
    messages: ChatMessage[],
  ): Promise<ChatMessage[] | PluginInterceptResult<unknown>>;

  /**
   * Called after LLM response, before sending to user
   */
  afterLLMCall?(ctx: PluginContext, response: string): Promise<string>;

  // ─────────────────────────────────────────────────────────────
  // TOOL HOOKS
  // ─────────────────────────────────────────────────────────────

  /**
   * Register tools that the LLM can call
   */
  getTools?(ctx: PluginContext): Promise<ToolDefinition[]>;

  /**
   * Execute a tool call
   */
  executeTool?(
    ctx: PluginContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult>;

  // ─────────────────────────────────────────────────────────────
  // SKILL HOOKS
  // ─────────────────────────────────────────────────────────────

  /**
   * Register skills that can be invoked by the orchestrator or LLM
   */
  getSkills?(ctx: PluginContext): Promise<SkillDefinition[]>;

  /**
   * Execute a skill
   */
  executeSkill?(
    ctx: PluginContext,
    skillName: string,
    args: Record<string, unknown>,
  ): Promise<SkillResult>;

  // ─────────────────────────────────────────────────────────────
  // SEARCH HOOKS
  // ─────────────────────────────────────────────────────────────

  /**
   * Handle search requests
   */
  onSearch?(ctx: PluginContext, options: SearchOptions): Promise<unknown[]>;

  // ─────────────────────────────────────────────────────────────
  // SOCKET HOOKS
  // ─────────────────────────────────────────────────────────────

  /**
   * Called when a socket client connects
   */
  onSocketConnect?(ctx: PluginContext, client: SocketClient): Promise<void>;

  /**
   * Called when a socket message is received
   */
  onSocketMessage?(
    ctx: PluginContext,
    client: SocketClient,
    event: string,
    data: unknown,
  ): Promise<void | PluginInterceptResult<unknown>>;

  /**
   * Called when a socket client disconnects
   */
  onSocketDisconnect?(ctx: PluginContext, client: SocketClient): Promise<void>;

  // ─────────────────────────────────────────────────────────────
  // HTTP ROUTE HOOKS
  // ─────────────────────────────────────────────────────────────

  /**
   * Handle custom HTTP routes defined in permissions.api.routes
   */
  onHTTPRequest?(
    ctx: PluginContext,
    request: HTTPRequestContext,
  ): Promise<HTTPResponse>;
}

/** Complete plugin interface */
export interface FrontclawPlugin extends PluginHooks {
  /** Plugin metadata (can be used for runtime info) */
  readonly id?: string;
  readonly name?: string;
}
