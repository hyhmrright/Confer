CREATE TABLE "errand_cards" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"errand_id" char(26) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"summary" text NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"base_price_cents" integer,
	"price_delta_cents" integer,
	"strictly_necessary" boolean DEFAULT true NOT NULL,
	"decision" varchar(16) DEFAULT 'pending' NOT NULL,
	"new_price_cents" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" char(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "errands" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"owner_user_id" char(26) NOT NULL,
	"title" varchar(255) NOT NULL,
	"kind" varchar(64),
	"status" varchar(16) DEFAULT 'in_progress' NOT NULL,
	"conversation_id" char(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "errand_cards" ADD CONSTRAINT "errand_cards_errand_id_errands_id_fk" FOREIGN KEY ("errand_id") REFERENCES "public"."errands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errand_cards" ADD CONSTRAINT "errand_cards_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errands" ADD CONSTRAINT "errands_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errands" ADD CONSTRAINT "errands_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_errand_cards_errand" ON "errand_cards" USING btree ("errand_id");--> statement-breakpoint
CREATE INDEX "idx_errands_owner" ON "errands" USING btree ("owner_user_id");