"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  fetchConfig,
  fetchPlugins,
  saveConfig,
  setPluginEnabled,
  type FrontclawConfig,
  type PluginInfo,
} from "@/lib/frontclaw-api";

const providers = ["openai", "anthropic", "google"];

const defaultConfig: FrontclawConfig = {
  version: "1.0.0",
  project: {
    name: "FrontClaw Project",
    environment: "development",
  },
  ai_models: {
    chat: {
      provider: "openai",
      model: "gpt-4o-mini",
      system_prompt: "You are a helpful assistant.",
      api_key: "",
      base_url: "",
    },
    embeddings: {
      provider: "openai",
      model: "text-embedding-3-small",
      api_key: "",
      base_url: "",
    },
  },
  database: {},
  embedded_box: {},
  features: {},
  webhooks: {},
};

function normalizeConfig(config: FrontclawConfig): FrontclawConfig {
  return {
    ...defaultConfig,
    ...config,
    project: {
      ...defaultConfig.project,
      ...(config.project || {}),
    },
    ai_models: {
      ...defaultConfig.ai_models,
      ...(config.ai_models || {}),
      chat: {
        ...defaultConfig.ai_models?.chat,
        ...(config.ai_models?.chat || {}),
      },
      embeddings: {
        ...defaultConfig.ai_models?.embeddings,
        ...(config.ai_models?.embeddings || {}),
      },
    },
  };
}

