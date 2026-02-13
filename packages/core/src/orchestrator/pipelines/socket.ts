import { isInterceptResult } from "@workspace/plugin-sdk";
import type { SocketClient } from "@workspace/plugin-sdk";
import type { PipelineResult } from "../types.js";
import type { PluginRuntimeContext } from "../runtime-context.js";

export async function onSocketConnectPipeline(
  runtime: PluginRuntimeContext,
  client: SocketClient,
): Promise<void> {
  for (const manifest of runtime.manifests) {
    const bridge = runtime.bridges.get(manifest.id);
    if (!bridge) continue;

    if (!manifest.permissions.socket?.can_intercept) continue;

    try {
      await bridge.callHook("onSocketConnect", client);
    } catch (error) {
      console.error(`Plugin ${manifest.id} failed onSocketConnect:`, error);
    }
  }
}

export async function onSocketMessagePipeline(
  runtime: PluginRuntimeContext,
  client: SocketClient,
  event: string,
  data: unknown,
): Promise<PipelineResult<unknown>> {
  for (const manifest of runtime.manifests) {
    const bridge = runtime.bridges.get(manifest.id);
    if (!bridge) continue;

    const socketPerm = manifest.permissions.socket;
    if (!socketPerm?.can_intercept) continue;
    if (
      socketPerm.events &&
      socketPerm.events.length > 0 &&
      !socketPerm.events.includes(event) &&
      !socketPerm.events.includes("*")
    ) {
      continue;
    }

    try {
      const result = await bridge.callHook("onSocketMessage", {
        client,
        event,
        data,
      });

      if (isInterceptResult(result)) {
        return {
          success: true,
          result: result.result,
          interceptedBy: manifest.id,
        };
      }
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        error: {
          pluginId: manifest.id,
          code: (err as any).code || "SOCKET_ERROR",
          message: err.message,
        },
      };
    }
  }

  return { success: true };
}

export async function onSocketDisconnectPipeline(
  runtime: PluginRuntimeContext,
  client: SocketClient,
): Promise<void> {
  for (const manifest of runtime.manifests) {
    const bridge = runtime.bridges.get(manifest.id);
    if (!bridge) continue;

    if (!manifest.permissions.socket?.can_intercept) continue;

    try {
      await bridge.callHook("onSocketDisconnect", client);
    } catch (error) {
      console.error(`Plugin ${manifest.id} failed onSocketDisconnect:`, error);
    }
  }
}
