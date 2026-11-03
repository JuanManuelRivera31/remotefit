ALTER TABLE "jobs" ADD COLUMN "prefilter_version" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "prefilter_outcome" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "prefilter_rule" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "prefilter_matched_text" text;