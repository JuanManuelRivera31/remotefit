CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ats" text NOT NULL,
	"board_token" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eligibility_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"decided_by" text NOT NULL,
	"label" text NOT NULL,
	"countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"work_model" text NOT NULL,
	"work_model_conflict" boolean DEFAULT false NOT NULL,
	"seniority" text,
	"min_years_experience" integer,
	"hiring_model" text,
	"timezone_requirement" text,
	"requires_us_work_authorization" boolean,
	"posting_language" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"equivalent_cost_usd" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fit_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"profile_id" integer NOT NULL,
	"scoring_version" text NOT NULL,
	"score" integer NOT NULL,
	"matched_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"breakdown" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"requisition_id" text,
	"sibling_group" text,
	"title" text NOT NULL,
	"location_raw" text,
	"workplace_type" text,
	"url" text NOT NULL,
	"description_text" text,
	"raw" jsonb,
	"content_hash" text NOT NULL,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage_daily" (
	"usage_date" date NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"rate_limited" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"equivalent_cost_usd" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "llm_usage_daily_usage_date_provider_model_pk" PRIMARY KEY("usage_date","provider","model")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"country" text NOT NULL,
	"cv_text" text,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seniority" text,
	"years_experience" integer,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fit_results" ADD CONSTRAINT "fit_results_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_results" ADD CONSTRAINT "fit_results_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eligibility_results_cache_uq" ON "eligibility_results" USING btree ("content_hash","prompt_version","model");--> statement-breakpoint
CREATE UNIQUE INDEX "fit_results_job_profile_version_uq" ON "fit_results" USING btree ("job_id","profile_id","scoring_version");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_source_external_id_uq" ON "jobs" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "jobs_is_active_idx" ON "jobs" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "jobs_last_seen_at_idx" ON "jobs" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "jobs_content_hash_idx" ON "jobs" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "jobs_sibling_group_idx" ON "jobs" USING btree ("sibling_group");