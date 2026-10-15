CREATE TABLE "call_flow_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"graph" jsonb NOT NULL,
	"based_on_version" integer,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "call_flow_draft_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "flow_version" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"published_by_user_id" text,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"twilio_number_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"prior_voice_url" text,
	"prior_voice_method" text,
	"prior_voice_fallback_url" text,
	"prior_voice_fallback_method" text,
	"prior_status_callback_url" text,
	"prior_status_callback_method" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "number_assignment_ended_reason_check" CHECK ("number_assignment"."ended_reason" is null or "number_assignment"."ended_reason" in ('archived', 'replaced', 'activation_failed'))
);
--> statement-breakpoint
ALTER TABLE "call_flow_draft" ADD CONSTRAINT "call_flow_draft_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_flow_draft" ADD CONSTRAINT "call_flow_draft_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_flow_draft" ADD CONSTRAINT "call_flow_draft_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_version" ADD CONSTRAINT "flow_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_version" ADD CONSTRAINT "flow_version_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_version" ADD CONSTRAINT "flow_version_published_by_user_id_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_assignment" ADD CONSTRAINT "number_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_assignment" ADD CONSTRAINT "number_assignment_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_assignment" ADD CONSTRAINT "number_assignment_twilio_number_id_twilio_number_id_fk" FOREIGN KEY ("twilio_number_id") REFERENCES "public"."twilio_number"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_flow_draft_organization_id_idx" ON "call_flow_draft" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_version_workspace_version_idx" ON "flow_version" USING btree ("workspace_id","version");--> statement-breakpoint
CREATE INDEX "flow_version_organization_id_idx" ON "flow_version" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "flow_version_workspace_id_idx" ON "flow_version" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "number_assignment_active_number_idx" ON "number_assignment" USING btree ("twilio_number_id") WHERE "number_assignment"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "number_assignment_active_workspace_idx" ON "number_assignment" USING btree ("workspace_id") WHERE "number_assignment"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "number_assignment_organization_id_idx" ON "number_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "number_assignment_workspace_id_idx" ON "number_assignment" USING btree ("workspace_id");