CREATE TABLE "max_files" (
	"token" text PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "max_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"max_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "max_users_max_user_id_unique" UNIQUE("max_user_id")
);
