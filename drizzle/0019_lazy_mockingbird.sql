ALTER TABLE "lead_assessment" ALTER COLUMN "rationale" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "media_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "media_purged_by_user_id" text;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "media_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_media_purged_by_user_id_fk" FOREIGN KEY ("media_purged_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recording_media_undeleted_created_at_idx" ON "recording" USING btree ("created_at") WHERE "recording"."media_deleted_at" is null;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "lead_assessment_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rationale IS NULL AND to_jsonb(NEW) - 'rationale' = to_jsonb(OLD) - 'rationale' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Lead Assessment is immutable';
END
$$;
