CREATE TABLE "probe_asks" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"asker_user_id" char(26) NOT NULL,
	"person" varchar(255) NOT NULL,
	"question" text NOT NULL,
	"conversation_id" char(26),
	"could_self_answer" boolean,
	"had_slack_dm_alt" boolean DEFAULT false NOT NULL,
	"prompted" boolean DEFAULT false NOT NULL,
	"is_founder_test" boolean DEFAULT false NOT NULL,
	"filled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "probe_asks" ADD CONSTRAINT "probe_asks_asker_user_id_users_id_fk" FOREIGN KEY ("asker_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe_asks" ADD CONSTRAINT "probe_asks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_probe_asks_asker" ON "probe_asks" USING btree ("asker_user_id");