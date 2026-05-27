CREATE TABLE "knowledge_bases" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_bases_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE INDEX "idx_knowledge_bases_user" ON "knowledge_bases" ("user_id");
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"kb_id" char(26) NOT NULL,
	"user_id" char(26) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(128),
	"size_bytes" integer,
	"chunk_count" integer DEFAULT 0,
	"status" varchar(32) DEFAULT 'processing',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_documents_kb_id_fk" FOREIGN KEY ("kb_id") REFERENCES "knowledge_bases"("id"),
	CONSTRAINT "knowledge_documents_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE INDEX "idx_knowledge_documents_kb" ON "knowledge_documents" ("kb_id");
