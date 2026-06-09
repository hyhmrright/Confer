ALTER TABLE "errand_cards" ADD COLUMN "pushed_by" char(26);--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "created_by" char(26);--> statement-breakpoint
ALTER TABLE "errand_cards" ADD CONSTRAINT "errand_cards_pushed_by_users_id_fk" FOREIGN KEY ("pushed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errands" ADD CONSTRAINT "errands_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;