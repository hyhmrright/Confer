-- Idempotent on purpose (IF NOT EXISTS + inlined FKs): this migration
-- reconciles environments where agent_memories/knowledge_bases/knowledge_documents
-- were created out-of-band before the journal tracked them. Keep it re-runnable.
CREATE TABLE IF NOT EXISTS "agent_memories" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"tags" text[] DEFAULT '{}',
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_bases" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_bases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_documents" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"kb_id" char(26) NOT NULL,
	"user_id" char(26) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(128),
	"size_bytes" integer,
	"chunk_count" integer DEFAULT 0,
	"status" varchar(32) DEFAULT 'processing',
	"storage_key" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_documents_kb_id_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "knowledge_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_memories_user" ON "agent_memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_knowledge_bases_user" ON "knowledge_bases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_knowledge_documents_kb" ON "knowledge_documents" USING btree ("kb_id");
