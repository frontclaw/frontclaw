/**
 * Plugin Loader
 * Discovers, validates, and loads plugins from the filesystem
 */

import type {
  PluginManifest,
  LoadedPluginManifest,
} from "@workspace/plugin-sdk";
import { PluginManifestSchema } from "@workspace/plugin-sdk";
import path from "node:path";
import fs from "node:fs";

/** Plugin loading error */
export class PluginLoadError extends Error {
  constructor(
    public readonly pluginPath: string,
    message: string,
  ) {
    super(`Failed to load plugin at '${pluginPath}': ${message}`);
    this.name = "PluginLoadError";
  }
}

/** Loader configuration */
export interface LoaderConfig {
  /** Directory containing plugins */
  pluginsDir: string;
  /** User configuration overrides per plugin */
  pluginConfigs?: Record<string, Record<string, unknown>>;
  /** Plugins to explicitly disable */
  disabledPlugins?: string[];
}

/**
 * PluginLoader
 * Handles plugin discovery and manifest validation
 */
export class PluginLoader {
  constructor(private readonly config: LoaderConfig) {}

  /**
   * Discover and load all plugins from the plugins directory
   */
  async loadAll(): Promise<LoadedPluginManifest[]> {
    const pluginsDir = this.config.pluginsDir;

    // Ensure plugins directory exists
    if (!fs.existsSync(pluginsDir)) {
      console.warn(`Plugins directory not found: ${pluginsDir}`);
      return [];
    }

    // Get all subdirectories
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    const pluginDirs = entries.filter((e) => e.isDirectory());

    const loadedPlugins: LoadedPluginManifest[] = [];

    for (const dir of pluginDirs) {
      const pluginPath = path.join(pluginsDir, dir.name);

      try {
        const manifest = await this.loadPlugin(pluginPath);

        // Check if explicitly disabled
        if (this.config.disabledPlugins?.includes(manifest.id)) {
          console.log(`Plugin '${manifest.id}' is disabled, skipping`);
          continue;
        }

        // Check if enabled in manifest
        if (!manifest.enabled) {
          console.log(
            `Plugin '${manifest.id}' is disabled in manifest, skipping`,
          );
          continue;
        }

        loadedPlugins.push(manifest);
      } catch (error) {
        if (error instanceof PluginLoadError) {
          console.error(error.message);
        } else {
          console.error(`Error loading plugin at ${pluginPath}:`, error);
        }
      }
    }

    // Sort by priority (lower = earlier)
    loadedPlugins.sort((a, b) => a.priority - b.priority);

    return loadedPlugins;
  }

  /**
   * Load a single plugin from a directory
   */
  async loadPlugin(pluginPath: string): Promise<LoadedPluginManifest> {
    const manifestPath = path.join(pluginPath, "frontclaw.json");
    const readmePath = path.join(pluginPath, "README.md");

    // Check if manifest exists
    if (!fs.existsSync(manifestPath)) {
      throw new PluginLoadError(pluginPath, "frontclaw.json not found");
    }
    if (!fs.existsSync(readmePath)) {
      throw new PluginLoadError(pluginPath, "README.md not found");
    }

    // Read and parse manifest
    let rawManifest: unknown;
    try {
      const content = fs.readFileSync(manifestPath, "utf-8");
      rawManifest = JSON.parse(content);
    } catch (error) {
      throw new PluginLoadError(
        pluginPath,
        `Invalid JSON in frontclaw.json: ${(error as Error).message}`,
      );
    }

    // Validate manifest schema
    const parseResult = PluginManifestSchema.safeParse(rawManifest);
    if (!parseResult.success) {
      const errors = parseResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      throw new PluginLoadError(pluginPath, `Invalid manifest: ${errors}`);
    }

    const manifest = parseResult.data;

    // Resolve entry path
    const entryPath = path.join(pluginPath, manifest.main);
    if (!fs.existsSync(entryPath)) {
      throw new PluginLoadError(
        pluginPath,
        `Entry file not found: ${manifest.main}`,
      );
    }

    // Merge configuration
    const userConfig = this.config.pluginConfigs?.[manifest.id] || {};
    const mergedConfig = {
      ...manifest.defaultConfig,
      ...userConfig,
    };

    return {
      ...manifest,
      pluginPath,
      entryPath,
      config: mergedConfig,
    };
  }

  /**
   * Validate a manifest without loading the plugin
   */
  validateManifest(manifest: unknown): manifest is PluginManifest {
    return PluginManifestSchema.safeParse(manifest).success;
  }
}
