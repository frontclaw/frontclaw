type SessionFrame = {
  id: number;
  event: string;
  payload: unknown;
};

type SessionState = {
  id: string;
  createdAt: number;
  frames: SessionFrame[];
  nextFrameId: number;
  done: boolean;
  listeners: Set<(frame: SessionFrame) => void>;
  closeListeners: Set<() => void>;
  gcTimer?: ReturnType<typeof setTimeout>;
};

const SESSION_TTL_MS = 10 * 60_000;
const MAX_FRAMES = 5000;
const sessions = new Map<string, SessionState>();

function toSSEFrame(frame: SessionFrame): string {
  return `id: ${frame.id}\nevent: ${frame.event}\ndata: ${JSON.stringify(frame.payload)}\n\n`;
}

function scheduleGc(session: SessionState): void {
  if (session.gcTimer) {
    clearTimeout(session.gcTimer);
  }
  session.gcTimer = setTimeout(() => {
    sessions.delete(session.id);
  }, SESSION_TTL_MS);
}

function getSessionOrThrow(sessionId: string): SessionState {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("Stream session not found");
  }
  return session;
}

export function createSSESession(): string {
  const id = crypto.randomUUID();
  const state: SessionState = {
    id,
    createdAt: Date.now(),
    frames: [],
    nextFrameId: 1,
    done: false,
    listeners: new Set(),
    closeListeners: new Set(),
  };
  sessions.set(id, state);
  return id;
}

export function appendSSESessionEvent(
  sessionId: string,
  event: string,
  payload: unknown,
): number {
  const session = getSessionOrThrow(sessionId);
  if (session.done) return session.nextFrameId - 1;

  const frame: SessionFrame = {
    id: session.nextFrameId++,
    event,
    payload,
  };
  session.frames.push(frame);
  if (session.frames.length > MAX_FRAMES) {
    session.frames.splice(0, session.frames.length - MAX_FRAMES);
  }

  for (const listener of session.listeners) {
    try {
      listener(frame);
    } catch {
      // Ignore listener failures.
    }
  }
  return frame.id;
}

export function closeSSESession(sessionId: string): void {
  const session = getSessionOrThrow(sessionId);
  if (session.done) return;
  session.done = true;
  for (const listener of session.closeListeners) {
    try {
      listener();
    } catch {
      // Ignore listener failures.
    }
  }
  scheduleGc(session);
}

export function hasSSESession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function createSSESessionReadable(
  sessionId: string,
  fromCursor = 0,
): ReadableStream<Uint8Array> {
  const session = getSessionOrThrow(sessionId);
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Ignore already closed stream.
        }
      };

      const sendFrame = (frame: SessionFrame) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(toSSEFrame(frame)));
        } catch {
          safeClose();
        }
      };

      for (const frame of session.frames) {
        if (frame.id > fromCursor) {
          sendFrame(frame);
        }
      }

      if (session.done) {
        safeClose();
        return;
      }

      const onFrame = (frame: SessionFrame) => {
        sendFrame(frame);
      };
      const onClose = () => {
        safeClose();
      };

      session.listeners.add(onFrame);
      session.closeListeners.add(onClose);

      return () => {
        session.listeners.delete(onFrame);
        session.closeListeners.delete(onClose);
      };
    },
  });
}
