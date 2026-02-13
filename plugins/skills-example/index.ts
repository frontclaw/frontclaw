import { definePlugin, type SkillDefinition, type SkillResult } from "@workspace/plugin-sdk";

const skills: SkillDefinition[] = [
  {
    name: "echo",
    description: "Echo the input payload back to the caller",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to echo",
        },
      },
      required: ["text"],
    },
    outputSchema: {
      type: "string",
      description: "Echoed text",
    },
    tags: ["utility"],
  },
];

export default definePlugin({
  async getSkills() {
    return skills;
  },

  async executeSkill(_ctx, skillName, args): Promise<SkillResult> {
    if (skillName !== "echo") {
      return { success: false, error: "Unknown skill" };
    }

    const text = typeof args.text === "string" ? args.text : undefined;
    if (!text) {
      return { success: false, error: "Missing required argument: text" };
    }

    return { success: true, result: text };
  },
});
