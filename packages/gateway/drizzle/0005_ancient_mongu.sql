ALTER TABLE "users" ADD COLUMN "role" varchar(16) DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" varchar(16) DEFAULT 'active' NOT NULL;