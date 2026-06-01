CREATE TABLE "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "status" varchar(16) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "moderation_status" varchar(16) DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "moderation_status" varchar(16) DEFAULT 'visible' NOT NULL;