CREATE TABLE "agents" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"did" varchar(255) NOT NULL,
	"name" varchar(128),
	"description" text,
	"avatar_url" text,
	"primary_language" varchar(8) DEFAULT 'zh' NOT NULL,
	"style" varchar(32) DEFAULT 'friendly',
	"model_config_json" jsonb DEFAULT '{}'::jsonb,
	"policies_json" jsonb DEFAULT '{}'::jsonb,
	"capabilities_json" jsonb DEFAULT '[]'::jsonb,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_did_unique" UNIQUE("did")
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"message_id" char(26),
	"user_id" char(26) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(128),
	"size_bytes" integer,
	"storage_url" text NOT NULL,
	"sha256" char(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26),
	"action" varchar(64) NOT NULL,
	"details_json" jsonb,
	"ip_address" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"conversation_id" char(26) NOT NULL,
	"participant_type" varchar(16) NOT NULL,
	"user_id" char(26),
	"agent_id" char(26),
	"peer_id" char(26),
	"role" varchar(16) DEFAULT 'member',
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone,
	"notification" varchar(16) DEFAULT 'all'
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"type" varchar(16) NOT NULL,
	"name" varchar(255),
	"created_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "keypairs" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"owner_type" varchar(16) NOT NULL,
	"owner_id" char(26) NOT NULL,
	"key_id" varchar(255) NOT NULL,
	"public_key_multibase" text NOT NULL,
	"private_key_jwk_encrypted" jsonb NOT NULL,
	"algorithm" varchar(32) DEFAULT 'Ed25519' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "keypairs_key_id_unique" UNIQUE("key_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"conversation_id" char(26) NOT NULL,
	"sender_type" varchar(16) NOT NULL,
	"sender_id" char(26) NOT NULL,
	"sender_did" varchar(255),
	"content_type" varchar(32) DEFAULT 'text' NOT NULL,
	"content" text,
	"content_json" jsonb,
	"in_reply_to" char(26),
	"thread_root" char(26),
	"citations_json" jsonb,
	"language" varchar(8),
	"translation_json" jsonb,
	"via" varchar(32),
	"delivered_at" timestamp with time zone,
	"read_by_json" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "peer_agents" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"did" varchar(255) NOT NULL,
	"name" varchar(128),
	"description" text,
	"avatar_url" text,
	"organization" varchar(255),
	"endpoint" text NOT NULL,
	"public_key_json" jsonb NOT NULL,
	"agent_facts_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"etag" varchar(255),
	"trust_level" varchar(16) DEFAULT 'unknown',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_agents_did_unique" UNIQUE("did")
);
--> statement-breakpoint
CREATE TABLE "peer_contacts" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"peer_id" char(26) NOT NULL,
	"alias" varchar(128),
	"tags" text[],
	"pinned" boolean DEFAULT false,
	"muted" boolean DEFAULT false,
	"policy_overrides_json" jsonb DEFAULT '{}'::jsonb,
	"added_via" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_peer_contacts_user_peer" UNIQUE("user_id","peer_id")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"peer_id" char(26),
	"action" varchar(64) NOT NULL,
	"scope_json" jsonb NOT NULL,
	"level" varchar(8) NOT NULL,
	"decision" varchar(16),
	"decision_scope" varchar(16),
	"requested_by" char(26),
	"decided_by" char(26),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_memory" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"project_id" varchar(255) NOT NULL,
	"peer_id" char(26) NOT NULL,
	"facts_md" text,
	"decisions_md" text,
	"meta_json" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_project_memory" UNIQUE("user_id","project_id","peer_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"device_id" varchar(64) NOT NULL,
	"platform" varchar(16),
	"refresh_token_hash" text,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"conversation_id" char(26) NOT NULL,
	"root_message_id" char(26) NOT NULL,
	"title" varchar(255),
	"summary" text,
	"tags" text[],
	"participants_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"username" varchar(64) NOT NULL,
	"email" varchar(255),
	"phone" varchar(32),
	"display_name" varchar(128),
	"avatar_url" text,
	"did" varchar(255) NOT NULL,
	"password_hash" text,
	"preferences_json" jsonb DEFAULT '{}'::jsonb,
	"llm_keys_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_did_unique" UNIQUE("did")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_peer_id_peer_agents_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."peer_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_contacts" ADD CONSTRAINT "peer_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_contacts" ADD CONSTRAINT "peer_contacts_peer_id_peer_agents_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."peer_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_peer_id_peer_agents_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."peer_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memory" ADD CONSTRAINT "project_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memory" ADD CONSTRAINT "project_memory_peer_id_peer_agents_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."peer_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_root_message_id_messages_id_fk" FOREIGN KEY ("root_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agents_user" ON "agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_agents_did" ON "agents" USING btree ("did");--> statement-breakpoint
CREATE INDEX "idx_audit_user_created" ON "audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_participants_conv" ON "conversation_participants" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_participants_user" ON "conversation_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_created_by" ON "conversations" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_keypairs_owner" ON "keypairs" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation_created" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_thread_root" ON "messages" USING btree ("thread_root");--> statement-breakpoint
CREATE INDEX "idx_peers_did" ON "peer_agents" USING btree ("did");--> statement-breakpoint
CREATE INDEX "idx_contacts_user" ON "peer_contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_permissions_user_peer" ON "permissions" USING btree ("user_id","peer_id");--> statement-breakpoint
CREATE INDEX "idx_project_memory_user_project" ON "project_memory" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_threads_conversation" ON "threads" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_users_did" ON "users" USING btree ("did");