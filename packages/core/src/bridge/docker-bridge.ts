/**
 * Docker Plugin Bridge
 * Runs plugins as isolated Docker containers and communicates via line-delimited RPC JSON.
 */

import type {
  LoadedPluginManifest,
  RPCMessage,
  RPCSysCallRequest,
} from "@workspace/plugin-sdk";
import {
  createErrorResponse,
  createHookRequest,
  createSuccessResponse,
} from "@workspace/plugin-sdk";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { BridgeConfig, SysCallHandler } from "./bridge-types.js";
import type { PluginBridge } from "./plugin-bridge.js";

const DEFAULT_CONFIG: BridgeConfig = {
  hookTimeout: 5000,
  sysCallTimeout: 30000,
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

function sanitizeStackForPlugin(stack?: string): string | undefined {
  if (!stack) return undefined;
  if (process.env.NODE_ENV === "production") return undefined;
  return stack
    .split("\n")
    .slice(0, 8)
    .map((line) => line.replaceAll(process.cwd(), "<redacted>"))
    .join("\n");
}

function createContainerName(pluginId: string): string {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `frontclaw-${pluginId}-${suffix}`.toLowerCase();
}

function buildDockerArgs(
  manifest: LoadedPluginManifest,
  containerName: string,
): string[] {
  const image = manifest.docker?.image ?? "oven/bun:1.3.2";
  const workdir = manifest.docker?.workdir ?? "/plugin";
  const network = manifest.docker?.network ?? "none";
  const readOnlyRootFs = manifest.docker?.readOnlyRootFs ?? true;
  const pidsLimit = manifest.docker?.pidsLimit ?? 128;
  const command = manifest.docker?.command ?? ["bun", manifest.main];

  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--interactive",
    "--network",
    network,
    "--pids-limit",
    String(pidsLimit),
    "--security-opt",
    "no-new-privileges:true",
    "--cap-drop",
    "ALL",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,size=64m",
    "--tmpfs",
    "/run:rw,nosuid,nodev,noexec,size=16m",
    "--workdir",
    workdir,
    "--mount",
    `type=bind,src=${manifest.pluginPath},dst=/plugin,readonly`,
    "--env",
    `FRONTCLAW_PLUGIN_ID=${manifest.id}`,
  ];

  if (readOnlyRootFs) {
    args.push("--read-only");
  }
  if (manifest.docker?.memoryMb) {
    args.push("--memory", `${manifest.docker.memoryMb}m`);
  }
  if (manifest.docker?.cpuLimit) {
    args.push("--cpus", manifest.docker.cpuLimit);
  }

  args.push(image, ...command);
  return args;
}

export class DockerPluginBridge implements PluginBridge {
  private process: ChildProcessWithoutNullStreams | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private exitHandled = false;
  private readonly containerName: string;

