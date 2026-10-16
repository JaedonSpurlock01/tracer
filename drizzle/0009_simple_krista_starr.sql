CREATE TABLE "call" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"number_assignment_id" text NOT NULL,
	"flow_version_id" text NOT NULL,
	"twilio_call_sid" text NOT NULL,
	"tracking_number" text NOT NULL,
	"caller_number" text,
	"state" text DEFAULT 'In Progress' NOT NULL,
	"outcome" text,
	"outcome_reason" text,
	"forward_node_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "call_state_check" CHECK ("call"."state" in ('In Progress', 'Completed')),
	CONSTRAINT "call_outcome_check" CHECK ("call"."outcome" is null or "call"."outcome" in ('Answered', 'Voicemail', 'Missed', 'Abandoned', 'Blocked', 'Failed')),
	CONSTRAINT "call_completed_outcome_check" CHECK ("call"."state" <> 'Completed' or "call"."outcome" is not null)
);
--> statement-breakpoint
CREATE TABLE "provider_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"number_assignment_id" text,
	"call_id" text,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"disposition" text NOT NULL,
	"detail" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "provider_event_kind_check" CHECK ("provider_event"."kind" in ('voice', 'status', 'dial')),
	CONSTRAINT "provider_event_disposition_check" CHECK ("provider_event"."disposition" in ('accepted', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_number_assignment_id_number_assignment_id_fk" FOREIGN KEY ("number_assignment_id") REFERENCES "public"."number_assignment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_flow_version_id_flow_version_id_fk" FOREIGN KEY ("flow_version_id") REFERENCES "public"."flow_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_event" ADD CONSTRAINT "provider_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_event" ADD CONSTRAINT "provider_event_number_assignment_id_number_assignment_id_fk" FOREIGN KEY ("number_assignment_id") REFERENCES "public"."number_assignment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_event" ADD CONSTRAINT "provider_event_call_id_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."call"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_organization_call_sid_idx" ON "call" USING btree ("organization_id","twilio_call_sid");--> statement-breakpoint
CREATE INDEX "call_organization_id_idx" ON "call" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "call_workspace_id_idx" ON "call" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_event_organization_key_idx" ON "provider_event" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "provider_event_organization_id_idx" ON "provider_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "provider_event_call_id_idx" ON "provider_event" USING btree ("call_id");