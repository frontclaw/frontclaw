import type { SkillDefinition, SkillResult } from "@workspace/plugin-sdk";
import { PermissionGuard } from "../../bridge/permission-guard.js";
import type { PluginRuntimeContext } from "../runtime-context.js";
import { parseNamespacedName } from "./namespaced.js";

export async function collectSkillsPipeline(
  runtime: PluginRuntimeContext,
): Promise<SkillDefinition[]> {
  const skills: SkillDefinition[] = [];

  for (const manifest of runtime.manifests) {
    const bridge = runtime.bridges.get(manifest.id);
    if (!bridge) continue;

    try {
      const guard = new PermissionGuard(manifest);
      const pluginSkills = await bridge.callHook<SkillDefinition[]>(
        "getSkills",
        undefined,
      );
      if (Array.isArray(pluginSkills)) {
        for (const skill of pluginSkills) {
          guard.checkSkillAccess(skill.name);
          skills.push({
            ...skill,
            name: `${manifest.id}__${skill.name}`,
          });
        }
      }
    } catch (error) {
      console.error(`Plugin ${manifest.id} failed getSkills:`, error);
    }
  }

  return skills;
}

export async function executeSkillPipeline(
  runtime: PluginRuntimeContext,
  skillName: string,
  args: Record<string, unknown>,
): Promise<SkillResult> {
  const parsed = parseNamespacedName(skillName);
  if (!parsed) {
    return {
      success: false,
      error: `Invalid skill name: ${skillName}`,
    };
  }

  const bridge = runtime.bridges.get(parsed.pluginId);
  if (!bridge) {
    return {
      success: false,
      error: `Plugin ${parsed.pluginId} not found`,
    };
  }

  const manifest = runtime.manifests.find((m) => m.id === parsed.pluginId);
  if (!manifest) {
    return {
      success: false,
      error: `Plugin ${parsed.pluginId} not found`,
    };
  }

  try {
    const guard = new PermissionGuard(manifest);
    guard.checkSkillAccess(parsed.localName);
    const result = await bridge.callHook<SkillResult>("executeSkill", {
      skillName: parsed.localName,
      args,
    });
    return result || {
      success: false,
      error: "Skill returned no result",
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}
