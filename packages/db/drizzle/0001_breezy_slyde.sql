CREATE TABLE "fc_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"title" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fc_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_name" text,
	"tool_call_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "fc_conversations" ADD CONSTRAINT "fc_conversations_profile_id_fc_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."fc_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fc_messages" ADD CONSTRAINT "fc_messages_conversation_id_fc_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."fc_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fc_messages_conversation_idx" ON "fc_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "fc_messages_created_at_idx" ON "fc_messages" USING btree ("created_at");