import {
  appendSSESessionEvent,
  closeSSESession,
  createSSESession,
  createSSESessionReadable,
  hasSSESession,
} from "@workspace/core";

export function createChatStreamSession(): string {
  return createSSESession();
}

export function appendChatStreamEvent(
  sessionId: string,
  event: string,
  payload: unknown,
): number {
  return appendSSESessionEvent(sessionId, event, payload);
}

export function closeChatStreamSession(sessionId: string): void {
  closeSSESession(sessionId);
}

export function hasChatStreamSession(sessionId: string): boolean {
  return hasSSESession(sessionId);
}

export function createChatStreamSSE(
  sessionId: string,
  fromCursor = 0,
): ReadableStream<Uint8Array> {
  return createSSESessionReadable(sessionId, fromCursor);
}
