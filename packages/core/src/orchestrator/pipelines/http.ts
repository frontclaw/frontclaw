import type { HTTPRequestContext, HTTPResponse } from "@workspace/plugin-sdk";
import { PermissionGuard } from "../../bridge/permission-guard.js";
import type { PluginRuntimeContext } from "../runtime-context.js";

export async function routeHTTPRequestPipeline(
  runtime: PluginRuntimeContext,
  pluginId: string,
  request: HTTPRequestContext,
): Promise<HTTPResponse | null> {
  const manifest = runtime.manifests.find((m) => m.id === pluginId);
  if (!manifest) return null;

  const bridge = runtime.bridges.get(pluginId);
  if (!bridge) return null;

  const apiPerm = manifest.permissions.api;
  if (!apiPerm) return null;

  try {
    const guard = new PermissionGuard(manifest);
    guard.checkAPIRoute(request.path, request.method);
  } catch {
    return null;
  }

  try {
    const response = await bridge.callHook<HTTPResponse>("onHTTPRequest", request);
    return response || null;
  } catch (error) {
    return {
      status: 500,
      body: { error: (error as Error).message },
    };
  }
}
