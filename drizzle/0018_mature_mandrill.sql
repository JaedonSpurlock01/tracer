ALTER TABLE "recording" ADD COLUMN "mp3_state" text DEFAULT 'Pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "mp3_object_key" text;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "mp3_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "mp3_failure_reason" text;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "mp3_generated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "recording_mp3_unfinished_created_at_idx" ON "recording" USING btree ("created_at") WHERE "recording"."mp3_state" <> 'Stored';--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_mp3_state_check" CHECK ("recording"."mp3_state" in ('Pending', 'Stored', 'Failed'));--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_mp3_stored_metadata_check" CHECK ("recording"."mp3_state" <> 'Stored' or ("recording"."mp3_object_key" is not null and "recording"."mp3_size_bytes" is not null and "recording"."mp3_generated_at" is not null));--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_mp3_requires_stored_check" CHECK ("recording"."mp3_state" = 'Pending' or "recording"."transfer_state" = 'Stored');