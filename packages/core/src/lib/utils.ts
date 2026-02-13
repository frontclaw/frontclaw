import { type FrontClawSchema } from "@workspace/schema";
import os from "node:os";
import path from "node:path";

/**
 * Get configs from file
 * @param path configs file path
 * @returns configs object
 */
export const getConfigs = async (path: string) => {
  return (await Bun.file(path).json()) as FrontClawSchema;
};

/**
 * Write configs to file
 * @param path configs file path
 * @param configs configs object
 * @returns promise<number> bytes written
 */
export const writeConfigs = async (path: string, configs: FrontClawSchema) => {
  return await Bun.write(path, JSON.stringify(configs, null, 2), {
    mode: 0o644,
  });
};

export const getConfigPath = () => {
  return (
    process.env.CONFIG_PATH ??
    process.env.FRONTCLAW_CONFIG_PATH ??
    path.join(os.homedir(), ".frontclaw", "config.json")
  );
};
