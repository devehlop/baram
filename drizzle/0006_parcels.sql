CREATE TABLE "parcels" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender_id" integer NOT NULL,
	"direction_id" integer NOT NULL,
	"from_side" text NOT NULL,
	"day" text NOT NULL,
	"time_kind" text NOT NULL,
	"exact_minutes" integer,
	"window_from" timestamp with time zone NOT NULL,
	"window_to" timestamp with time zone NOT NULL,
	"size" text NOT NULL,
	"contents" text NOT NULL,
	"valuable" boolean DEFAULT false NOT NULL,
	"from_locality_id" integer NOT NULL,
	"from_address" text,
	"from_lat" double precision,
	"from_lon" double precision,
	"to_locality_id" integer NOT NULL,
	"to_address" text,
	"to_lat" double precision,
	"to_lon" double precision,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"price" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"driver_id" integer,
	"trip_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_direction_id_directions_id_fk" FOREIGN KEY ("direction_id") REFERENCES "public"."directions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_from_locality_id_localities_id_fk" FOREIGN KEY ("from_locality_id") REFERENCES "public"."localities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_to_locality_id_localities_id_fk" FOREIGN KEY ("to_locality_id") REFERENCES "public"."localities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parcels_open" ON "parcels" USING btree ("status","direction_id");--> statement-breakpoint
CREATE INDEX "parcels_trip" ON "parcels" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "parcels_sender" ON "parcels" USING btree ("sender_id");