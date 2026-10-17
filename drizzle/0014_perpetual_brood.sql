ALTER TABLE "recording" ADD COLUMN "waveform_state" text DEFAULT 'Pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "waveform_object_key" text;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "waveform_failure_reason" text;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "waveform_generated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "recording_waveform_unfinished_created_at_idx" ON "recording" USING btree ("created_at") WHERE "recording"."waveform_state" <> 'Stored';--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_waveform_state_check" CHECK ("recording"."waveform_state" in ('Pending', 'Stored', 'Failed'));--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_waveform_stored_metadata_check" CHECK ("recording"."waveform_state" <> 'Stored' or ("recording"."waveform_object_key" is not null and "recording"."waveform_generated_at" is not null));--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_waveform_requires_stored_check" CHECK ("recording"."waveform_state" = 'Pending' or "recording"."transfer_state" = 'Stored');