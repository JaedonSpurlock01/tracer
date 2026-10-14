ALTER TABLE "user" ADD COLUMN "last_sign_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "provisioned_by_user_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_provisioned_by_user_id_fk" FOREIGN KEY ("provisioned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;