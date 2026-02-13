/**
 * Plugin Orchestrator
 * The central coordinator for plugin execution pipeline
 */

import type {
  LoadedPluginManifest,
  ChatMessage,
  ToolDefinition,
  ToolResult,
  SkillDefinition,
  SkillResult,
  SearchOptions,
  HTTPRequestContext,
  HTTPResponse,
  SocketClient,
} from "@workspace/plugin-sdk";
import {
  PluginWorkerBridge,
  createSysCallHandler,
} from "../bridge/index.js";
import { PluginLoader } from "../loader/index.js";
import { InMemoryService, type MemoryService } from "../memory/index.js";
import {
  afterLLMCallPipeline,
  beforeLLMCallPipeline,
  processPromptPipeline,
  transformSystemMessagePipeline,
} from "./pipelines/prompt.js";
import { collectToolsPipeline, executeToolPipeline } from "./pipelines/tools.js";
import {
  collectSkillsPipeline,
  executeSkillPipeline,
} from "./pipelines/skills.js";
import { searchPipeline } from "./pipelines/search.js";
import {
  onSocketConnectPipeline,
  onSocketDisconnectPipeline,
  onSocketMessagePipeline,
} from "./pipelines/socket.js";
import { routeHTTPRequestPipeline } from "./pipelines/http.js";
import type { PluginRuntimeContext } from "./runtime-context.js";
import type { OrchestratorConfig, PipelineResult } from "./types.js";

/**
 * Orchestrator
 * Manages plugin lifecycle and sequential pipeline execution
 */
export class Orchestrator {
  private bridges: Map<string, PluginWorkerBridge> = new Map();
  private manifests: LoadedPluginManifest[] = [];
  private loader: PluginLoader;
  private sysCallHandler: ReturnType<typeof createSysCallHandler>;
  private isStarted = false;
  private memory: MemoryService;

  constructor(private readonly config: OrchestratorConfig) {
    this.loader = new PluginLoader(config.loader);
    this.memory = config.memoryService ?? new InMemoryService();
    this.sysCallHandler = createSysCallHandler(config.dependencies, this);
  }

  private getRuntimeContext(): PluginRuntimeContext {
    return {
      manifests: this.manifests,
      bridges: this.bridges,
    };
  }

  /**
   * Start the orchestrator and load all plugins
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error("Orchestrator already started");
    }

    console.log("Starting Frontclaw Orchestrator...");

    this.manifests = await this.loader.loadAll();
    console.log(`Discovered ${this.manifests.length} plugins`);

    for (const manifest of this.manifests) {
      try {
        const bridge = new PluginWorkerBridge(manifest, this.sysCallHandler, {
          hookTimeout: this.config.hookTimeout || 5000,
          sysCallTimeout: 30000,
        });

        await bridge.start();
        this.bridges.set(manifest.id, bridge);
        console.log(`Loaded plugin: ${manifest.name} (${manifest.id})`);
      } catch (error) {
        console.error(`Failed to start plugin ${manifest.id}:`, error);
      }
    }

    this.isStarted = true;
    console.log(
      `Orchestrator started with ${this.bridges.size} active plugins`,
    );
  }

  /**
   * Stop the orchestrator and all plugins
   */
  async stop(): Promise<void> {
    console.log("Stopping Frontclaw Orchestrator...");

    for (const [id, bridge] of this.bridges) {
      try {
        await bridge.stop();
        console.log(`Stopped plugin: ${id}`);
      } catch (error) {
        console.error(`Error stopping plugin ${id}:`, error);
      }
    }

    this.bridges.clear();
    this.manifests = [];
    this.isStarted = false;
    console.log("Orchestrator stopped");
  }

  async processPrompt(prompt: string): Promise<PipelineResult<string>> {
    return processPromptPipeline(this.getRuntimeContext(), prompt);
  }

  async transformSystemMessage(systemMessage: string): Promise<string> {
    return transformSystemMessagePipeline(this.getRuntimeContext(), systemMessage);
  }

  async beforeLLMCall(
    messages: ChatMessage[],
  ): Promise<PipelineResult<ChatMessage[]>> {
    return beforeLLMCallPipeline(this.getRuntimeContext(), messages);
  }

  async afterLLMCall(response: string): Promise<string> {
    return afterLLMCallPipeline(this.getRuntimeContext(), response);
  }

  async collectTools(): Promise<ToolDefinition[]> {
    return collectToolsPipeline(this.getRuntimeContext());
  }

  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    return executeToolPipeline(this.getRuntimeContext(), toolName, args);
  }

  async collectSkills(): Promise<SkillDefinition[]> {
    return collectSkillsPipeline(this.getRuntimeContext());
  }

  async executeSkill(
    skillName: string,
    args: Record<string, unknown>,
  ): Promise<SkillResult> {
    return executeSkillPipeline(this.getRuntimeContext(), skillName, args);
  }

  async search(options: SearchOptions): Promise<unknown[]> {
    return searchPipeline(this.getRuntimeContext(), options);
  }

  async onSocketConnect(client: SocketClient): Promise<void> {
    await onSocketConnectPipeline(this.getRuntimeContext(), client);
  }

  async onSocketMessage(
    client: SocketClient,
    event: string,
    data: unknown,
  ): Promise<PipelineResult<unknown>> {
    return onSocketMessagePipeline(this.getRuntimeContext(), client, event, data);
  }

  async onSocketDisconnect(client: SocketClient): Promise<void> {
    await onSocketDisconnectPipeline(this.getRuntimeContext(), client);
  }

  async routeHTTPRequest(
    pluginId: string,
    request: HTTPRequestContext,
  ): Promise<HTTPResponse | null> {
    return routeHTTPRequestPipeline(this.getRuntimeContext(), pluginId, request);
  }

  /**
   * Get all loaded plugin manifests
   */
  getManifests(): LoadedPluginManifest[] {
    return [...this.manifests];
  }

  async memoryGet<T = unknown>(key: string): Promise<T | null> {
    return this.memory.get<T>(key);
  }

  async memorySet<T = unknown>(
    key: string,
    value: T,
    options?: { ttlSeconds?: number },
  ): Promise<void> {
    await this.memory.set<T>(key, value, options);
  }

  async memoryDelete(key: string): Promise<void> {
    await this.memory.delete(key);
  }

  async memoryList(
    prefix?: string,
    options?: { limit?: number },
  ): Promise<string[]> {
    return this.memory.list(prefix, options);
  }

  async memoryTtl(key: string): Promise<number | null> {
    return this.memory.ttlSeconds ? this.memory.ttlSeconds(key) : null;
  }

  /**
   * Get a specific plugin manifest
   */
  getManifest(pluginId: string): LoadedPluginManifest | undefined {
    return this.manifests.find((m) => m.id === pluginId);
  }

  /**
   * Check if orchestrator is running
   */
  get running(): boolean {
    return this.isStarted;
  }
}

export type { OrchestratorConfig, PipelineResult };
