CREATE TABLE "search_location" (
	"code" integer PRIMARY KEY NOT NULL,
	"country_iso" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "keyword_rank_day" ADD COLUMN "check_status" text DEFAULT 'checked' NOT NULL;--> statement-breakpoint
ALTER TABLE "keyword_rank_day" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "keyword_rank_day" ADD COLUMN "matched_type" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "service_area_location_code" integer;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "service_area_location_name" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "last_sync_stage" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "last_sync_error" text;--> statement-breakpoint
CREATE INDEX "search_location_country_name_idx" ON "search_location" USING btree ("country_iso","name");