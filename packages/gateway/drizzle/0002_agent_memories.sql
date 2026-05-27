CREATE TABLE "agent_memories" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"tags" text[],
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_memories_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE INDEX "idx_agent_memories_user" ON "agent_memories" ("user_id");
