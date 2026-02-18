/**
 * The schema for the FrontClaw configuration (frontclaw.json).
 */
import * as z from "zod";

export const ChatSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  system_prompt: z.string().optional(),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
});
export type Chat = z.infer<typeof ChatSchema>;

export const EmbeddingsSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
});
export type Embeddings = z.infer<typeof EmbeddingsSchema>;

export const TablesSchema = z.object({
  items: z.string().optional(),
  profiles: z.string().optional(),
  interactions: z.string().optional(),
});
export type Tables = z.infer<typeof TablesSchema>;

export const BehaviorSchema = z.object({
  welcome_message: z.string().optional(),
  require_auth: z.boolean().optional(),
  position: z.string().optional(),
  show_typing_indicator: z.boolean().optional(),
});
export type Behavior = z.infer<typeof BehaviorSchema>;

export const ThemeSchema = z.object({
  mode: z.string().optional(),
  primary_color: z.string().optional(),
  font_family: z.string().optional(),
  border_radius: z.string().optional(),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const ToolSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
});
export type Tool = z.infer<typeof ToolSchema>;

export const AutocompleteSchema = z.object({
  enabled: z.boolean().optional(),
  trigger_min_length: z.number().optional(),
  max_suggestions: z.number().optional(),
  search_fields: z.array(z.string()).optional(),
});
export type Autocomplete = z.infer<typeof AutocompleteSchema>;

export const SearcherSchema = z.object({
  enabled: z.boolean().optional(),
  hybrid_search: z.boolean().optional(),
  fallback_to_llm: z.boolean().optional(),
});
export type Searcher = z.infer<typeof SearcherSchema>;

export const ProjectSchema = z.object({
  name: z.string().optional().default("FrontClaw Project"),
  environment: z.string().optional().default("development"),
});
export type Project = z.infer<typeof ProjectSchema>;

export const WebhooksSchema = z.object({
  on_high_feedback_score: z.string().optional(),
  on_profile_created: z.string().optional(),
});
export type Webhooks = z.infer<typeof WebhooksSchema>;

export const AiModelsSchema = z.object({
  embeddings: EmbeddingsSchema.optional(),
  chat: ChatSchema.optional(),
});
export type AiModels = z.infer<typeof AiModelsSchema>;

export const DatabaseSchema = z.object({
  strategy: z.string().optional(),
  tables: TablesSchema.optional(),
  vector_dimension: z.number().optional(),
});
export type Database = z.infer<typeof DatabaseSchema>;

export const EmbeddedBoxSchema = z.object({
  enabled: z.boolean().optional(),
  theme: ThemeSchema.optional(),
  behavior: BehaviorSchema.optional(),
  tools: z.array(ToolSchema).optional(),
});
export type EmbeddedBox = z.infer<typeof EmbeddedBoxSchema>;

export const FeaturesSchema = z.object({
  autocomplete: AutocompleteSchema.optional(),
  searcher: SearcherSchema.optional(),
});
export type Features = z.infer<typeof FeaturesSchema>;

export const FrontClawSchemaSchema = z
  .object({
    version: z.string().optional().default("1.0.0"),
    project: ProjectSchema.optional().default({
      name: "FrontClaw Project",
      environment: "development",
    }),
    database: DatabaseSchema.optional().default({}),
    ai_models: AiModelsSchema.optional().default({}),
    features: FeaturesSchema.optional().default({}),
    embedded_box: EmbeddedBoxSchema.optional().default({}),
    webhooks: WebhooksSchema.optional().default({}),
  })
  .strict();
export type FrontClawSchema = z.infer<typeof FrontClawSchemaSchema>;

export const ConfigPathSchema = z.string();
export type ConfigPath = z.infer<typeof ConfigPathSchema>;

export const FrontClawSchemaWithConfigPathSchema = FrontClawSchemaSchema.extend(
  {
    configPath: ConfigPathSchema,
  },
);
export type FrontClawSchemaWithConfigPath = z.infer<
  typeof FrontClawSchemaWithConfigPathSchema
>;
