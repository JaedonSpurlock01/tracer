ALTER TABLE "provider_event" DROP CONSTRAINT "provider_event_kind_check";--> statement-breakpoint
ALTER TABLE "call" ADD COLUMN "pending_outcome" text;--> statement-breakpoint
ALTER TABLE "call" ADD COLUMN "pending_outcome_reason" text;--> statement-breakpoint
ALTER TABLE "call" ADD COLUMN "voicemail_recording_sid" text;--> statement-breakpoint
ALTER TABLE "call" ADD COLUMN "voicemail_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_pending_outcome_check" CHECK ("call"."pending_outcome" is null or "call"."pending_outcome" in ('Answered', 'Voicemail', 'Missed', 'Abandoned', 'Blocked', 'Failed'));--> statement-breakpoint
ALTER TABLE "provider_event" ADD CONSTRAINT "provider_event_kind_check" CHECK ("provider_event"."kind" in ('voice', 'forward', 'forward_status', 'status', 'gather', 'whisper', 'voicemail', 'voicemail_status'));