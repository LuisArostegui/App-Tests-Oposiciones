CREATE TABLE "questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_id" text NOT NULL,
	"question_text" text NOT NULL,
	"answers" jsonb NOT NULL,
	"correct_answer" text NOT NULL,
	"category" text,
	"user_id" integer
);

CREATE TABLE "results" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_id" text NOT NULL,
	"score" integer NOT NULL,
	"correct_count" integer NOT NULL,
	"total_questions" integer NOT NULL,
	"completed_at" timestamp DEFAULT now(),
	"user_id" integer
);

CREATE TABLE "session" (
	"sid" text PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp (6) NOT NULL
);

CREATE TABLE "test_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_id" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"current_index" integer DEFAULT 0 NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"question_order" jsonb NOT NULL,
	"total_questions" integer NOT NULL,
	"correct_count" integer DEFAULT 0,
	"score" integer DEFAULT 0,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"user_id" integer
);

CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