export function SettingsPanel() {
  const [config, setConfig] = useState<FrontclawConfig>(defaultConfig);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingPluginId, setUpdatingPluginId] = useState<string | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginInfo | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [loaded, pluginList] = await Promise.all([
          fetchConfig(),
          fetchPlugins(),
        ]);
        setConfig(normalizeConfig(loaded));
        setPlugins(pluginList);
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const chat = useMemo(() => config.ai_models?.chat || {}, [config]);
  const embeddings = useMemo(() => config.ai_models?.embeddings || {}, [config]);

  const setChatField = (key: string, value: string) => {
    setConfig((current) =>
      normalizeConfig({
        ...current,
        ai_models: {
          ...current.ai_models,
          chat: {
            ...current.ai_models?.chat,
            [key]: value,
          },
        },
      }),
    );
  };

  const setEmbeddingField = (key: string, value: string) => {
    setConfig((current) =>
      normalizeConfig({
        ...current,
        ai_models: {
          ...current.ai_models,
          embeddings: {
            ...current.ai_models?.embeddings,
            [key]: value,
          },
        },
      }),
    );
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      await saveConfig(config);
      setStatus("Settings saved to frontclaw.json");
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onTogglePlugin = async (plugin: PluginInfo) => {
    const nextEnabled = !plugin.enabled;
    setUpdatingPluginId(plugin.id);
    setError(null);
    setStatus(null);

    try {
      const updated = await setPluginEnabled(plugin.id, nextEnabled);
      setPlugins((current) =>
        current.map((item) =>
          item.id === updated.id
            ? { ...item, enabled: updated.enabled, active: updated.active }
            : item,
        ),
      );
      setStatus(
        `Plugin '${plugin.name || plugin.id}' ${nextEnabled ? "enabled" : "disabled"} and refreshed`,
      );
    } catch (toggleError) {
      setError((toggleError as Error).message);
    } finally {
      setUpdatingPluginId(null);
    }
  };

  return (
    <section className="grid h-screen gap-6 p-4 md:p-6 overflow-auto">
      <div className="card-elevated rounded-2xl p-5 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--frontui-muted)]">
              AI Setup
            </p>
            <h2 className="text-2xl font-semibold text-[var(--frontui-ink)]">
              Model Configuration
            </h2>
            <p className="mt-1 text-sm text-[var(--frontui-muted)]">
              Manage providers, model IDs, base URLs, and keys used by Frontclaw.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--frontui-accent)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Save size={16} />
            )}
            Save
          </button>
        </div>

        {status ? (
          <p className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#bbdfc7] bg-[#edf9f1] px-3 py-1.5 text-sm text-[#23693d]">
            <CheckCircle2 size={14} /> {status}
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-lg border border-[#e8c7bd] bg-[#fff2ed] px-3 py-2 text-sm text-[#8c3e21]">
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="card-elevated flex min-h-52 items-center justify-center rounded-2xl text-[var(--frontui-muted)]">
          <Loader2 className="mr-2 animate-spin" size={17} /> Loading configuration...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card-elevated rounded-2xl p-5 md:p-6">
            <h3 className="mb-1 text-lg font-semibold text-[var(--frontui-ink)]">
              Chat Model
            </h3>
            <p className="mb-4 text-sm text-[var(--frontui-muted)]">
              Used for `/api/v1/chat` responses and streaming output.
            </p>

            <div className="grid gap-4">
              <Field label="Provider">
                <select
                  value={chat.provider || ""}
                  onChange={(event) => setChatField("provider", event.target.value)}
                  className="w-full rounded-xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-2 text-sm"
                >
                  <option value="">Select provider</option>
                  {providers.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Model">
                <input
                  value={chat.model || ""}
                  onChange={(event) => setChatField("model", event.target.value)}
                  className="w-full rounded-xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-2 text-sm"
                  placeholder="gpt-4o-mini"
                />
              </Field>

              <Field label="API key">
                <input
                  type="password"
                  value={chat.api_key || ""}
                  onChange={(event) => setChatField("api_key", event.target.value)}
                  className="w-full rounded-xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-2 text-sm"
                  placeholder="sk-..."
                />
              </Field>

              <Field label="Base URL">
                <input
                  value={chat.base_url || ""}
                  onChange={(event) => setChatField("base_url", event.target.value)}
                  className="w-full rounded-xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-2 text-sm"
                  placeholder="https://api.openai.com/v1"
                />
              </Field>

              <Field label="System prompt">
                <textarea
                  value={chat.system_prompt || ""}
                  onChange={(event) =>
                    setChatField("system_prompt", event.target.value)
                  }
                  className="min-h-28 w-full rounded-xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-2 text-sm"
                  placeholder="You are a helpful assistant."
                />
              </Field>
            </div>
          </section>

          <section className="card-elevated rounded-2xl p-5 md:p-6">
            <h3 className="mb-1 text-lg font-semibold text-[var(--frontui-ink)]">
              Embeddings Model
            </h3>
            <p className="mb-4 text-sm text-[var(--frontui-muted)]">
              Used by vector retrieval and semantic search features.
            </p>

            <div className="grid gap-4">
              <Field label="Provider">
                <select
                  value={embeddings.provider || ""}
                  onChange={(event) =>
                    setEmbeddingField("provider", event.target.value)
                  }
                  className="w-full rounded-xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-2 text-sm"
                >
                  <option value="">Select provider</option>
                  <option value="openai">openai</option>
                  <option value="google">google</option>
                </select>
              </Field>

              <Field label="Model">
                <input
                  value={embeddings.model || ""}
                  onChange={(event) =>
                    setEmbeddingField("model", event.target.value)
                  }
                  className="w-full rounded-xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-2 text-sm"
                  placeholder="text-embedding-3-small"
                />
              </Field>

              <Field label="API key">
                <input
                  type="password"
                  value={embeddings.api_key || ""}
                  onChange={(event) =>
                    setEmbeddingField("api_key", event.target.value)
                  }
                  className="w-full rounded-xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-2 text-sm"
                  placeholder="sk-..."
                />
              </Field>

              <Field label="Base URL">
                <input
                  value={embeddings.base_url || ""}
                  onChange={(event) =>
                    setEmbeddingField("base_url", event.target.value)
                  }
                  className="w-full rounded-xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-2 text-sm"
                  placeholder="https://api.openai.com/v1"
                />
              </Field>
            </div>
          </section>
        </div>
      )}

      {!loading ? (
        <section className="card-elevated rounded-2xl p-5 md:p-6">
          <h3 className="mb-1 text-lg font-semibold text-[var(--frontui-ink)]">
            Plugins
          </h3>
          <p className="mb-4 text-sm text-[var(--frontui-muted)]">
            Enable or disable plugins, then runtime refresh is applied automatically.
          </p>

          {plugins.length === 0 ? (
            <p className="text-sm text-[var(--frontui-muted)]">
              No plugins discovered.
            </p>
          ) : (
            <div className="grid gap-3">
              {plugins.map((plugin) => {
                const busy = updatingPluginId === plugin.id;
                return (
                    <div
                      key={plugin.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedPlugin(plugin)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedPlugin(plugin);
                        }
                      }}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-3"
                    >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--frontui-ink)]">
                        {plugin.name || plugin.id}
                      </p>
                      <p className="truncate text-xs text-[var(--frontui-muted)]">
                        {plugin.id}
                        {plugin.version ? ` • v${plugin.version}` : ""}
                        {plugin.active ? " • active" : " • inactive"}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onTogglePlugin(plugin);
                      }}
                      disabled={busy || saving}
                      className={`inline-flex min-w-24 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        plugin.enabled
                          ? "bg-[#dbf3e4] text-[#1f6b3b]"
                          : "bg-[#f2e4e2] text-[#8d2e1f]"
                      }`}
                    >
                      {busy ? <Loader2 className="animate-spin" size={14} /> : null}
                      {plugin.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      <Dialog
        open={Boolean(selectedPlugin)}
        onOpenChange={(open) => {
          if (!open) setSelectedPlugin(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[80dvh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedPlugin?.name || selectedPlugin?.id || "Plugin Details"}
            </DialogTitle>
            <DialogDescription>
              Full plugin details from manifest, including permissions and runtime.
            </DialogDescription>
          </DialogHeader>

          {selectedPlugin ? (
            <div className="grid gap-4">
              <div className="grid gap-2 rounded-lg border border-[var(--frontui-line)] p-3">
                <p className="text-xs uppercase tracking-wide text-[var(--frontui-muted)]">
                  Overview
                </p>
                <p className="text-sm text-[var(--frontui-ink)]">
                  <strong>ID:</strong> {selectedPlugin.id}
                </p>
                <p className="text-sm text-[var(--frontui-ink)]">
                  <strong>Version:</strong> {selectedPlugin.version || "-"}
                </p>
                <p className="text-sm text-[var(--frontui-ink)]">
                  <strong>Runtime:</strong> {selectedPlugin.runtime || "-"}
                </p>
                <p className="text-sm text-[var(--frontui-ink)]">
                  <strong>Status:</strong>{" "}
                  {selectedPlugin.enabled ? "enabled" : "disabled"} /{" "}
                  {selectedPlugin.active ? "active" : "inactive"}
                </p>
                <p className="text-sm text-[var(--frontui-ink)]">
                  <strong>Description:</strong>{" "}
                  {selectedPlugin.description || "No description"}
                </p>
              </div>

              <div className="grid gap-2 rounded-lg border border-[var(--frontui-line)] p-3">
                <p className="text-xs uppercase tracking-wide text-[var(--frontui-muted)]">
                  Permissions
                </p>
                <pre className="overflow-auto rounded-md bg-[#f7f8fa] p-3 text-xs text-[var(--frontui-ink)]">
                  {JSON.stringify(selectedPlugin.permissions ?? {}, null, 2)}
                </pre>
              </div>

              <div className="grid gap-2 rounded-lg border border-[var(--frontui-line)] p-3">
                <p className="text-xs uppercase tracking-wide text-[var(--frontui-muted)]">
                  Full Manifest
                </p>
                <pre className="overflow-auto rounded-md bg-[#f7f8fa] p-3 text-xs text-[var(--frontui-ink)]">
                  {JSON.stringify(selectedPlugin.manifest ?? selectedPlugin, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm text-[var(--frontui-ink)]">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
