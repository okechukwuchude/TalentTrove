ALTER TABLE "postings" ADD COLUMN "country" text;--> statement-breakpoint
CREATE UNIQUE INDEX "postings_url_key" ON "postings" USING btree ("url");