CREATE TABLE "llm_eval_reservation" (
	"id" integer PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_eval_reservation_single_row" CHECK ("llm_eval_reservation"."id" = 1)
);
