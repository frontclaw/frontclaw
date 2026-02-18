import type { ModelMessage } from "ai";
import type { ChatMessage } from "../types.js";

/**
 * Convert core chat messages to AI SDK format
 */
export function convertMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    if (msg.role === "tool" && msg.toolCallId) {
      return {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: msg.toolCallId,
            toolName: msg.toolName || "unknown",
            output: { type: "text" as const, value: msg.content },
          },
        ],
      };
    }

    return {
      role: msg.role as "user" | "assistant" | "system",
      content: msg.content,
    };
  });
}
