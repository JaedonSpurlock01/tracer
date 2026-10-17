CREATE TABLE "recording" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"call_id" text NOT NULL,
	"twilio_recording_sid" text NOT NULL,
	"source" text NOT NULL,
	"channels" integer NOT NULL,
	"duration_seconds" integer,
	"transfer_state" text DEFAULT 'Pending' NOT NULL,
	"twilio_cleanup_state" text DEFAULT 'Pending' NOT NULL,
	"r2_object_key" text,
	"size_bytes" bigint,
	"sha256" text,
	"failure_stage" text,
	"failure_reason" text,
	"stored_at" timestamp with time zone,
	"twilio_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recording_source_check" CHECK ("recording"."source" in ('connected', 'voicemail')),
	CONSTRAINT "recording_channels_check" CHECK ("recording"."channels" in (1, 2)),
	CONSTRAINT "recording_transfer_state_check" CHECK ("recording"."transfer_state" in ('Pending', 'Stored', 'Failed')),
	CONSTRAINT "recording_twilio_cleanup_state_check" CHECK ("recording"."twilio_cleanup_state" in ('Pending', 'Deleted', 'Failed')),
	CONSTRAINT "recording_stored_metadata_check" CHECK ("recording"."transfer_state" <> 'Stored' or ("recording"."r2_object_key" is not null and "recording"."size_bytes" is not null and "recording"."sha256" is not null and "recording"."stored_at" is not null)),
	CONSTRAINT "recording_cleanup_requires_stored_check" CHECK ("recording"."twilio_cleanup_state" <> 'Deleted' or "recording"."transfer_state" = 'Stored')
);
--> statement-breakpoint
ALTER TABLE "provider_event" DROP CONSTRAINT "provider_event_kind_check";--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_call_id_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."call"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recording_organization_recording_sid_idx" ON "recording" USING btree ("organization_id","twilio_recording_sid");--> statement-breakpoint
CREATE INDEX "recording_organization_id_idx" ON "recording" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "recording_workspace_id_idx" ON "recording" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "recording_call_id_idx" ON "recording" USING btree ("call_id");--> statement-breakpoint
ALTER TABLE "provider_event" ADD CONSTRAINT "provider_event_kind_check" CHECK ("provider_event"."kind" in ('voice', 'forward', 'forward_status', 'status', 'gather', 'whisper', 'voicemail', 'voicemail_status', 'recording_status'));