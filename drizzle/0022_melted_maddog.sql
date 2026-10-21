CREATE TABLE "cloudflare_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"api_token_ciphertext" text NOT NULL,
	"master_key_version" integer DEFAULT 1 NOT NULL,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_detail" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cloudflare_connection_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "site_check" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"status_code" integer,
	"response_ms" integer,
	"ok" boolean NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "site_deployment" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"version_id" text NOT NULL,
	"source" text NOT NULL,
	"author_email" text,
	"deployed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_hostname" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"hostname" text NOT NULL,
	"zone_id" text NOT NULL,
	"certificate_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"site_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"started_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "site_metric_day" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"day" date NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"page_views" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"top_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"referrers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"devices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lcp_ms" integer,
	"inp_ms" integer,
	"cls" numeric(6, 3),
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_preview" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"version_id" text,
	"object_key" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"byte_size" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"script_name" text NOT NULL,
	"primary_hostname" text NOT NULL,
	"zone_id" text NOT NULL,
	"rum_site_tag" text,
	"live_version_id" text,
	"last_deployed_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloudflare_connection" ADD CONSTRAINT "cloudflare_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloudflare_connection" ADD CONSTRAINT "cloudflare_connection_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_check" ADD CONSTRAINT "site_check_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_deployment" ADD CONSTRAINT "site_deployment_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_hostname" ADD CONSTRAINT "site_hostname_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_link" ADD CONSTRAINT "site_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_link" ADD CONSTRAINT "site_link_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_link" ADD CONSTRAINT "site_link_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_link" ADD CONSTRAINT "site_link_started_by_user_id_user_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_metric_day" ADD CONSTRAINT "site_metric_day_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_preview" ADD CONSTRAINT "site_preview_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloudflare_connection_organization_id_idx" ON "cloudflare_connection" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "site_check_site_checked_at_idx" ON "site_check" USING btree ("site_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "site_deployment_site_version_idx" ON "site_deployment" USING btree ("site_id","version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_hostname_site_hostname_idx" ON "site_hostname" USING btree ("site_id","hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "site_link_open_site_idx" ON "site_link" USING btree ("site_id") WHERE "site_link"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "site_link_open_workspace_idx" ON "site_link" USING btree ("workspace_id") WHERE "site_link"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "site_link_organization_id_idx" ON "site_link" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "site_link_workspace_id_idx" ON "site_link" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_metric_day_site_day_idx" ON "site_metric_day" USING btree ("site_id","day");--> statement-breakpoint
CREATE INDEX "site_preview_site_captured_at_idx" ON "site_preview" USING btree ("site_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "site_organization_script_name_idx" ON "site" USING btree ("organization_id","script_name");--> statement-breakpoint
CREATE INDEX "site_organization_id_idx" ON "site" USING btree ("organization_id");