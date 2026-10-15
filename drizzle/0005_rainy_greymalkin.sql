CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"reporting_timezone" text NOT NULL,
	"state" text DEFAULT 'Setup Required' NOT NULL,
	"destination_number" text,
	"recording_enabled" boolean DEFAULT false NOT NULL,
	"analysis_enabled" boolean DEFAULT false NOT NULL,
	"spam_gate_enabled" boolean DEFAULT false NOT NULL,
	"whisper_enabled" boolean DEFAULT false NOT NULL,
	"whisper_message" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "workspace_state_check" CHECK ("workspace"."state" in ('Setup Required', 'Active', 'Archived')),
	CONSTRAINT "workspace_analysis_requires_recording_check" CHECK (not "workspace"."analysis_enabled" or "workspace"."recording_enabled")
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_organization_name_idx" ON "workspace" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "workspace_organization_id_idx" ON "workspace" USING btree ("organization_id");