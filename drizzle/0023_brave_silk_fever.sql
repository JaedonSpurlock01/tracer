CREATE TABLE "dataforseo_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"login" text NOT NULL,
	"password_ciphertext" text NOT NULL,
	"master_key_version" integer DEFAULT 1 NOT NULL,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_detail" text,
	"last_checked_at" timestamp with time zone,
	"lookups_this_month" integer DEFAULT 0 NOT NULL,
	"lookups_month" date,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dataforseo_connection_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "keyword_rank_day" (
	"id" text PRIMARY KEY NOT NULL,
	"site_keyword_id" text NOT NULL,
	"day" date NOT NULL,
	"position" integer,
	"ranking_url" text,
	"top_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "keyword_rank_day_position_check" CHECK ("keyword_rank_day"."position" is null or "keyword_rank_day"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "site_keyword" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"phrase" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "site_keyword_weight_check" CHECK ("site_keyword"."weight" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "service_area_city" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "service_area_region" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "service_area_country" text DEFAULT 'United States';--> statement-breakpoint
ALTER TABLE "dataforseo_connection" ADD CONSTRAINT "dataforseo_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataforseo_connection" ADD CONSTRAINT "dataforseo_connection_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_rank_day" ADD CONSTRAINT "keyword_rank_day_site_keyword_id_site_keyword_id_fk" FOREIGN KEY ("site_keyword_id") REFERENCES "public"."site_keyword"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_keyword" ADD CONSTRAINT "site_keyword_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dataforseo_connection_organization_id_idx" ON "dataforseo_connection" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_rank_day_keyword_day_idx" ON "keyword_rank_day" USING btree ("site_keyword_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "site_keyword_site_phrase_idx" ON "site_keyword" USING btree ("site_id",lower("phrase")) WHERE "site_keyword"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "site_keyword_site_id_idx" ON "site_keyword" USING btree ("site_id");