CREATE TABLE "answer_feedback" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"message_id" char(26) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_grants" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"peer_id" char(26) NOT NULL,
	"signer_did" varchar(255) NOT NULL,
	"name" varchar(64) NOT NULL,
	"token_hash" char(64) NOT NULL,
	"kb_ids" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_grants_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "device_authorizations" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"device_hash" char(64) NOT NULL,
	"user_code" varchar(16) NOT NULL,
	"name" varchar(64) NOT NULL,
	"user_id" char(26),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_authorizations_device_hash_unique" UNIQUE("device_hash"),
	CONSTRAINT "device_authorizations_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "errand_events" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"errand_id" char(26) NOT NULL,
	"actor_id" char(26) NOT NULL,
	"status" varchar(16) NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "capability_id" char(26);--> statement-breakpoint
ALTER TABLE "answer_feedback" ADD CONSTRAINT "answer_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_grants" ADD CONSTRAINT "capability_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_grants" ADD CONSTRAINT "capability_grants_peer_id_peer_agents_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."peer_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errand_events" ADD CONSTRAINT "errand_events_errand_id_errands_id_fk" FOREIGN KEY ("errand_id") REFERENCES "public"."errands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errand_events" ADD CONSTRAINT "errand_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_answer_feedback_user" ON "answer_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_capability_grants_user" ON "capability_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_errand_events_errand" ON "errand_events" USING btree ("errand_id");