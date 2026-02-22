import { definePlugin, serveDockerPlugin } from "@workspace/plugin-sdk";

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
      return { success: false, error: `Unknown tool: ${toolName}` };
    }
    return {
      success: true,
      result: { echoed: String(args.text ?? "") },
    };
  },
});

serveDockerPlugin(plugin);
