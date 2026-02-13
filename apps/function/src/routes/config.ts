import { getConfigPath, getConfigs, writeConfigs } from "@workspace/core";
import { FrontClawSchemaSchema } from "@workspace/schema";
import type { Hono } from "hono";
import { ZodError } from "zod";

export function registerConfigRoutes(app: Hono) {
  app.post("/api/v1/config", async (c) => {
    try {
      const body = await c.req.json();
      const configs = await FrontClawSchemaSchema.parseAsync(body);

      const configPath = getConfigPath();

      if (!configPath) {
        return c.json(
          {
            success: false,
            message:
              "Config path not found, please set CONFIG_PATH or FRONTCLAW_CONFIG_PATH environment variable",
          },
          { status: 500 },
        );
      }

      await writeConfigs(configPath, configs);

      return c.json({
        success: true,
        message: "Project configured successfully!",
      });
    } catch (error) {
      console.error(error);

      if (error instanceof SyntaxError) {
        return c.json(
          {
            success: false,
            message: "Invalid JSON provided",
          },
          { status: 400 },
        );
      }

      if (error instanceof ZodError) {
        return c.json(
          {
            success: false,
            message: "Invalid payload provided",
            errors: error.issues,
          },
          { status: 400 },
        );
      }

      return c.json(
        {
          success: false,
          message: "Failed to configure project!",
        },
        { status: 500 },
      );
    }
  });

  app.get("/api/v1/config", async (c) => {
    const configPath = getConfigPath();

    if (!configPath) {
      return c.json(
        {
          success: false,
          message:
            "Config path not found, please set CONFIG_PATH or FRONTCLAW_CONFIG_PATH environment variable",
        },
        { status: 500 },
      );
    }

    const configs = await getConfigs(configPath);

    return c.json({
      success: true,
      message: "Project fetched successfully!",
      configs,
    });
  });
}
