CREATE TABLE "fc_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"actor_id" text,
	"previous_state" jsonb,
	"new_state" jsonb,
	"ip_address" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fc_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"item_id" uuid,
	"type" text NOT NULL,
	"score" real DEFAULT 1,
	"context" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fc_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"content_body" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"category" text,
	"tags" text[],
	"embedding" vector(1536),
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "fc_items_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "fc_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_type" text NOT NULL,
	"external_profile_id" text,
	"name" text,
	"interest_vector" vector(1536),
	"preferences" jsonb DEFAULT '{"diversity_weight":0.5,"novelty_weight":0.5}'::jsonb,
	"last_interaction_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "fc_profiles_external_profile_id_unique" UNIQUE("external_profile_id")
);
--> statement-breakpoint
ALTER TABLE "fc_interactions" ADD CONSTRAINT "fc_interactions_profile_id_fc_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."fc_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fc_interactions" ADD CONSTRAINT "fc_interactions_item_id_fc_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."fc_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fc_items_embedding_idx" ON "fc_items" USING hnsw ("embedding" vector_cosine_ops);