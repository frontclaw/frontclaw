import type { HTTPRequestContext, HTTPResponse } from "@workspace/plugin-sdk";
import { PermissionGuard } from "../../bridge/permission-guard.js";
import type { PluginRuntimeContext } from "../runtime-context.js";

const DEFAULT_SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

function applyDefaultSecurityHeaders(response: HTTPResponse): HTTPResponse {
  const headers: Record<string, string> = { ...(response.headers || {}) };
  const existingHeaderNames = new Set(
    Object.keys(headers).map((name) => name.toLowerCase()),
  );

  for (const [name, value] of Object.entries(DEFAULT_SECURITY_HEADERS)) {
    if (!existingHeaderNames.has(name.toLowerCase())) {
      headers[name] = value;
    }
  }

  return {
    ...response,
    headers,
  };
}

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
    if (!response) return null;
    return applyDefaultSecurityHeaders(response);
  } catch (error) {
    return applyDefaultSecurityHeaders({
      status: 500,
      body: { error: (error as Error).message },
    });
  }
}
