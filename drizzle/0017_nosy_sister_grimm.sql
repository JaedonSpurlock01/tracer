CREATE TABLE "report_artifact" (
	"job_id" text NOT NULL,
	"file_kind" text NOT NULL,
	"r2_key" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"content_type" text NOT NULL,
	CONSTRAINT "report_artifact_job_id_file_kind_pk" PRIMARY KEY("job_id","file_kind"),
	CONSTRAINT "report_artifact_file_kind_check" CHECK ("report_artifact"."file_kind" in ('pdf', 'csv', 'zip')),
	CONSTRAINT "report_artifact_byte_size_check" CHECK ("report_artifact"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "report_job" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requester_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"workspace_ids" text[] NOT NULL,
	"time_zone" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'Queued' NOT NULL,
	"failure_reason" text,
	"requested_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"artifacts_expire_at" timestamp with time zone,
	"metadata_expire_at" timestamp with time zone NOT NULL,
	CONSTRAINT "report_job_kind_check" CHECK ("report_job"."kind" in ('report', 'call_export')),
	CONSTRAINT "report_job_status_check" CHECK ("report_job"."status" in ('Queued', 'Generating', 'Completed', 'Failed')),
	CONSTRAINT "report_job_scope_check" CHECK (cardinality("report_job"."workspace_ids") > 0),
	CONSTRAINT "report_job_parameters_check" CHECK (jsonb_typeof("report_job"."parameters") = 'object'),
	CONSTRAINT "report_job_failure_check" CHECK (("report_job"."status" = 'Failed') = ("report_job"."failure_reason" is not null)),
	CONSTRAINT "report_job_completed_check" CHECK (("report_job"."status" = 'Completed') = ("report_job"."completed_at" is not null and "report_job"."artifacts_expire_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "report_artifact" ADD CONSTRAINT "report_artifact_job_id_report_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."report_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_job" ADD CONSTRAINT "report_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_job" ADD CONSTRAINT "report_job_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_job_requester_requested_at_idx" ON "report_job" USING btree ("organization_id","requester_user_id","requested_at");--> statement-breakpoint
CREATE INDEX "report_job_requester_fingerprint_idx" ON "report_job" USING btree ("requester_user_id","fingerprint");