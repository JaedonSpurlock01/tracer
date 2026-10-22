CREATE TABLE "business" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text,
	"first_name" text,
	"last_name" text,
	"email" text,
	"niche" text,
	"website" text,
	"city" text,
	"city_latitude" double precision,
	"city_longitude" double precision,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_city_point_check" CHECK (("business"."city_latitude" is null) = ("business"."city_longitude" is null))
);
--> statement-breakpoint
ALTER TABLE "business" ADD CONSTRAINT "business_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business" ADD CONSTRAINT "business_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_workspace_idx" ON "business" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "business_organization_id_idx" ON "business" USING btree ("organization_id");