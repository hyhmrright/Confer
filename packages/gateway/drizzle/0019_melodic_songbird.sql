CREATE TABLE "peer_credentials" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"peer_id" char(26) NOT NULL,
	"token_json" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "peer_credentials" ADD CONSTRAINT "peer_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_credentials" ADD CONSTRAINT "peer_credentials_peer_id_peer_agents_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."peer_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_peer_credentials_owner_peer" ON "peer_credentials" USING btree ("user_id","peer_id");