  constructor(
    public readonly manifest: LoadedPluginManifest,
    private readonly sysCallHandler: SysCallHandler,
    private readonly config: BridgeConfig = DEFAULT_CONFIG,
  ) {
    this.containerName = createContainerName(manifest.id);
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  async start(): Promise<void> {
    const startupTimeoutMs = Math.max(
      this.config.hookTimeout,
      (this.manifest.docker?.startupTimeoutSec ?? 120) * 1000,
    );

    this.process = spawn("docker", buildDockerArgs(this.manifest, this.containerName), {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "",
      },
    });

    this.process.stdout.setEncoding("utf-8");
    this.process.stderr.setEncoding("utf-8");
    this.process.stdout.on("data", this.handleStdoutChunk.bind(this));
    this.process.stderr.on("data", this.handleStderrChunk.bind(this));
    this.process.on("error", (error) => {
      if (this.exitHandled) return;
      this.exitHandled = true;
      this.failAllPending(
        new Error(
          `Docker process failed for plugin ${this.manifest.id}: ${error.message}`,
        ),
      );
      this.isReady = false;
      void this.forceRemoveContainer();
    });
    this.process.on("exit", (code, signal) => {
      if (this.exitHandled) return;
      this.exitHandled = true;
      const message = this.stderrBuffer.trim();
      this.failAllPending(
        new Error(
          `Docker plugin container exited for ${this.manifest.id} (code=${code}, signal=${signal})${message ? `: ${message}` : ""}`,
        ),
      );
      this.isReady = false;
      void this.forceRemoveContainer();
    });

    await new Promise<void>((resolve, reject) => {
      let poll: ReturnType<typeof setInterval> | null = null;
      const timeout = setTimeout(() => {
        cleanup();
        this.terminateProcess();
        void this.forceRemoveContainer();
        reject(
          new Error(
            `Sandbox ready timeout for ${this.manifest.id}. Ensure Docker is running and plugin emits SANDBOX_READY.`,
          ),
        );
      }, startupTimeoutMs);

      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        this.terminateProcess();
        void this.forceRemoveContainer();
        reject(error);
      };
      const complete = async () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        try {
          await this.initializePlugin();
          this.readyResolve();
          resolve();
        } catch (error) {
          reject(error as Error);
        }
      };

      const onError = (error: Error) => {
        fail(
          new Error(
            `Failed to start Docker container for plugin ${this.manifest.id}: ${error.message}`,
          ),
        );
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        const message = this.stderrBuffer.trim();
        fail(
          new Error(
            `Docker plugin container exited before ready for ${this.manifest.id} (code=${code}, signal=${signal})${message ? `: ${message}` : ""}`,
          ),
        );
      };
      const cleanup = () => {
        this.process?.off("error", onError);
        this.process?.off("exit", onExit);
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
      };

      this.process?.once("error", onError);
      this.process?.once("exit", onExit);

      poll = setInterval(() => {
        if (this.isReady) {
          void complete();
        }
      }, 20);
    });
  }

  private handleStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const idx = this.stdoutBuffer.indexOf("\n");
      if (idx === -1) break;
      const rawLine = this.stdoutBuffer.slice(0, idx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
      if (!rawLine) continue;
      this.handleStdoutLine(rawLine);
    }
  }

  private handleStderrChunk(chunk: string): void {
    this.stderrBuffer += chunk;
    if (this.stderrBuffer.length > 8_000) {
      this.stderrBuffer = this.stderrBuffer.slice(-8_000);
    }
  }

  private handleStdoutLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if ((parsed as any)?.type === "SANDBOX_READY") {
      this.isReady = true;
      return;
    }

    void this.handleProcessMessage(parsed as RPCMessage);
  }

  private postMessage(message: unknown): void {
    if (!this.process?.stdin.writable) {
      throw new Error(`Docker plugin process is not writable for ${this.manifest.id}`);
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async initializePlugin(): Promise<void> {
    const initMessage = {
      id: crypto.randomUUID(),
      type: "INIT",
      entryPath: this.manifest.entryPath,
      pluginPath: this.manifest.pluginPath,
      config: this.manifest.config,
      permissions: this.manifest.permissions,
      pluginId: this.manifest.id,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(initMessage.id);
        reject(
          new Error(`Plugin ${this.manifest.id} initialization timed out`),
        );
      }, this.config.hookTimeout);

      this.pendingRequests.set(initMessage.id, {
        resolve: () => resolve(),
        reject,
        timeout,
      });

      this.postMessage(initMessage);
    });
  }

  async callHook<T = unknown>(
    method: string,
    payload: unknown,
  ): Promise<T | undefined> {
    await this.readyPromise;

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

      this.postMessage(request);
    });
  }

  private async handleProcessMessage(message: RPCMessage): Promise<void> {
    if (message.type === "RESPONSE" || message.type === "ERROR") {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) return;

      this.pendingRequests.delete(message.id);
      clearTimeout(pending.timeout);

      if (message.type === "ERROR") {
        const error = new Error(message.error.message);
        (error as any).code = message.error.code;
        pending.reject(error);
        return;
      }

      pending.resolve(message.result);
      return;
    }

    if (message.type === "SYS_CALL") {
      await this.handleSysCall(message as RPCSysCallRequest);
    }
  }

  private async handleSysCall(request: RPCSysCallRequest): Promise<void> {
    try {
      const result = await this.sysCallHandler(
        request.method,
        request.payload,
        this.manifest,
      );
      this.postMessage(createSuccessResponse(request.id, result));
    } catch (error) {
      const err = error as Error;
      this.postMessage(
        createErrorResponse(
          request.id,
          (err as any).code || "SYS_CALL_ERROR",
          err.message,
          sanitizeStackForPlugin(err.stack),
        ),
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    try {
      await this.callHook("onUnload", undefined);
    } catch {
      // Ignore unload failures.
    }
    this.terminateProcess();
    await this.forceRemoveContainer();
  }

  get ready(): boolean {
    return this.isReady;
  }

  private terminateProcess(): void {
    if (!this.process) return;
    this.process.kill("SIGTERM");
    const processRef = this.process;
    setTimeout(() => {
      if (!processRef.killed) {
        processRef.kill("SIGKILL");
      }
    }, 2000);
    this.process = null;
    this.isReady = false;
  }

  private forceRemoveContainer(): Promise<void> {
    return new Promise((resolve) => {
      const rm = spawn("docker", ["rm", "-f", this.containerName], {
        stdio: ["ignore", "ignore", "ignore"],
        env: { PATH: process.env.PATH ?? "" },
      });

      const done = () => resolve();
      rm.once("error", done);
      rm.once("close", done);
    });
  }

  private failAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }
}
