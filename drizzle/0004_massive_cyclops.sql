CREATE TABLE "twilio_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_sid" text NOT NULL,
	"api_key_sid" text NOT NULL,
	"api_key_secret_ciphertext" text NOT NULL,
	"master_key_version" integer DEFAULT 1 NOT NULL,
	"account_friendly_name" text,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_detail" text,
	"numbers_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "twilio_connection_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "twilio_number" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"twilio_sid" text NOT NULL,
	"phone_number" text NOT NULL,
	"friendly_name" text NOT NULL,
	"voice_capable" boolean NOT NULL,
	"voice_url" text,
	"voice_method" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "twilio_connection" ADD CONSTRAINT "twilio_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twilio_connection" ADD CONSTRAINT "twilio_connection_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twilio_number" ADD CONSTRAINT "twilio_number_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "twilio_connection_organization_id_idx" ON "twilio_connection" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "twilio_number_organization_sid_idx" ON "twilio_number" USING btree ("organization_id","twilio_sid");--> statement-breakpoint
CREATE UNIQUE INDEX "twilio_number_active_phone_idx" ON "twilio_number" USING btree ("organization_id","phone_number") WHERE "twilio_number"."released_at" is null;--> statement-breakpoint
CREATE INDEX "twilio_number_organization_id_idx" ON "twilio_number" USING btree ("organization_id");