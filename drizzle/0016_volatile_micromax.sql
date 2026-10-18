CREATE TABLE "call_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "call_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"call_id" text NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" text,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "call_event_kind_check" CHECK ("call_event"."kind" in ('call_received', 'spam_gate_passed', 'spam_gate_failed', 'forwarding_attempted', 'call_completed', 'recording_transferred', 'recording_transfer_failed', 'transcript_completed', 'transcript_skipped', 'transcript_failed', 'lead_assessment_completed', 'lead_assessment_failed', 'lead_review_added')),
	CONSTRAINT "call_event_detail_check" CHECK (jsonb_typeof("call_event"."detail") = 'object')
);
--> statement-breakpoint
ALTER TABLE "call_event" ADD CONSTRAINT "call_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_event" ADD CONSTRAINT "call_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_event" ADD CONSTRAINT "call_event_call_id_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."call"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_event" ADD CONSTRAINT "call_event_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_event_organization_key_idx" ON "call_event" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "call_event_call_occurred_at_idx" ON "call_event" USING btree ("organization_id","call_id","occurred_at");--> statement-breakpoint
CREATE INDEX "call_event_organization_occurred_at_idx" ON "call_event" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "call_event_workspace_occurred_at_idx" ON "call_event" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "call_organization_started_at_idx" ON "call" USING btree ("organization_id","started_at");--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "idempotency_key")
SELECT c."organization_id", c."workspace_id", c."id", 'call_received', c."started_at", 'call_received:' || c."id"
  FROM "call" c
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "idempotency_key")
SELECT DISTINCT ON (c."id") c."organization_id", c."workspace_id", c."id", 'spam_gate_passed', e."received_at", 'spam_gate:' || c."id"
  FROM "call" c
  JOIN "flow_version" f ON f."id" = c."flow_version_id"
  JOIN "provider_event" e ON e."call_id" = c."id" AND e."organization_id" = c."organization_id" AND e."kind" = 'gather' AND e."disposition" = 'accepted'
  JOIN LATERAL jsonb_array_elements(f."graph"->'nodes') n ON n->>'type' = 'keypad_gate' AND n->>'id' = split_part(e."idempotency_key", ':', 3)
 WHERE e."payload"->>'Digits' = n->>'digit'
 ORDER BY c."id", e."received_at"
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "idempotency_key")
SELECT c."organization_id", c."workspace_id", c."id", 'spam_gate_failed',
       CASE WHEN c."outcome_reason" = 'gate_not_completed' THEN c."ended_at" ELSE coalesce(g."last_received_at", c."ended_at") END,
       'spam_gate:' || c."id"
  FROM "call" c
  JOIN "flow_version" f ON f."id" = c."flow_version_id"
  LEFT JOIN LATERAL (
    SELECT max(e."received_at") AS "last_received_at", count(*) AS "attempts"
      FROM "provider_event" e
     WHERE e."call_id" = c."id" AND e."organization_id" = c."organization_id" AND e."kind" = 'gather' AND e."disposition" = 'accepted'
  ) g ON true
 WHERE c."state" = 'Completed'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(f."graph"->'nodes') n WHERE n->>'type' = 'keypad_gate')
   AND (c."outcome" = 'Blocked' OR g."attempts" > 0)
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "idempotency_key")
SELECT c."organization_id", c."workspace_id", c."id", 'forwarding_attempted', c."forward_started_at", 'forwarding_attempted:' || c."id"
  FROM "call" c
 WHERE c."forward_started_at" IS NOT NULL
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "detail", "idempotency_key")
SELECT c."organization_id", c."workspace_id", c."id", 'call_completed', c."ended_at", jsonb_build_object('outcome', c."outcome"), 'call_completed:' || c."id" || ':' || c."outcome"
  FROM "call" c
 WHERE c."state" = 'Completed'
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "idempotency_key")
SELECT r."organization_id", r."workspace_id", r."call_id", 'recording_transferred', r."stored_at", 'recording_transferred:' || r."id"
  FROM "recording" r
 WHERE r."transfer_state" = 'Stored'
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "detail", "idempotency_key")
SELECT r."organization_id", r."workspace_id", r."call_id", 'recording_transfer_failed', r."updated_at",
       jsonb_build_object('stage', r."failure_stage", 'backfilled', true), 'recording_transfer_failed:' || r."id"
  FROM "recording" r
 WHERE r."transfer_state" = 'Failed'
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "idempotency_key")
SELECT r."organization_id", r."workspace_id", r."call_id", 'transcript_completed', r."transcript_completed_at", 'transcript_completed:' || r."id"
  FROM "recording" r
 WHERE r."transcript_state" = 'Completed'
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "detail", "idempotency_key")
SELECT r."organization_id", r."workspace_id", r."call_id", 'transcript_skipped', r."stored_at", jsonb_build_object('reason', r."transcript_skip_reason"), 'transcript_skipped:' || r."id"
  FROM "recording" r
 WHERE r."transcript_state" = 'Skipped'
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "detail", "idempotency_key")
SELECT r."organization_id", r."workspace_id", r."call_id", 'transcript_failed', r."updated_at", '{"backfilled": true}'::jsonb, 'transcript_failed:' || r."id"
  FROM "recording" r
 WHERE r."transcript_state" = 'Failed'
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "detail", "idempotency_key")
SELECT a."organization_id", r."workspace_id", a."call_id", 'lead_assessment_completed', a."processed_at",
       jsonb_build_object('classification', a."classification", 'score', a."score"), 'lead_assessment_completed:' || a."recording_id"
  FROM "lead_assessment" a
  JOIN "recording" r ON r."id" = a."recording_id"
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "detail", "idempotency_key")
SELECT r."organization_id", r."workspace_id", r."call_id", 'lead_assessment_failed', r."updated_at", '{"backfilled": true}'::jsonb, 'lead_assessment_failed:' || r."id"
  FROM "recording" r
 WHERE r."lead_assessment_state" = 'Failed'
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "call_event" ("organization_id", "workspace_id", "call_id", "kind", "occurred_at", "detail", "actor_user_id", "idempotency_key")
SELECT v."organization_id", c."workspace_id", v."call_id", 'lead_review_added', v."reviewed_at", jsonb_build_object('classification', v."classification"), v."reviewer_user_id",
       'lead_review_added:' || v."call_id" || ':backfill'
  FROM "lead_review" v
  JOIN "call" c ON c."id" = v."call_id"
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;
