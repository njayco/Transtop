CREATE TABLE "transit_agencies" (
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transit_agencies_mode_id_pk" PRIMARY KEY("mode","id")
);
--> statement-breakpoint
CREATE TABLE "transit_alerts" (
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transit_alerts_mode_id_pk" PRIMARY KEY("mode","id")
);
--> statement-breakpoint
CREATE TABLE "transit_calendar_exceptions" (
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transit_calendar_exceptions_mode_id_pk" PRIMARY KEY("mode","id")
);
--> statement-breakpoint
CREATE TABLE "transit_calendars" (
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transit_calendars_mode_id_pk" PRIMARY KEY("mode","id")
);
--> statement-breakpoint
CREATE TABLE "transit_derived_estimates" (
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transit_derived_estimates_mode_id_pk" PRIMARY KEY("mode","id")
);
--> statement-breakpoint
CREATE TABLE "transit_feed_snapshots" (
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transit_feed_snapshots_mode_id_pk" PRIMARY KEY("mode","id")
);
--> statement-breakpoint
CREATE TABLE "transit_feed_sources" (
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transit_feed_sources_mode_id_pk" PRIMARY KEY("mode","id")
);
--> statement-breakpoint
CREATE TABLE "transit_location_samples" (
	"id" text PRIMARY KEY NOT NULL,
	"ride_id" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"accuracy" double precision NOT NULL,
	"progress" double precision NOT NULL,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transit_ride_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"contributor_hash" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"route_id" text NOT NULL,
	"direction" text NOT NULL,
	"stop_id" text NOT NULL,
	"trip_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_sample_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transit_rider_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"ride_id" text NOT NULL,
	"kind" text NOT NULL,
	"stop_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transit_routes" (
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transit_routes_mode_id_pk" PRIMARY KEY("mode","id")
);
--> statement-breakpoint
CREATE TABLE "transit_shapes" (
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transit_shapes_mode_id_pk" PRIMARY KEY("mode","id")
);
--> statement-breakpoint
CREATE TABLE "transit_stop_times" (
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"trip_id" text NOT NULL,
	"stop_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"arrival_seconds" integer NOT NULL,
	"departure_seconds" integer NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transit_stop_times_mode_id_pk" PRIMARY KEY("mode","id")
);
--> statement-breakpoint
CREATE TABLE "transit_stops" (
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transit_stops_mode_id_pk" PRIMARY KEY("mode","id")
);
--> statement-breakpoint
CREATE TABLE "transit_trips" (
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"agency" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transit_trips_mode_id_pk" PRIMARY KEY("mode","id")
);
--> statement-breakpoint
ALTER TABLE "transit_location_samples" ADD CONSTRAINT "transit_location_samples_ride_id_transit_ride_sessions_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."transit_ride_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_rider_reports" ADD CONSTRAINT "transit_rider_reports_ride_id_transit_ride_sessions_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."transit_ride_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transit_agencies_agency_idx" ON "transit_agencies" USING btree ("mode","agency");--> statement-breakpoint
CREATE INDEX "transit_alerts_agency_idx" ON "transit_alerts" USING btree ("mode","agency");--> statement-breakpoint
CREATE INDEX "transit_calendar_exceptions_agency_idx" ON "transit_calendar_exceptions" USING btree ("mode","agency");--> statement-breakpoint
CREATE INDEX "transit_calendars_agency_idx" ON "transit_calendars" USING btree ("mode","agency");--> statement-breakpoint
CREATE INDEX "transit_derived_estimates_agency_idx" ON "transit_derived_estimates" USING btree ("mode","agency");--> statement-breakpoint
CREATE INDEX "transit_feed_snapshots_agency_idx" ON "transit_feed_snapshots" USING btree ("mode","agency");--> statement-breakpoint
CREATE INDEX "transit_feed_sources_agency_idx" ON "transit_feed_sources" USING btree ("mode","agency");--> statement-breakpoint
CREATE INDEX "samples_ride_time_idx" ON "transit_location_samples" USING btree ("ride_id","timestamp");--> statement-breakpoint
CREATE INDEX "transit_routes_agency_idx" ON "transit_routes" USING btree ("mode","agency");--> statement-breakpoint
CREATE INDEX "transit_shapes_agency_idx" ON "transit_shapes" USING btree ("mode","agency");--> statement-breakpoint
CREATE INDEX "stop_times_lookup_idx" ON "transit_stop_times" USING btree ("mode","stop_id");--> statement-breakpoint
CREATE INDEX "stop_times_trip_idx" ON "transit_stop_times" USING btree ("mode","trip_id");--> statement-breakpoint
CREATE INDEX "transit_stops_agency_idx" ON "transit_stops" USING btree ("mode","agency");--> statement-breakpoint
CREATE INDEX "transit_trips_agency_idx" ON "transit_trips" USING btree ("mode","agency");