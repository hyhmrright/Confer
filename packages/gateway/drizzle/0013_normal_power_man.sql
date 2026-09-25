DROP INDEX "idx_messages_conversation_created";--> statement-breakpoint
CREATE INDEX "idx_messages_conversation_id" ON "messages" USING btree ("conversation_id","id");