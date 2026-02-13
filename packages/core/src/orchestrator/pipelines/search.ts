import type { SearchOptions } from "@workspace/plugin-sdk";
import type { PluginRuntimeContext } from "../runtime-context.js";

export async function searchPipeline(
  runtime: PluginRuntimeContext,
  options: SearchOptions,
): Promise<unknown[]> {
  for (const manifest of runtime.manifests) {
    const bridge = runtime.bridges.get(manifest.id);
    if (!bridge) continue;

    try {
      const result = await bridge.callHook<unknown[]>("onSearch", options);
      if (Array.isArray(result) && result.length > 0) {
        return result;
      }
    } catch (error) {
      console.error(`Plugin ${manifest.id} failed search:`, error);
    }
  }

  return [];
}
