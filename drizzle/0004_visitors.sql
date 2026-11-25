CREATE TABLE "visitors" (
	"telegram_id" bigint PRIMARY KEY NOT NULL,
	"source" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "visitors_first_seen" ON "visitors" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "visitors_last_seen" ON "visitors" USING btree ("last_seen_at");--> statement-breakpoint
-- Кто зарегистрировался до появления таблицы, тот точно нажимал «Старт»: переносим их с датой регистрации.
INSERT INTO "visitors" ("telegram_id", "source", "first_seen_at", "last_seen_at")
SELECT "telegram_id", "source", "created_at", "created_at" FROM "users"
ON CONFLICT ("telegram_id") DO NOTHING;
