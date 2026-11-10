CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"booked_by" integer,
	"passenger_user_id" integer,
	"passenger_name" text,
	"passenger_phone" text,
	"passenger_type" text DEFAULT 'adult' NOT NULL,
	"source" text DEFAULT 'bot' NOT NULL,
	"request_id" integer,
	"from_locality_id" integer,
	"from_address" text,
	"from_lat" double precision,
	"from_lon" double precision,
	"to_locality_id" integer,
	"to_address" text,
	"to_lat" double precision,
	"to_lon" double precision,
	"pickup_point" text,
	"seats" integer NOT NULL,
	"child_seat" text DEFAULT 'none' NOT NULL,
	"baggage" text DEFAULT 'bag' NOT NULL,
	"baggage_note" text,
	"comment" text,
	"price" integer DEFAULT 0 NOT NULL,
	"prepay_required" boolean DEFAULT false NOT NULL,
	"prepay_received_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"cancelled_by" text,
	"late_cancel" boolean DEFAULT false NOT NULL,
	"pickup_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"ask_sent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"no_answer_notified_at" timestamp with time zone,
	"prepay_warned_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "channel_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"direction_id" integer NOT NULL,
	"day" text NOT NULL,
	"message_id" integer NOT NULL,
	"last_text" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_user_id" integer NOT NULL,
	"against_user_id" integer,
	"booking_id" integer,
	"kind" text DEFAULT 'complaint' NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"note" text,
	"resolution" text,
	"handled_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversation_states" (
	"key" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directions" (
	"id" serial PRIMARY KEY NOT NULL,
	"city_a" text NOT NULL,
	"city_b" text NOT NULL,
	"travel_minutes" integer DEFAULT 120 NOT NULL,
	"channel_id" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_directions" (
	"driver_id" integer NOT NULL,
	"direction_id" integer NOT NULL,
	CONSTRAINT "driver_directions_driver_id_direction_id_pk" PRIMARY KEY("driver_id","direction_id")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"car" text NOT NULL,
	"car_year" integer NOT NULL,
	"car_color" text NOT NULL,
	"plate" text NOT NULL,
	"seats" integer NOT NULL,
	"child_seat" boolean DEFAULT false NOT NULL,
	"car_photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pay_phone" text NOT NULL,
	"pay_bank" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "localities" (
	"id" serial PRIMARY KEY NOT NULL,
	"direction_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"side" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privileges" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"kind" text NOT NULL,
	"until" timestamp with time zone,
	"granted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"direction_id" integer NOT NULL,
	"from_side" text NOT NULL,
	"day" text NOT NULL,
	"time_kind" text NOT NULL,
	"exact_minutes" integer,
	"window_from" timestamp with time zone NOT NULL,
	"window_to" timestamp with time zone NOT NULL,
	"passenger_name" text NOT NULL,
	"passenger_phone" text NOT NULL,
	"passenger_type" text DEFAULT 'adult' NOT NULL,
	"from_locality_id" integer NOT NULL,
	"from_address" text NOT NULL,
	"from_lat" double precision,
	"from_lon" double precision,
	"to_locality_id" integer NOT NULL,
	"to_address" text NOT NULL,
	"to_lat" double precision,
	"to_lon" double precision,
	"seats" integer NOT NULL,
	"child_seat" text DEFAULT 'none' NOT NULL,
	"baggage" text DEFAULT 'bag' NOT NULL,
	"baggage_note" text,
	"comment" text,
	"status" text DEFAULT 'open' NOT NULL,
	"taken_by" integer,
	"booking_id" integer,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "saved_addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"label" text NOT NULL,
	"locality_id" integer NOT NULL,
	"address" text NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_passengers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"type" text DEFAULT 'adult' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"direction_id" integer NOT NULL,
	"from_side" text NOT NULL,
	"departs_at" timestamp with time zone NOT NULL,
	"pickup_mode" text NOT NULL,
	"pickup_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"villages" boolean DEFAULT false NOT NULL,
	"villages_note" text,
	"seats_total" integer NOT NULL,
	"seats_free" integer NOT NULL,
	"trunk" text NOT NULL,
	"price" integer NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"departed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"username" text,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"active_role" text DEFAULT 'passenger' NOT NULL,
	"restriction" text DEFAULT 'none' NOT NULL,
	"restriction_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_passenger_user_id_users_id_fk" FOREIGN KEY ("passenger_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_from_locality_id_localities_id_fk" FOREIGN KEY ("from_locality_id") REFERENCES "public"."localities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_to_locality_id_localities_id_fk" FOREIGN KEY ("to_locality_id") REFERENCES "public"."localities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_posts" ADD CONSTRAINT "channel_posts_direction_id_directions_id_fk" FOREIGN KEY ("direction_id") REFERENCES "public"."directions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_against_user_id_users_id_fk" FOREIGN KEY ("against_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_directions" ADD CONSTRAINT "driver_directions_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_directions" ADD CONSTRAINT "driver_directions_direction_id_directions_id_fk" FOREIGN KEY ("direction_id") REFERENCES "public"."directions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "localities" ADD CONSTRAINT "localities_direction_id_directions_id_fk" FOREIGN KEY ("direction_id") REFERENCES "public"."directions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileges" ADD CONSTRAINT "privileges_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileges" ADD CONSTRAINT "privileges_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_direction_id_directions_id_fk" FOREIGN KEY ("direction_id") REFERENCES "public"."directions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_from_locality_id_localities_id_fk" FOREIGN KEY ("from_locality_id") REFERENCES "public"."localities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_to_locality_id_localities_id_fk" FOREIGN KEY ("to_locality_id") REFERENCES "public"."localities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_locality_id_localities_id_fk" FOREIGN KEY ("locality_id") REFERENCES "public"."localities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_passengers" ADD CONSTRAINT "saved_passengers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_direction_id_directions_id_fk" FOREIGN KEY ("direction_id") REFERENCES "public"."directions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_trip" ON "bookings" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "bookings_booked_by" ON "bookings" USING btree ("booked_by");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_posts_direction_day" ON "channel_posts" USING btree ("direction_id","day");--> statement-breakpoint
CREATE INDEX "complaints_status" ON "complaints" USING btree ("status");--> statement-breakpoint
CREATE INDEX "localities_direction" ON "localities" USING btree ("direction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "privileges_driver_kind" ON "privileges" USING btree ("driver_id","kind");--> statement-breakpoint
CREATE INDEX "requests_open" ON "requests" USING btree ("status","direction_id");--> statement-breakpoint
CREATE INDEX "saved_addresses_user" ON "saved_addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_passengers_user" ON "saved_passengers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trips_search" ON "trips" USING btree ("direction_id","from_side","departs_at");--> statement-breakpoint
CREATE INDEX "trips_driver" ON "trips" USING btree ("driver_id","departs_at");