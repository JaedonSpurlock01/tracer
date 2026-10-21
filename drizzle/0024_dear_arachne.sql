CREATE TABLE "deal" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deal_kind_check" CHECK ("deal"."kind" in ('Monthly', 'Weekly', 'Per Lead')),
	CONSTRAINT "deal_amount_check" CHECK ("deal"."amount_cents" > 0),
	CONSTRAINT "deal_period_check" CHECK ("deal"."ended_on" is null or "deal"."ended_on" >= "deal"."started_on")
);
--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "domain_registrar" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "domain_renewal_cents" integer;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "domain_renews_on" date;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_open_workspace_idx" ON "deal" USING btree ("workspace_id") WHERE "deal"."ended_on" is null;--> statement-breakpoint
CREATE INDEX "deal_organization_id_idx" ON "deal" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deal_workspace_id_idx" ON "deal" USING btree ("workspace_id");