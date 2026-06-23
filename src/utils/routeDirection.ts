/**
 * Route Direction Utility
 * ──────────────────────
 * Morning trip: Village → College  (before morningCutoff, default 12:01)
 * Evening trip: College → Village  (from morningCutoff onward)
 *
 * The FIRST stop in the DB is always the Village (home) side.
 * The LAST stop is always the College (destination) side.
 *
 * Morning → normal order:   Jaggampeta → Nagaram → Surrampalem (AEC)
 * Evening → reversed order: Surrampalem (AEC) → Nagaram → Jaggampeta
 */

export interface Stop { name: string; lat: number; lng: number; }

export interface RouteWithDirection {
  id: number;
  routeName: string;
  stops: string[];
  stopCoordinates: Stop[] | string;
  distance?: number;
  estimatedDuration?: number;
  isReversible?: boolean;
  morningStart?:  string;   // "06:00"
  eveningStart?:  string;   // "16:00"
  morningCutoff?: string;   // "12:01" — before this = morning, from this time = evening
}

export type TripDirection = "morning" | "evening";

/** Get current direction based on local clock time */
export function getTripDirection(route: RouteWithDirection, now?: Date): TripDirection {
  const d      = now ?? new Date();
  const hhmm   = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const cutoff = route.morningCutoff ?? "12:01";
  return hhmm < cutoff ? "morning" : "evening";
}

/** Parse stopCoordinates whether it's an array or JSON string */
function parseStopCoords(raw: any): Stop[] {
  if (!raw) return [];
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return []; } }
  if (Array.isArray(raw)) return raw;
  return [];
}

/**
 * Returns stops in correct travel order for given direction.
 * Morning → [Village ... College]  (normal DB order)
 * Evening → [College ... Village]  (reversed)
 */
export function getDirectionalStops(route: RouteWithDirection, direction?: TripDirection): Stop[] {
  const dir   = direction ?? getTripDirection(route);
  const stops = parseStopCoords(route.stopCoordinates);
  return dir === "evening" ? [...stops].reverse() : [...stops];
}

/** Returns stop NAMES in correct travel order */
export function getDirectionalStopNames(route: RouteWithDirection, direction?: TripDirection): string[] {
  const dir   = direction ?? getTripDirection(route);
  const names = Array.isArray(route.stops) ? route.stops : [];
  return dir === "evening" ? [...names].reverse() : [...names];
}

/**
 * Human-readable "From → To" label.
 * Morning: "Jaggampeta → Surrampalem (AEC)"
 * Evening: "Surrampalem (AEC) → Jaggampeta"
 */
export function getDirectionLabel(route: RouteWithDirection, direction?: TripDirection): string {
  const dir   = direction ?? getTripDirection(route);
  const stops = parseStopCoords(route.stopCoordinates);
  if (stops.length === 0) return route.routeName;

  const from = dir === "morning" ? stops[0].name : stops[stops.length - 1].name;
  const to   = dir === "morning" ? stops[stops.length - 1].name : stops[0].name;
  return `${from} → ${to}`;
}

/**
 * Starting and ending point names clearly labelled.
 */
export function getStartEnd(route: RouteWithDirection, direction?: TripDirection): { start: string; end: string } {
  const dir   = direction ?? getTripDirection(route);
  const stops = parseStopCoords(route.stopCoordinates);
  if (stops.length === 0) return { start: "—", end: "—" };

  if (dir === "morning") {
    return {
      start: stops[0].name,                       // Village (home)
      end:   stops[stops.length - 1].name,        // College
    };
  } else {
    return {
      start: stops[stops.length - 1].name,        // College
      end:   stops[0].name,                       // Village (home)
    };
  }
}

/**
 * Badge info for morning / evening direction.
 */
export function getDirectionBadge(direction: TripDirection): {
  emoji: string; label: string; sublabel: string; color: string; bg: string;
} {
  return direction === "morning"
    ? { emoji: "🌅", label: "Morning Trip",  sublabel: "Village → College", color: "#92400E", bg: "#FEF3C7" }
    : { emoji: "🌆", label: "Evening Trip",  sublabel: "College → Village", color: "#5B21B6", bg: "#EDE9FE" };
}
