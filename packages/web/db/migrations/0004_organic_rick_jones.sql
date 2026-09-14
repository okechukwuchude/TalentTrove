CREATE TABLE "judgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"posting_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"reasoning" text NOT NULL,
	"model" text NOT NULL,
	"judged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "judgments" ADD CONSTRAINT "judgments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "judgments_user_id_posting_id_key" ON "judgments" USING btree ("user_id","posting_id");