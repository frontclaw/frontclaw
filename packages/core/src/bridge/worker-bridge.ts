/**
 * Plugin Worker Bridge
 * Manages communication between Core and Plugin Workers via RPC
 */

import type {
  RPCMessage,
  RPCResponse,
  RPCHookRequest,
  RPCSysCallRequest,
  LoadedPluginManifest,
  Permissions,
} from "@workspace/plugin-sdk";
import {
  createHookRequest,
  createSuccessResponse,
  createErrorResponse,
} from "@workspace/plugin-sdk";
import path from "node:path";

/** Bridge configuration */
export interface BridgeConfig {
  /** Hook timeout in milliseconds */
  hookTimeout: number;
  /** System call timeout in milliseconds */
  sysCallTimeout: number;
}

const DEFAULT_CONFIG: BridgeConfig = {
  hookTimeout: 5000,
  sysCallTimeout: 30000,
};

/** System call handler function */
export type SysCallHandler = (
  method: string,
  payload: unknown,
  manifest: LoadedPluginManifest,
) => Promise<unknown>;

/**
 * PluginWorkerBridge
 * Manages a single plugin worker and its RPC communication
 */
export class PluginWorkerBridge {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: Timer;
    }
  >();
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;

  constructor(
    public readonly manifest: LoadedPluginManifest,
    private readonly sysCallHandler: SysCallHandler,
    private readonly config: BridgeConfig = DEFAULT_CONFIG,
  ) {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  /**
   * Start the worker and initialize the plugin
   */
  async start(): Promise<void> {
    // Get the sandbox runtime path (monorepo workspace path)
    const sandboxPath = path.resolve(
      import.meta.dirname,
      "../../../plugin-sdk/src/runtime/sandbox.ts",
    );

    // Create the worker
    this.worker = new Worker(sandboxPath, {
      type: "module",
    });

    // Set up message handler
    this.worker.onmessage = this.handleWorkerMessage.bind(this);

    // Wait for sandbox to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Sandbox ready timeout for ${this.manifest.id}`));
      }, this.config.hookTimeout);

      const handler = (event: MessageEvent) => {
        if (event.data?.type === "SANDBOX_READY") {
          clearTimeout(timeout);
          resolve();
        }
      };

      const errorHandler = (event: Event) => {
        clearTimeout(timeout);
        const message =
          event instanceof ErrorEvent
            ? event.message
            : "unknown error";
        reject(
          new Error(
            `Sandbox error for ${this.manifest.id}: ${message}`,
          ),
        );
      };

      this.worker!.addEventListener("message", handler, { once: true });
      this.worker!.addEventListener("error", errorHandler, { once: true });
      this.worker!.addEventListener("messageerror", errorHandler, { once: true });
    });

    // Initialize the plugin
    await this.initializePlugin();
    this.isReady = true;
    this.readyResolve();
  }

  /**
   * Initialize the plugin in the worker
   */
  private async initializePlugin(): Promise<void> {
    const initMessage = {
      id: crypto.randomUUID(),
      type: "INIT",
      entryPath: this.manifest.entryPath,
      config: this.manifest.config,
      permissions: this.manifest.permissions,
      pluginId: this.manifest.id,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.worker?.removeEventListener("message", handler);
        reject(
          new Error(`Plugin ${this.manifest.id} initialization timed out`),
        );
      }, this.config.hookTimeout);

      const handler = (event: MessageEvent<RPCResponse>) => {
        if (event.data?.id !== initMessage.id) return;
        clearTimeout(timeout);
        this.worker?.removeEventListener("message", handler);
        if (event.data.success) {
          resolve();
        } else {
          reject(
            new Error(`Plugin init failed: ${event.data.error?.message}`),
          );
        }
      };

      this.worker!.addEventListener("message", handler);
      this.worker!.postMessage(initMessage);
    });
  }

  /**
   * Call a hook on the plugin
   */
  async callHook<T = unknown>(
    method: string,
    payload: unknown,
  ): Promise<T | undefined> {
    await this.readyPromise;

    if (!this.worker) {
      throw new Error(`Plugin ${this.manifest.id} worker not started`);
    }

    const request = createHookRequest(method, payload);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(
          new Error(`Plugin ${this.manifest.id} timed out on hook ${method}`),
        );
      }, this.config.hookTimeout);

      this.pendingRequests.set(request.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      this.worker!.postMessage(request);
    });
  }

  /**
   * Handle messages from the worker
   */
  private async handleWorkerMessage(event: MessageEvent<RPCMessage>) {
    const msg = event.data;

    // Handle responses to our hook calls
    if (msg.type === "RESPONSE" || msg.type === "ERROR") {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        clearTimeout(pending.timeout);

        if (msg.type === "ERROR") {
          const error = new Error(msg.error.message);
          (error as any).code = msg.error.code;
          pending.reject(error);
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Handle system calls from the plugin
    if (msg.type === "SYS_CALL") {
      await this.handleSysCall(msg as RPCSysCallRequest);
      return;
    }
  }

  /**
   * Handle a system call from the plugin
   */
  private async handleSysCall(request: RPCSysCallRequest): Promise<void> {
    try {
      const result = await this.sysCallHandler(
        request.method,
        request.payload,
        this.manifest,
      );
      this.worker!.postMessage(createSuccessResponse(request.id, result));
    } catch (error) {
      const err = error as Error;
      this.worker!.postMessage(
        createErrorResponse(
          request.id,
          (err as any).code || "SYS_CALL_ERROR",
          err.message,
          err.stack,
        ),
      );
    }
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    if (!this.worker) return;

    // Call onUnload hook
    try {
      await this.callHook("onUnload", undefined);
    } catch {
      // Ignore unload errors
    }

    // Clear pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Worker stopped"));
    }
    this.pendingRequests.clear();

    // Terminate worker
    this.worker.terminate();
    this.worker = null;
    this.isReady = false;
  }

  /**
   * Check if the worker is ready
   */
  get ready(): boolean {
    return this.isReady;
  }
}
