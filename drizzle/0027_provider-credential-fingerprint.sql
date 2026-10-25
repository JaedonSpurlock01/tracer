ALTER TABLE "number_assignment" DROP CONSTRAINT "number_assignment_ended_reason_check";--> statement-breakpoint
ALTER TABLE "cloudflare_connection" ADD COLUMN "master_key_fingerprint" text;--> statement-breakpoint
ALTER TABLE "dataforseo_connection" ADD COLUMN "master_key_fingerprint" text;--> statement-breakpoint
ALTER TABLE "number_assignment" ADD COLUMN "voice_restore_skipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "twilio_connection" ADD COLUMN "master_key_fingerprint" text;--> statement-breakpoint
ALTER TABLE "cloudflare_connection" DROP COLUMN "master_key_version";--> statement-breakpoint
ALTER TABLE "dataforseo_connection" DROP COLUMN "master_key_version";--> statement-breakpoint
ALTER TABLE "twilio_connection" DROP COLUMN "master_key_version";--> statement-breakpoint
ALTER TABLE "number_assignment" ADD CONSTRAINT "number_assignment_ended_reason_check" CHECK ("number_assignment"."ended_reason" is null or "number_assignment"."ended_reason" in ('archived', 'replaced', 'detached', 'disconnected', 'activation_failed'));