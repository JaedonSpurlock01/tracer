CREATE TABLE "lead_assessment_evidence" (
	"lead_assessment_id" text NOT NULL,
	"position" integer NOT NULL,
	"turn_index" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"quote" text NOT NULL,
	CONSTRAINT "lead_assessment_evidence_lead_assessment_id_position_pk" PRIMARY KEY("lead_assessment_id","position"),
	CONSTRAINT "lead_assessment_evidence_turn_check" CHECK ("lead_assessment_evidence"."position" >= 0 and "lead_assessment_evidence"."turn_index" >= 0 and "lead_assessment_evidence"."start_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lead_assessment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"call_id" text NOT NULL,
	"recording_id" text NOT NULL,
	"classification" text NOT NULL,
	"score" integer NOT NULL,
	"summary" text NOT NULL,
	"rationale" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lead_assessment_classification_check" CHECK ("lead_assessment"."classification" in ('Good Lead', 'Not Good Lead', 'Uncertain')),
	CONSTRAINT "lead_assessment_score_check" CHECK ("lead_assessment"."score" between 0 and 100),
	CONSTRAINT "lead_assessment_usage_check" CHECK ("lead_assessment"."input_tokens" >= 0 and "lead_assessment"."output_tokens" >= 0 and "lead_assessment"."cost_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lead_review" (
	"call_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"classification" text NOT NULL,
	"note" text,
	"reviewer_user_id" text,
	"reviewed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lead_review_classification_check" CHECK ("lead_review"."classification" in ('Good Lead', 'Not Good Lead', 'Uncertain'))
);
--> statement-breakpoint
CREATE TABLE "transcript" (
	"recording_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"call_id" text NOT NULL,
	"turns" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "transcript_turns_check" CHECK (jsonb_typeof("transcript"."turns") = 'array')
);
--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "transcript_state" text;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "transcript_skip_reason" text;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "transcript_failure_reason" text;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "transcript_audio_ms" integer;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "transcript_cost_usd" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "transcript_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "lead_assessment_state" text;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "lead_assessment_failure_reason" text;--> statement-breakpoint
ALTER TABLE "lead_assessment_evidence" ADD CONSTRAINT "lead_assessment_evidence_lead_assessment_id_lead_assessment_id_fk" FOREIGN KEY ("lead_assessment_id") REFERENCES "public"."lead_assessment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assessment" ADD CONSTRAINT "lead_assessment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assessment" ADD CONSTRAINT "lead_assessment_call_id_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."call"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assessment" ADD CONSTRAINT "lead_assessment_recording_id_recording_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recording"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_review" ADD CONSTRAINT "lead_review_call_id_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."call"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_review" ADD CONSTRAINT "lead_review_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_review" ADD CONSTRAINT "lead_review_reviewer_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript" ADD CONSTRAINT "transcript_recording_id_recording_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recording"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript" ADD CONSTRAINT "transcript_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript" ADD CONSTRAINT "transcript_call_id_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."call"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_assessment_recording_id_idx" ON "lead_assessment" USING btree ("recording_id");--> statement-breakpoint
CREATE INDEX "lead_assessment_organization_id_idx" ON "lead_assessment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "lead_assessment_call_id_idx" ON "lead_assessment" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "lead_review_organization_id_idx" ON "lead_review" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "transcript_organization_id_idx" ON "transcript" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "transcript_call_id_idx" ON "transcript" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "recording_transcript_unfinished_created_at_idx" ON "recording" USING btree ("created_at") WHERE "recording"."transcript_state" in ('Pending', 'Failed');--> statement-breakpoint
CREATE INDEX "recording_lead_assessment_unfinished_created_at_idx" ON "recording" USING btree ("created_at") WHERE "recording"."lead_assessment_state" in ('Pending', 'Failed');--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_transcript_state_check" CHECK ("recording"."transcript_state" is null or "recording"."transcript_state" in ('Pending', 'Completed', 'Failed', 'Skipped'));--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_transcript_skip_reason_check" CHECK (("recording"."transcript_state" is distinct from 'Skipped' and "recording"."transcript_skip_reason" is null) or ("recording"."transcript_state" = 'Skipped' and "recording"."transcript_skip_reason" is not null and "recording"."transcript_skip_reason" in ('analysis_disabled', 'spam_gate_not_passed', 'too_short')));--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_transcript_usage_check" CHECK ("recording"."transcript_state" is distinct from 'Completed' or ("recording"."transcript_audio_ms" >= 0 and "recording"."transcript_cost_usd" >= 0 and "recording"."transcript_completed_at" is not null));--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_transcript_requires_stored_check" CHECK ("recording"."transcript_state" is null or "recording"."transfer_state" = 'Stored');--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_lead_assessment_state_check" CHECK ("recording"."lead_assessment_state" is null or "recording"."lead_assessment_state" in ('Pending', 'Completed', 'Failed'));--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_lead_assessment_requires_transcript_check" CHECK ("recording"."lead_assessment_state" is null or "recording"."transcript_state" = 'Completed');--> statement-breakpoint
CREATE FUNCTION "lead_assessment_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Lead Assessment is immutable';
END
$$;--> statement-breakpoint
CREATE TRIGGER "lead_assessment_immutable" BEFORE UPDATE ON "lead_assessment" FOR EACH ROW EXECUTE FUNCTION "lead_assessment_immutable"();
