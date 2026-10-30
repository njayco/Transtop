import { pgTable, text, jsonb, timestamp, doublePrecision, integer, boolean, index, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// GTFS source records are retained without lossy column transformations.
// mode + id forms the boundary between examples and imported official records.
// For stop_times, mode may be an immutable import generation; live readers
// resolve feedSnapshots.data.stopTimesMode (missing means legacy "live").
const records = (name: string) => pgTable(name, {
  id: text("id").notNull(),
  mode: text("mode").notNull(),
  agency: text("agency").notNull(),
  data: jsonb("data").$type<Record<string, any>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.mode, t.id] }), index(`${name}_agency_idx`).on(t.mode, t.agency),
  ...(name==="transit_trips"?[index("transit_trips_route_idx").on(t.mode,t.agency,sql`(${t.data}->>'route_id')`)]:[])]);

export const agencies = records("transit_agencies");
export const feedSources = records("transit_feed_sources");
export const stops = records("transit_stops");
export const routes = records("transit_routes");
export const trips = records("transit_trips");
export const stopTimes = pgTable("transit_stop_times", {
  id: text("id").notNull(), mode: text("mode").notNull(), agency: text("agency").notNull(),
  tripId: text("trip_id").notNull(), stopId: text("stop_id").notNull(), sequence: integer("sequence").notNull(),
  arrivalSeconds: integer("arrival_seconds").notNull(), departureSeconds: integer("departure_seconds").notNull(),
  data: jsonb("data").$type<Record<string, any>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({columns:[t.mode,t.id]}), index("stop_times_lookup_idx").on(t.mode,t.stopId), index("stop_times_trip_idx").on(t.mode,t.tripId)]);
export const calendars = records("transit_calendars");
export const calendarExceptions = records("transit_calendar_exceptions");
export const shapes = records("transit_shapes");
export const feedSnapshots = records("transit_feed_snapshots");
export const alerts = records("transit_alerts");
export const derivedEstimates = records("transit_derived_estimates");

export const rideSessions = pgTable("transit_ride_sessions", {
  id: text("id").primaryKey(), tokenHash: text("token_hash").notNull(), contributorHash: text("contributor_hash").notNull(),
  mode: text("mode").notNull(), agency: text("agency").notNull(), routeId: text("route_id").notNull(),
  direction: text("direction").notNull(), stopId: text("stop_id").notNull(), tripId: text("trip_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", {withTimezone:true}).notNull(),
  lastSampleAt: timestamp("last_sample_at", {withTimezone:true}),
});
export const locationSamples = pgTable("transit_location_samples", {
  id: text("id").primaryKey(), rideId: text("ride_id").notNull().references(() => rideSessions.id, {onDelete:"cascade"}),
  lat: doublePrecision("lat").notNull(), lon: doublePrecision("lon").notNull(), accuracy: doublePrecision("accuracy").notNull(),
  progress: doublePrecision("progress").notNull(), timestamp: timestamp("timestamp",{withTimezone:true}).notNull(),
}, t => [index("samples_ride_time_idx").on(t.rideId,t.timestamp)]);
export const riderReports = pgTable("transit_rider_reports", {
  id: text("id").primaryKey(), rideId: text("ride_id").notNull().references(() => rideSessions.id, {onDelete:"cascade"}),
  kind: text("kind").notNull(), stopId: text("stop_id").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
});
