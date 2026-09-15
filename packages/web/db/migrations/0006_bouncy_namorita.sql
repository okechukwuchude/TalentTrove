CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"posting_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tailored_resumes" ADD COLUMN "cover_letter" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "tailored_resumes" ALTER COLUMN "cover_letter" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_user_id_posting_id_key" ON "applications" USING btree ("user_id","posting_id");