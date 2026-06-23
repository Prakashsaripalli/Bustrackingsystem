# BusTrackLive PWA Architecture

This project is now structured as one installable Progressive Web App with three protected role dashboards that share the existing backend, database tables, APIs, and Socket.IO server.

## Runtime Stack

- Frontend: Next.js React pages/components with Tailwind CSS.
- Backend: Next.js API routes served by the existing custom `server.js` Express + Socket.IO entrypoint.
- Database: Existing PostgreSQL + Drizzle schema is preserved. MongoDB is not introduced because the current app already uses PostgreSQL tables.
- Real-time layer: Existing Socket.IO events continue to carry live bus locations, emergency alerts, combine-bus alerts, and trip status.

## Recommended Folder Structure

```text
public/
  manifest.json
  sw.js
  icons/
src/
  app/
    student/page.tsx
    driver/page.tsx
    admin/page.tsx
    offline/page.tsx
    api/
      alerts/route.ts
      students/route.ts
      trips/route.ts
      buses/route.ts
      drivers/route.ts
      routes/route.ts
      auth/
  components/
    PWAController.tsx
    QRScanner.tsx
    TrackingMap.tsx
    DriverMap.tsx
    AdminMap.tsx
  context/AuthContext.tsx
  db/schema.ts
  services/socket.ts
  utils/routeDirection.ts
server.js
```

## Role Dashboards

- Student PWA: `/student`
  - Tracks the assigned bus only.
  - Shows route, ETA, live location, and bus-specific emergency/combine alerts.
  - Uses a notification bell with local unread count.
- Driver PWA: `/driver`
  - Restores login from the saved JWT session.
  - Supports fingerprint/passkey login when the browser supports WebAuthn.
  - Scans bus QR codes, auto-assigns the bus, starts the trip, and starts GPS.
  - Shows emergency/combine buttons only during an active trip.
  - Shows previously submitted alerts in Profile.
- Admin PWA: `/admin`
  - Manages buses, routes, drivers, students, assignments, trips, live map, and alerts.
  - Shows all emergency/combine alerts with unread count.
  - Can mark alerts as resolved.

## Authentication Workflow

1. User logs in through the existing auth flow.
2. JWT and user profile are stored in localStorage by `AuthContext`.
3. App refresh calls `/api/auth/refresh` and keeps users logged in for PWA usage.
4. Role guards block cross-role dashboard access:
   - Students can access `/student`.
   - Drivers can access `/driver`.
   - Admins can access `/admin`.
5. Driver fingerprint/passkey login uses the existing WebAuthn endpoints under `/api/auth/webauthn`.

## QR Bus Workflow

1. Driver opens installed PWA.
2. Session is restored or fingerprint login is used.
3. Driver scans the QR code inside the bus.
4. QR payload identifies `busId` and optional route name.
5. Driver page finds the matching bus/route from existing bus and route APIs.
6. Trip starts automatically through `/api/trips`.
7. Bus status becomes active through `/api/buses`.
8. GPS watch starts and emits `liveLocation`.
9. Students assigned to that bus see the live location.
10. Driver ends the trip, which records the real end time through the trip API.

## Notification Workflow

1. Driver submits an emergency alert during an active trip.
2. `/api/alerts` writes one admin-level notification and student-specific notifications for assigned students.
3. Socket.IO broadcasts `emergency-alert`.
4. Student dashboard only displays alerts matching the student's assigned bus.
5. Admin dashboard displays all bus alerts.
6. Admin can resolve an alert through `PATCH /api/alerts`.
7. Driver alert history displays whether admin resolved the alert.

## Database Relationships

- `users.assignedBusId` links a student to a bus.
- `users.boardingStop` stores the student pickup stop.
- `drivers.assignedBusId` links a driver to a bus.
- `drivers.preferredRouteId` links a driver to a preferred route.
- `buses.routeId` links a bus to a route.
- `buses.driverId` links a bus to a driver record.
- `trips.busId`, `trips.driverId`, and `trips.routeId` record each active/completed trip.
- `bus_locations.tripId` stores location history for a trip.
- `notifications.userId` targets students; `null` means admin-level bus alert.
- `notifications.driverId` records the driver who submitted the alert.
- `notifications.resolvedAt` and `notifications.resolvedBy` track admin resolution.

## Socket.IO Events

- `driver-connect`: driver joins a bus tracking session.
- `track-bus`: student/admin subscribes to a bus.
- `untrack-bus`: client leaves a bus tracking room.
- `liveLocation`: driver publishes GPS location.
- `bus-location-update`: clients receive live bus location.
- `trip-status`: driver publishes trip start/pause/complete.
- `trip-update`: clients receive trip state changes.
- `emergency-alert`: driver/admin/student alert delivery.
- `combine-bus`: combines another bus's students onto the primary running bus.

## PWA Configuration

- `public/manifest.json`: app name, display mode, colors, icons, role shortcuts.
- `public/sw.js`: app shell caching, offline fallback, network-first navigations, automatic updates.
- `src/components/PWAController.tsx`: service worker registration, install prompt, offline banner, update prompt.
- `src/app/offline/page.tsx`: offline splash screen.
- `next.config.ts`: service worker cache headers.

## Preservation Notes

- Existing pages, APIs, Socket.IO events, route calculations, tracking logic, and tables remain in place.
- New changes are additive: PWA files, student admin API, notification resolution columns, role guards, QR auto-start, and UI panels.
- The project keeps PostgreSQL because that is the current working database in this codebase.
