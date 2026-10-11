CREATE TABLE "a2a_push_configs" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"task_id" char(26) NOT NULL,
	"caller_did" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"token_json" jsonb,
	"auth_scheme" varchar(64),
	"auth_credentials_json" jsonb,
	"last_state" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_a2a_push_configs_task" ON "a2a_push_configs" USING btree ("task_id");