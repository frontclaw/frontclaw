import type { CoreMessage } from "ai";
import type { ChatMessage } from "../types.js";

/**
 * Convert core chat messages to AI SDK format
 */
export function convertMessages(messages: ChatMessage[]): CoreMessage[] {
  return messages.map((msg) => {
    if (msg.role === "tool" && msg.toolCallId) {
      return {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: msg.toolCallId,
            toolName: msg.toolName || "unknown",
            result: msg.content,
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
