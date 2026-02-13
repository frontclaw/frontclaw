import {
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const TABLE_PREFIX = process.env.DB_TABLE_PREFIX ?? "fc_";

// Contents & Vectors
export const items = pgTable(
  `${TABLE_PREFIX}items`,
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: text("external_id").unique(), // ID from your CMS/Shopify/etc
    title: text("title").notNull(),
    description: text("description").notNull(),
    contentBody: text("content_body"), // For RAG/Chat context
    metadata: jsonb("metadata").default({}),
    category: text("category"),
    tags: text("tags").array(),
    embedding: vector("embedding", { dimensions: 1536 }), // OpenAI standard
    status: text("status").default("active"), // active, inactive, archived, draft
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index(`${TABLE_PREFIX}items_embedding_idx`).using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);
export type ItemCreate = typeof items.$inferInsert;

// Profiles & Intelligence
export const profiles = pgTable(`${TABLE_PREFIX}profiles`, {
  id: uuid("id").defaultRandom().primaryKey(),
  profileType: text("profile_type").notNull(), // 'user', 'anonymous', 'system', 'agent', 'category', 'topic'
  externalProfileId: text("external_profile_id").unique(),
  name: text("name"),
  // Aggregate vector representing "What this user likes right now"
  interestVector: vector("interest_vector", { dimensions: 1536 }),
  preferences: jsonb("preferences").default({
    diversity_weight: 0.5,
    novelty_weight: 0.5,
  }),
  lastInteractionAt: timestamp("last_interaction_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Chat Conversations
export const conversations = pgTable(`${TABLE_PREFIX}conversations`, {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id").references(() => profiles.id, {
    onDelete: "set null",
  }),
  title: text("title"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type ConversationCreate = typeof conversations.$inferInsert;

// Chat Messages
export const messages = pgTable(
  `${TABLE_PREFIX}messages`,
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, {
        onDelete: "cascade",
      }),
    role: text("role").notNull(), // system, user, assistant, tool
    content: text("content").notNull(),
    toolName: text("tool_name"),
    toolCallId: text("tool_call_id"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index(`${TABLE_PREFIX}messages_conversation_idx`).on(table.conversationId),
    index(`${TABLE_PREFIX}messages_created_at_idx`).on(table.createdAt),
  ],
);
export type MessageCreate = typeof messages.$inferInsert;

// Feedback Loop
export const interactions = pgTable(`${TABLE_PREFIX}interactions`, {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id").references(() => profiles.id, {
    onDelete: "cascade",
  }),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'view', 'click', 'purchase', 'dislike', 'search'
  score: real("score").default(1.0), // Can be negative for "show me less of this"
  context: jsonb("context"), // e.g., { device: 'mobile', location: 'home-page' }
  createdAt: timestamp("created_at").defaultNow(),
});

// Audit Logs
export const auditLogs = pgTable(`${TABLE_PREFIX}audit_logs`, {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: text("entity_type").notNull(), // 'item', 'profile', 'config'
  entityId: uuid("entity_id"),
  action: text("action").notNull(), // 'create', 'update', 'delete', 'ingest'
  actorId: text("actor_id"), // The API Key ID or Admin User ID
  previousState: jsonb("previous_state"),
  newState: jsonb("new_state"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
});
