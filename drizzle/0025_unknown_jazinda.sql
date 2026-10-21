CREATE TABLE "form_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"site_id" text NOT NULL,
	"site_link_id" text NOT NULL,
	"submission_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"page" text,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"fields" jsonb NOT NULL,
	"repeat_of_id" text,
	"held" boolean DEFAULT false NOT NULL,
	"forward_status" text NOT NULL,
	"forward_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"forward_error" text,
	"forwarded_at" timestamp with time zone,
	"forward_message_id" text,
	"review_classification" text,
	"review_note" text,
	"reviewer_user_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "form_submission_forward_status_check" CHECK ("form_submission"."forward_status" in ('Sent', 'Failed', 'Not configured', 'Held', 'Rejected')),
	CONSTRAINT "form_submission_review_classification_check" CHECK ("form_submission"."review_classification" is null or "form_submission"."review_classification" in ('Good Lead', 'Not Good Lead', 'Uncertain')),
	CONSTRAINT "form_submission_held_review_check" CHECK (not "form_submission"."held" or "form_submission"."review_classification" is null)
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "forms_key_hash" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "forms_key_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "form_forward_to" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_site_link_id_site_link_id_fk" FOREIGN KEY ("site_link_id") REFERENCES "public"."site_link"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_repeat_of_id_fk" FOREIGN KEY ("repeat_of_id") REFERENCES "public"."form_submission"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_reviewer_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_submission_site_submission_idx" ON "form_submission" USING btree ("site_id","submission_id");--> statement-breakpoint
CREATE INDEX "form_submission_organization_id_idx" ON "form_submission" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "form_submission_workspace_received_idx" ON "form_submission" USING btree ("workspace_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_forms_key_hash_idx" ON "organization" USING btree ("forms_key_hash");