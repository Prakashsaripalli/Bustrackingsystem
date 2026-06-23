import {
  pgTable,
  serial,
  varchar,
  text,
  doublePrecision,
  timestamp,
  boolean,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";

// ─── Users (Students) ───
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).default("student").notNull(),
  phone: varchar("phone", { length: 20 }),
  parentContact: varchar("parent_contact", { length: 20 }),
  village: varchar("village", { length: 255 }),
  assignedBusId: varchar("assigned_bus_id", { length: 50 }),   // bus student boards
  boardingStop: varchar("boarding_stop", { length: 255 }),       // stop where student boards
  studentId: varchar("student_id", { length: 50 }),             // college roll number etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Drivers ───
export const drivers = pgTable("drivers", {
  id: serial("id").primaryKey(),
  driverId: varchar("driver_id", { length: 50 }).unique(),  // e.g. DRV001
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  licenseNo: varchar("license_no", { length: 255 }),
  photoUrl: varchar("photo_url", { length: 500 }),
  assignedBusId: varchar("assigned_bus_id", { length: 50 }),
  preferredRouteId: integer("preferred_route_id"),
  isActive: boolean("is_active").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Buses ───
export const buses = pgTable("buses", {
  id: serial("id").primaryKey(),
  busId: varchar("bus_id", { length: 50 }).notNull().unique(),
  busNumber: varchar("bus_number", { length: 50 }).notNull().unique(),
  plateNumber: varchar("plate_number", { length: 50 }),
  capacity: integer("capacity").default(60),
  routeId: integer("route_id").references(() => routes.id),
  driverId: integer("driver_id").references(() => drivers.id),
  qrCode: text("qr_code"),
  status: varchar("status", { length: 50 }).default("inactive"),
  isActive: boolean("is_active").default(true),
  lastLat: doublePrecision("last_lat"),
  lastLng: doublePrecision("last_lng"),
  lastSpeed: doublePrecision("last_speed"),
  lastUpdated: timestamp("last_updated"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Routes ───
export const routes = pgTable("routes", {
  id: serial("id").primaryKey(),
  routeName: varchar("route_name", { length: 255 }).notNull(),
  description: text("description"),
  stops: text("stops").array().notNull(), // Array of stop names
  stopCoordinates: jsonb("stop_coordinates"), // JSON array of {name, lat, lng}
  distance: doublePrecision("distance"), // km
  estimatedDuration: integer("estimated_duration"), // minutes
  isActive: boolean("is_active").default(true),
  isReversible: boolean("is_reversible").default(true), // morning/evening direction swap
  morningStart: varchar("morning_start", { length: 5 }).default("06:00"), // HH:MM
  eveningStart: varchar("evening_start", { length: 5 }).default("16:00"), // HH:MM
  morningCutoff: varchar("morning_cutoff", { length: 5 }).default("12:01"), // before this = morning trip
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Trips ───
export const trips = pgTable("trips", {
  id: serial("id").primaryKey(),
  busId: varchar("bus_id", { length: 50 }).notNull(),
  driverId: integer("driver_id").references(() => drivers.id),
  routeId: integer("route_id").references(() => routes.id),
  status: varchar("status", { length: 50 }).default("scheduled"), // scheduled, active, paused, completed, cancelled
  startTime: timestamp("start_time"),
  endTime: timestamp("end_time"),
  pausedAt: timestamp("paused_at"),
  totalDuration: integer("total_duration"), // seconds
  totalDistance: doublePrecision("total_distance"), // km
  emergencyAlert: boolean("emergency_alert").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Bus Locations (real-time tracking log) ───
export const busLocations = pgTable("bus_locations", {
  id: serial("id").primaryKey(),
  busId: varchar("bus_id", { length: 50 }).notNull(),
  tripId: integer("trip_id").references(() => trips.id),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  speed: doublePrecision("speed"),
  heading: doublePrecision("heading"),
  accuracy: doublePrecision("accuracy"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

// ─── Notifications ───
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  driverId: integer("driver_id").references(() => drivers.id),
  busId: varchar("bus_id", { length: 50 }),
  type: varchar("type", { length: 100 }).notNull(), // bus_arriving, delayed, trip_started, emergency, etc.
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Admins ───
export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).default("admin").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Complaints ───
export const complaints = pgTable("complaints", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => users.id).notNull(),
  reason: varchar("reason", { length: 255 }).notNull(),
  description: text("description").notNull(),
  status: varchar("status", { length: 50 }).default("pending").notNull(),
  adminExplanation: text("admin_explanation"),
  resolvedBy: integer("resolved_by").references(() => admins.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
