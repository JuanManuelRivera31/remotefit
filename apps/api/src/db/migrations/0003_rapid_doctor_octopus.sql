ALTER TABLE "eligibility_results" ADD COLUMN "postprocess_version" text;--> statement-breakpoint
ALTER TABLE "eligibility_results" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "eligibility_results" ADD COLUMN "raw_output" jsonb;