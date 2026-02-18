import type { ChatMessage } from "@workspace/plugin-sdk";
import { isInterceptResult } from "@workspace/plugin-sdk";
import type { PipelineResult } from "../types.js";
import type { PluginRuntimeContext } from "../runtime-context.js";

export async function processPromptPipeline(
  runtime: PluginRuntimeContext,
  prompt: string,
): Promise<PipelineResult<string>> {
  let currentPrompt = prompt;

  for (const manifest of runtime.manifests) {
    const bridge = runtime.bridges.get(manifest.id);
    if (!bridge) continue;

    if (!manifest.permissions.llm?.can_modify_prompt) continue;

    try {
      const result = await bridge.callHook("onPromptReceived", currentPrompt);

      if (result === undefined) continue;

      if (isInterceptResult(result)) {
        return {
          success: true,
          result: result.result as string,
          interceptedBy: manifest.id,
        };
      }

      currentPrompt = result as string;
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        error: {
          pluginId: manifest.id,
          code: (err as any).code || "PROMPT_ERROR",
          message: err.message,
        },
      };
    }
  }

  return { success: true, result: currentPrompt };
}

export async function transformSystemMessagePipeline(
  runtime: PluginRuntimeContext,
  systemMessage: string,
): Promise<string> {
  let currentMessage = systemMessage;

  for (const manifest of runtime.manifests) {
    const bridge = runtime.bridges.get(manifest.id);
    if (!bridge) continue;

    if (!manifest.permissions.llm?.can_modify_system_message) continue;

    try {
      const result = await bridge.callHook("transformSystemMessage", currentMessage);
      if (typeof result === "string") {
        currentMessage = result;
      }
    } catch (error) {
      console.error(`Plugin ${manifest.id} failed transformSystemMessage:`, error);
    }
  }

  return currentMessage;
}

export async function beforeLLMCallPipeline(
  runtime: PluginRuntimeContext,
  messages: ChatMessage[],
): Promise<PipelineResult<ChatMessage[]>> {
  let currentMessages = messages;

  for (const manifest of runtime.manifests) {
    const bridge = runtime.bridges.get(manifest.id);
    if (!bridge) continue;

    if (!manifest.permissions.llm?.can_intercept_task) continue;

    try {
      const result = await bridge.callHook("beforeLLMCall", currentMessages);

      if (result === undefined) continue;

      if (isInterceptResult(result)) {
        return {
          success: true,
          result: result.result as ChatMessage[],
          interceptedBy: manifest.id,
        };
      }

      currentMessages = result as ChatMessage[];
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        error: {
          pluginId: manifest.id,
          code: (err as any).code || "LLM_CALL_ERROR",
          message: err.message,
        },
      };
    }
  }

  return { success: true, result: currentMessages };
}

export async function afterLLMCallPipeline(
  runtime: PluginRuntimeContext,
  response: string,
): Promise<string> {
  let currentResponse = response;

  for (const manifest of runtime.manifests) {
    const bridge = runtime.bridges.get(manifest.id);
    if (!bridge) continue;

    if (!manifest.permissions.llm?.can_modify_response) continue;

    try {
      const result = await bridge.callHook("afterLLMCall", currentResponse);
      if (typeof result === "string") {
        currentResponse = result;
      }
    } catch (error) {
      console.error(`Plugin ${manifest.id} failed afterLLMCall:`, error);
    }
  }

  return currentResponse;
}
