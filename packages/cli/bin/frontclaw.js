#!/usr/bin/env bun
/* eslint-env node */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const HELP_TEXT = `
Frontclaw CLI

Usage:
  frontclaw new plugin --name <name> [options]

Options:
  --name <name>             Plugin display name (required)
  --id <id>                 Plugin id (kebab-case). Defaults from --name
  --path <path>             Base plugins directory. Defaults to ~/.frontclaw/plugins
  --description <text>      Plugin description
  --author <name>           Author name. Defaults to "Frontclaw Team"
  --runtime <runtime>       Runtime (only: docker)
  --enable                  Set enabled=true in frontclaw.json
  --force                   Overwrite existing directory
  -h, --help                Show help
`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const positionals = [];
  const flags = new Map();

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    if (token === "-h" || token === "--help") {
      flags.set("help", "true");
      continue;
    }

    if (token === "--enable" || token === "--force") {
      flags.set(token.slice(2), "true");
      continue;
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unknown flag: ${token}`);
    }

    const key = token.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("-")) {
      throw new Error(`Missing value for flag: ${token}`);
    }
    flags.set(key, next);
    i += 1;
  }

  return { positionals, flags };
}

function toKebabCase(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function assertValidPluginId(id) {
  const valid = /^[a-z][a-z0-9-]*$/.test(id);
  if (!valid) {
    throw new Error(
      `Invalid plugin id '${id}'. Use kebab-case starting with a letter.`,
    );
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveBasePath(rawPath) {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const defaultPath = homeDir
    ? path.join(homeDir, ".frontclaw", "plugins")
    : path.resolve(".frontclaw/plugins");

  if (!rawPath) return defaultPath;
  if (rawPath === ".") return process.cwd();

  if (rawPath.startsWith("~/")) {
    if (!homeDir) {
      throw new Error("Cannot expand '~' because HOME is not set.");
    }
    return path.join(homeDir, rawPath.slice(2));
  }

  return path.resolve(rawPath);
}

function writeFileSafe(filePath, content, force) {
  if (!force && fs.existsSync(filePath)) {
    throw new Error(`File already exists: ${filePath}`);
  }
  fs.writeFileSync(filePath, content, "utf-8");
}

function createPluginScaffold(options) {
  const runtime = options.runtime || "docker";
  if (runtime !== "docker") {
    throw new Error(`Unsupported runtime '${runtime}'. Only 'docker' is allowed.`);
  }

  const pluginName = options.name.trim();
  if (!pluginName) throw new Error("Plugin name is required.");

  const pluginId = options.id ? options.id.trim() : toKebabCase(pluginName);
  assertValidPluginId(pluginId);

  const basePath = resolveBasePath(options.basePath);
  const pluginDir = path.join(basePath, pluginId);
  const force = options.force === true;

  if (fs.existsSync(pluginDir) && !force) {
    throw new Error(
      `Plugin directory already exists: ${pluginDir}. Re-run with --force to overwrite.`,
    );
  }

  ensureDir(pluginDir);
  ensureDir(path.join(pluginDir, "src"));

  const manifest = {
    id: pluginId,
    name: pluginName,
    version: "1.0.0",
    description:
      options.description || `A Frontclaw plugin scaffold for ${pluginName}`,
    author: {
      name: options.author || "Frontclaw Team",
    },
    priority: 100,
    runtime: "docker",
    docker: {
      image: "oven/bun:1.3.2",
      command: ["bun", "src/plugin.ts"],
      workdir: "/plugin",
      network: "none",
      readOnlyRootFs: true,
      pidsLimit: 128,
      memoryMb: 256,
      startupTimeoutSec: 120,
    },
    permissions: {
      log: {
        enabled: true,
        levels: ["info", "warn", "error"],
      },
    },
    main: "src/plugin.ts",
    tags: ["scaffold"],
    enabled: options.enable === true,
  };

  const readme = `# ${pluginName}

Scaffolded by \`frontclaw new plugin\`.

## Runtime

- runtime: \`docker\`
- entrypoint: \`src/plugin.ts\`

## Next steps

1. Implement your plugin hooks in \`src/plugin.ts\`.
2. Ensure Docker is running.
3. Restart Frontclaw to load the plugin container.
3. Set \`enabled\` to \`true\` in \`frontclaw.json\` when ready.
`;

  const gitignore = `
*.tmp
build/
target/
dist/
`.trimStart();

  const stubSource = `import { definePlugin, serveDockerPlugin } from "@workspace/plugin-sdk";

const plugin = definePlugin({
  async getTools() {
    return [
      {
        name: "echo",
        description: "Echo input text",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Input text" },
          },
          required: ["text"],
        },
      },
    ];
  },

  async executeTool(_ctx, toolName, args) {
    if (toolName !== "echo") {
      return { success: false, error: \`Unknown tool: \${toolName}\` };
    }
    return {
      success: true,
      result: { echoed: String(args.text ?? "") },
    };
  },
});

serveDockerPlugin(plugin);
`;

  const packageJson = {
    name: `@frontclaw/plugin-${pluginId}`,
    version: "0.0.1",
    private: true,
    type: "module",
    dependencies: {
      "@workspace/plugin-sdk": "workspace:*",
    },
    scripts: {
      dev: "bun src/plugin.ts",
      start: "bun src/plugin.ts",
    },
  };

  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      lib: ["ES2022"],
      strict: true,
      skipLibCheck: true,
      types: ["bun"],
      noEmit: true,
    },
    include: ["src/**/*.ts"],
  };

  writeFileSafe(
    path.join(pluginDir, "frontclaw.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    force,
  );
  writeFileSafe(path.join(pluginDir, "README.md"), readme, force);
  writeFileSafe(
    path.join(pluginDir, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    force,
  );
  writeFileSafe(
    path.join(pluginDir, "tsconfig.json"),
    `${JSON.stringify(tsconfig, null, 2)}\n`,
    force,
  );
  writeFileSafe(path.join(pluginDir, ".gitignore"), gitignore, force);
  writeFileSafe(path.join(pluginDir, "src", "plugin.ts"), stubSource, force);

  return { pluginId, pluginDir, enabled: manifest.enabled };
}

function main() {
  try {
    const { positionals, flags } = parseArgs(process.argv);
    if (flags.has("help") || positionals.length === 0) {
      process.stdout.write(HELP_TEXT);
      process.exit(0);
    }

    if (
      positionals.length >= 2 &&
      positionals[0] === "new" &&
      positionals[1] === "plugin"
    ) {
      const name = flags.get("name");
      if (!name) {
        throw new Error("Missing required flag: --name");
      }

      const result = createPluginScaffold({
        name,
        id: flags.get("id"),
        basePath: flags.get("path"),
        description: flags.get("description"),
        author: flags.get("author"),
        runtime: flags.get("runtime"),
        enable: flags.get("enable") === "true",
        force: flags.get("force") === "true",
      });

      process.stdout.write(
        `Created plugin scaffold '${result.pluginId}' at ${result.pluginDir}\n`,
      );
      if (!result.enabled) {
        process.stdout.write(
          "Plugin is scaffolded with enabled=false. Implement src/plugin.ts and enable it when ready.\n",
        );
      }
      process.exit(0);
    }

    throw new Error(`Unknown command: ${positionals.join(" ")}`);
  } catch (error) {
    process.stderr.write(`${(error).message}\n\n`);
    process.stderr.write(HELP_TEXT);
    process.exit(1);
  }
}

main();
