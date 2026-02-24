import fs from "node:fs";
import path from "node:path";

export type PluginCatalogEntry = {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  priority?: number;
  runtime?: string;
  permissions?: unknown;
  tags?: string[];
  manifest?: Record<string, unknown>;
  enabled: boolean;
  active: boolean;
};

function pluginDirs(pluginsDir: string): string[] {
  if (!fs.existsSync(pluginsDir)) return [];
  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginsDir, entry.name));
}

export function readPluginCatalog(pluginsDir: string): PluginCatalogEntry[] {
  const plugins: PluginCatalogEntry[] = [];

  for (const pluginDir of pluginDirs(pluginsDir)) {
    const fallbackId = path.basename(pluginDir);
    const manifestPath = path.join(pluginDir, "frontclaw.json");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as Record<string, unknown>;
      const id =
        typeof manifest.id === "string" && manifest.id.trim()
          ? manifest.id
          : fallbackId;
      const enabled = manifest.enabled !== false;

      plugins.push({
        id,
        name: typeof manifest.name === "string" ? manifest.name : undefined,
        version:
          typeof manifest.version === "string" ? manifest.version : undefined,
        description:
          typeof manifest.description === "string"
            ? manifest.description
            : undefined,
        priority:
          typeof manifest.priority === "number" ? manifest.priority : undefined,
        runtime:
          typeof manifest.runtime === "string" ? manifest.runtime : undefined,
        permissions: manifest.permissions,
        tags: Array.isArray(manifest.tags)
          ? manifest.tags.filter((tag) => typeof tag === "string")
          : undefined,
        manifest,
        enabled,
        active: false,
      });
    } catch {
      // Ignore malformed plugin manifests in catalog listing.
    }
  }

  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return plugins;
}

export function setPluginEnabled(
  pluginsDir: string,
  pluginId: string,
  enabled: boolean,
): void {
  for (const pluginDir of pluginDirs(pluginsDir)) {
    const manifestPath = path.join(pluginDir, "frontclaw.json");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as Record<string, unknown>;
      if (manifest.id !== pluginId) continue;

      manifest.enabled = enabled;
      fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf-8",
      );
      return;
    } catch {
      // Skip malformed manifest and keep scanning.
    }
  }

  throw new Error("Plugin not found");
}
