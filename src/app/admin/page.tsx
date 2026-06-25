"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { getSocket } from "@/services/socket";
import { getDirectionBadge, getTripDirection } from "@/utils/routeDirection";
import dynamic from "next/dynamic";
import type { BuilderStop } from "@/components/RouteBuilderMap";

const AdminMap = dynamic(() => import("@/components/AdminMap"), { ssr: false });
const RouteBuilderMap = dynamic(() => import("@/components/RouteBuilderMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[580px] bg-gray-100 rounded-2xl flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-4 border-[#2563EB] border-t-transparent rounded-full" />
    </div>
  ),
});

/* ─── types ─── */
interface Bus { id: number; busId: string; busNumber: string; plateNumber: string; capacity: number; routeId: number | null; driverId: number | null; status: string; isActive: boolean; route?: any; driver?: any; }
interface Route { id: number; routeName: string; stops: string[]; stopCoordinates?: any; isActive: boolean; isReversible?: boolean; morningCutoff?: string; eveningStart?: string; distance?: number; estimatedDuration?: number; }
interface Driver { id: number; driverId: string; name: string; email: string; phone: string; licenseNo: string; assignedBusId: string; isActive: boolean; }
interface Student { id: number; name: string; email: string; phone?: string | null; parentContact?: string | null; village?: string | null; assignedBusId?: string | null; boardingStop?: string | null; studentId?: string | null; createdAt?: string; }
interface Trip { id: number; busId: string; driverId: number; routeId: number; status: string; startTime: string; endTime?: string; driverName?: string; driverUid?: string; driverPhone?: string; routeName?: string; emergencyAlert?: boolean; }
interface ActiveBus { busId: string; lat: number; lng: number; speed: number; lastUpdated: string; routeName?: string; driverName?: string; }
interface AlertNotification { id?: number; busId?: string; title: string; message: string; createdAt?: string; timestamp?: string; isRead?: boolean | null; resolvedAt?: string | null; resolvedBy?: number | null; }

type Tab = "overview" | "buses" | "routes" | "drivers" | "students" | "trips" | "map" | "complaints";

function Badge({ active, label }: { active: boolean; label?: string }) {
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
      {label ?? (active ? "Active" : "Inactive")}
    </span>
  );
}

function normalizeSearch(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

const INDIA_TIME_ZONE = "Asia/Kolkata";

function formatDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function normalizeAlert(data: any): AlertNotification {
  return {
    id: data.id,
    busId: data.busId,
    title: data.title || `🚨 ${data.label || "Emergency"} - ${data.busId || "Bus"}`,
    message: data.message || data.reason || "Emergency alert from driver",
    createdAt: data.createdAt || data.timestamp || new Date().toISOString(),
    timestamp: data.timestamp,
    isRead: data.isRead,
    resolvedAt: data.resolvedAt,
    resolvedBy: data.resolvedBy,
  };
}

function alertKey(alert: AlertNotification): string {
  return String(alert.id ?? `${alert.busId ?? "bus"}-${alert.title}-${alert.createdAt ?? alert.timestamp ?? ""}`);
}

function showWebNotification(title: string, body: string) {
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch (e) {
      console.error("Error creating Notification:", e);
    }
  }
}

function getDirectionalRouteStops(route: Route): string[] {
  const stops = route.stops ?? [];
  const direction = getTripDirection(route as any);
  return direction === "evening" ? [...stops].reverse() : [...stops];
}

export default function AdminDashboard() {
  const { user, isAuthenticated, loading: authLoading, logout, token } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");

  /* data */
  const [buses,      setBuses]      = useState<Bus[]>([]);
  const [routes,     setRoutes]     = useState<Route[]>([]);
  const [drivers,    setDrivers]    = useState<Driver[]>([]);
  const [students,   setStudents]   = useState<Student[]>([]);
  const [trips,      setTrips]      = useState<Trip[]>([]);
  const [activeBuses,setActiveBuses]= useState<ActiveBus[]>([]);
  const [alerts,     setAlerts]     = useState<AlertNotification[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [seenAlertKeys, setSeenAlertKeys] = useState<Set<string>>(new Set());
  const [loading,    setLoading]    = useState(true);
  const [msg,        setMsg]        = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const [mapSearch,  setMapSearch]  = useState("");
  const [mapSelectedBus, setMapSelectedBus] = useState<string | null>(null);

  /* complaints states */
  interface Complaint {
    id: number;
    studentId: number;
    reason: string;
    description: string;
    status: string;
    adminExplanation: string | null;
    resolvedAt: string | null;
    createdAt: string;
    studentName?: string;
    studentEmail?: string;
    studentRollNumber?: string;
  }
  const [complaintsList, setComplaintsList] = useState<Complaint[]>([]);
  const [complaintsLoading, setComplaintsLoading] = useState(false);
  const [resolvingComplaintId, setResolvingComplaintId] = useState<number | null>(null);
  const [adminExplanationText, setAdminExplanationText] = useState("");
  const [complaintSearch, setComplaintSearch] = useState("");

  /* form states */
  const [busForm, setBusForm] = useState({ busId: "", busNumber: "", plateNumber: "", capacity: "60", routeId: "", driverId: "" });
  const [routeForm, setRouteForm] = useState({ routeName: "", stops: "", distance: "", estimatedDuration: "" });
  const [driverForm, setDriverForm] = useState({ name: "", email: "", password: "", phone: "", licenseNo: "", assignedBusId: "" });
  const [studentForm, setStudentForm] = useState({ studentId: "", name: "", email: "", password: "", phone: "", parentContact: "", village: "", assignedBusId: "", boardingStop: "" });
  const [tripSearch,       setTripSearch]       = useState("");
  const [studentSearch,    setStudentSearch]    = useState("");
  const [busSearch,        setBusSearch]        = useState("");
  const [driverSearch,     setDriverSearch]     = useState("");
  const [routeSearch,      setRouteSearch]      = useState("");
  const [editingBusId,     setEditingBusId]     = useState<string | null>(null);
  const [editingRouteId,   setEditingRouteId]   = useState<number | null>(null);
  const [editingDriverId,  setEditingDriverId]  = useState<number | null>(null);
  const [editingStudentId, setEditingStudentId] = useState<number | null>(null);
  const [saving,           setSaving]           = useState(false);
  const [adminBuilderRouteId, setAdminBuilderRouteId] = useState<number | null>(null);
  const [showAdminBuilder,    setShowAdminBuilder]    = useState(false);
  const [adminLoc,            setAdminLoc]            = useState<{ lat: number; lng: number } | null>(null);

  const getBusInfo = useCallback((busId: string) => buses.find(bus => bus.busId === busId), [buses]);
  const selectedFormBus = buses.find(bus => bus.busId === studentForm.assignedBusId);
  const formStops = selectedFormBus?.route?.stops ?? [];

  const filteredMapBuses = activeBuses.filter(activeBus => {
    const query = normalizeSearch(mapSearch.trim());
    if (!query) return true;
    const busInfo = getBusInfo(activeBus.busId);
    const routeStops = busInfo?.route?.stops?.join(" ") ?? "";
    const visibleText = [
      activeBus.busId,
      busInfo?.busNumber,
      busInfo?.plateNumber,
      activeBus.routeName,
      busInfo?.route?.routeName,
      routeStops,
      activeBus.driverName,
      busInfo?.driver?.name,
      busInfo?.driver?.driverId,
      busInfo?.driver?.phone,
      activeBus.speed?.toFixed?.(1),
      activeBus.lat?.toFixed?.(5),
      activeBus.lng?.toFixed?.(5),
      formatTime(activeBus.lastUpdated),
      formatDateTime(activeBus.lastUpdated),
      "live",
    ].map(normalizeSearch).join(" ");
    return visibleText.includes(query);
  });
  const visibleMapBuses = mapSearch.trim() ? filteredMapBuses : activeBuses;
  const recentTrips = trips.slice(0, 5);

  /* filtered trips */
  const filteredTrips = trips.filter(t => {
    const query = normalizeSearch(tripSearch.trim());
    if (!query) return true;
    const visibleText = [
      `#${t.id}`,
      t.id,
      t.busId,
      t.driverId,
      t.driverName,
      t.driverUid,
      t.driverPhone,
      t.routeId,
      t.routeName,
      t.status,
      t.emergencyAlert ? "emergency alert" : "",
      formatDateTime(t.startTime),
      formatTime(t.startTime),
      formatDateTime(t.endTime),
      formatTime(t.endTime),
    ].map(normalizeSearch).join(" ");
    return visibleText.includes(query);
  });

  const filteredStudents = students.filter(student => {
    const query = normalizeSearch(studentSearch.trim());
    if (!query) return true;
    const assignedBus = buses.find(bus => bus.busId === student.assignedBusId);
    const visibleText = [
      student.studentId,
      student.name,
      student.email,
      student.phone,
      student.parentContact,
      student.village,
      student.assignedBusId,
      student.boardingStop,
      assignedBus?.busNumber,
      assignedBus?.route?.routeName,
    ].map(normalizeSearch).join(" ");
    return visibleText.includes(query);
  });

  const filteredBuses = buses.filter(bus => {
    const query = normalizeSearch(busSearch.trim());
    if (!query) return true;
    const visibleText = [
      bus.busId,
      bus.busNumber,
      bus.plateNumber,
      bus.capacity,
      bus.route?.routeName,
      bus.driver?.name,
    ].map(normalizeSearch).join(" ");
    return visibleText.includes(query);
  });

  const filteredDrivers = drivers.filter(driver => {
    const query = normalizeSearch(driverSearch.trim());
    if (!query) return true;
    const visibleText = [
      driver.driverId,
      driver.name,
      driver.email,
      driver.phone,
      driver.licenseNo,
      driver.assignedBusId,
    ].map(normalizeSearch).join(" ");
    return visibleText.includes(query);
  });

  const filteredRoutes = routes.filter(route => {
    const query = normalizeSearch(routeSearch.trim());
    if (!query) return true;
    const visibleText = [
      route.routeName,
      route.stops?.join(" "),
    ].map(normalizeSearch).join(" ");
    return visibleText.includes(query);
  });

  const flash = useCallback((text: string, type: "ok" | "err" = "ok") => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  }, []);

  /* ── load data ── */
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, rRes, dRes, sRes, tRes] = await Promise.all([
        fetch("/api/buses?all=true"),
        fetch("/api/routes"),
        fetch("/api/drivers"),
        fetch("/api/students", { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
        fetch("/api/trips"),
      ]);
      const isJson = (r: Response) => r.ok && (r.headers.get("content-type") ?? "").includes("json");
      const busData = isJson(bRes) ? await bRes.json() : [];
      setBuses(busData);
      if (isJson(rRes)) setRoutes(await rRes.json());
      if (isJson(dRes)) setDrivers(await dRes.json());
      if (isJson(sRes)) setStudents(await sRes.json());
      if (isJson(tRes)) setTrips(await tRes.json());

      // Enrich activeBuses with route/driver info from fresh bus data
      setActiveBuses(prev => prev.map(ab => {
        const busInfo = busData.find((b: Bus) => b.busId === ab.busId);
        return {
          ...ab,
          routeName: busInfo?.route?.routeName ?? ab.routeName,
          driverName: busInfo?.driver?.name ?? ab.driverName,
        };
      }));
    } catch { flash("Failed to load data", "err"); }
    finally { setLoading(false); }
  }, [flash, token]);

  /* keep a ref to latest buses for enriching live data */
  const busesRef = useRef<Bus[]>([]);
  useEffect(() => {
    busesRef.current = buses;
  }, [buses]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation || !isAuthenticated || user?.role !== "admin" || tab !== "map") return;

    const watchId = navigator.geolocation.watchPosition(
      pos => {
        setAdminLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      err => {
        console.warn("Admin geolocation watch error:", err);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 4000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [isAuthenticated, user?.role, tab]);

  const loadAlerts = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/alerts", { headers: { Authorization: `Bearer ${token}` } });
      const data = res.ok && res.headers.get("content-type")?.includes("json") ? await res.json() : [];
      setAlerts(Array.isArray(data) ? data.map(normalizeAlert) : []);
    } catch { /* keep dashboard usable */ }
  }, [token]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = localStorage.getItem(`admin_alerts_seen_${user.id}`);
      setSeenAlertKeys(new Set(raw ? JSON.parse(raw) : []));
    } catch {
      setSeenAlertKeys(new Set());
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadAll();
    loadAlerts();

    const socket = getSocket();

    /* ── Live location: add/update in activeBuses ── */
    socket.on("bus-location-update", (data: any) => {
      setActiveBuses(prev => {
        const idx = prev.findIndex(b => b.busId === data.busId);
        const busInfo = busesRef.current.find(b => b.busId === data.busId);
        const updated: ActiveBus = {
          busId:      data.busId,
          lat:        data.lat,
          lng:        data.lng,
          speed:      data.speed || 0,
          lastUpdated: data.timestamp || new Date().toISOString(),
          routeName:  busInfo?.route?.routeName,
          driverName: busInfo?.driver?.name,
        };
        if (idx >= 0) {
          const a = [...prev];
          a[idx] = { ...a[idx], ...updated };
          return a;
        }
        return [...prev, updated];
      });
    });

    /* ── Bus status: active → add to live list; inactive/disconnected → remove ── */
    socket.on("bus-status", (d: any) => {
      if (d.status === "active") {
        // Bus just became active — ensure it appears in live count
        setActiveBuses(prev => {
          if (prev.find(b => b.busId === d.busId)) return prev;
          const busInfo = busesRef.current.find(b => b.busId === d.busId);
          return [...prev, {
            busId: d.busId, lat: 0, lng: 0, speed: 0,
            lastUpdated: d.timestamp || new Date().toISOString(),
            routeName:  busInfo?.route?.routeName,
            driverName: busInfo?.driver?.name,
          }];
        });
      } else if (d.status === "inactive" || d.status === "disconnected") {
        setActiveBuses(prev => prev.filter(b => b.busId !== d.busId));
        loadAll(); // refresh trips table to show end time
      }
    });

    /* ── Full list broadcast from server ── */
    socket.on("active-buses-list", (list: any[]) => {
      setActiveBuses(list.map(b => {
        const busInfo = busesRef.current.find(bus => bus.busId === b.busId);
        return {
          ...b,
          routeName:  busInfo?.route?.routeName ?? b.routeName,
          driverName: busInfo?.driver?.name     ?? b.driverName,
        };
      }));
    });

    /* ── Trip update: refresh trips data ── */
    socket.on("trip-update", () => loadAll());
    socket.on("route-updated", () => loadAll());

    const onAdminEmergency = (data: any) => {
      const normalized = normalizeAlert(data);
      setAlerts(prev => [normalized, ...prev.filter(alert => alert.id !== data.id)].slice(0, 50));
      loadAll();
      showWebNotification(normalized.title, normalized.message);
    };
    const onAdminBusCombined = (data: any) => {
      const normalized = normalizeAlert(data);
      setAlerts(prev => [normalized, ...prev.filter(alert => alert.id !== data.id)].slice(0, 50));
      loadAll();
      socket.emit("get-active-buses");
      showWebNotification(normalized.title, normalized.message);
    };
    socket.on("admin-emergency", onAdminEmergency);
    socket.on("admin-bus-combined", onAdminBusCombined);

    return () => {
      socket.off("bus-location-update");
      socket.off("bus-status");
      socket.off("active-buses-list");
      socket.off("trip-update");
      socket.off("route-updated");
      socket.off("admin-emergency", onAdminEmergency);
      socket.off("admin-bus-combined", onAdminBusCombined);
    };
  }, [isAuthenticated, loadAll, loadAlerts]);

  const loadComplaints = useCallback(async () => {
    if (!token) return;
    setComplaintsLoading(true);
    try {
      const res = await fetch("/api/complaints", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok && res.headers.get("content-type")?.includes("json")) {
        setComplaintsList(await res.json());
      }
    } catch { /* ignore */ }
    finally { setComplaintsLoading(false); }
  }, [token]);

  useEffect(() => {
    if (isAuthenticated && tab === "complaints") {
      loadComplaints();
    }
  }, [isAuthenticated, tab, loadComplaints]);

  const resolveComplaint = async (id: number) => {
    if (!adminExplanationText.trim()) {
      flash("Please provide an explanation for resolution", "err");
      return;
    }
    try {
      const res = await fetch("/api/complaints", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          id,
          adminExplanation: adminExplanationText,
          status: "resolved"
        })
      });
      if (res.ok) {
        flash("✅ Complaint resolved successfully!");
        setResolvingComplaintId(null);
        setAdminExplanationText("");
        loadComplaints();
      } else {
        const data = await res.json();
        flash(data.error || "Failed to resolve complaint", "err");
      }
    } catch {
      flash("Network error. Please try again.", "err");
    }
  };

  /* ── safe JSON helper ── */
  const safeJson = async (res: Response) => {
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) throw new Error(`Server error ${res.status}`);
    return res.json();
  };

  const resetBusForm = () => {
    setBusForm({ busId: "", busNumber: "", plateNumber: "", capacity: "60", routeId: "", driverId: "" });
    setEditingBusId(null);
  };

  /* ── add/update bus ── */
  const saveBus = async () => {
    if (!busForm.busId || !busForm.busNumber) return flash("Bus ID and Number are required", "err");
    setSaving(true);
    try {
      const res = await fetch("/api/buses", {
        method: editingBusId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...busForm, capacity: parseInt(busForm.capacity) }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || "Failed to save bus");
      flash(editingBusId ? `✅ Bus ${busForm.busId} updated` : `✅ Bus ${busForm.busId} added! ID: ${data.busId}`);
      resetBusForm();
      loadAll();
    } catch (e: any) { flash(e.message, "err"); }
    finally { setSaving(false); }
  };

  const editBus = (bus: Bus) => {
    setEditingBusId(bus.busId);
    setBusForm({
      busId: bus.busId,
      busNumber: bus.busNumber || "",
      plateNumber: bus.plateNumber || "",
      capacity: String(bus.capacity || 60),
      routeId: bus.routeId ? String(bus.routeId) : "",
      driverId: bus.driverId ? String(bus.driverId) : "",
    });
  };

  /* ── toggle bus status ── */
  const toggleBus = async (busId: string, cur: boolean) => {
    const res = await fetch("/api/buses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ busId, isActive: !cur }),
    });
    if (res.ok) { flash(`Bus ${busId} ${!cur ? "activated" : "deactivated"}`); loadAll(); }
    else flash("Failed to update bus", "err");
  };

  /* ── delete bus ── */
  const deleteBus = async (busId: string) => {
    if (!confirm(`Delete bus ${busId}?`)) return;
    const res = await fetch(`/api/buses?busId=${busId}`, { method: "DELETE" });
    if (res.ok) { flash(`Bus ${busId} deleted`); loadAll(); }
    else flash("Failed to delete bus", "err");
  };

  const resetRouteForm = () => {
    setRouteForm({ routeName: "", stops: "", distance: "", estimatedDuration: "" });
    setEditingRouteId(null);
  };

  /* ── add/update route ── */
  const saveRoute = async () => {
    if (!routeForm.routeName || !routeForm.stops) return flash("Route name and stops required", "err");
    const stopsArr = routeForm.stops.split(",").map(s => s.trim()).filter(Boolean);
    if (stopsArr.length < 2) return flash("At least 2 stops required", "err");
    setSaving(true);
    try {
      const res = await fetch("/api/routes", {
        method: editingRouteId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingRouteId, routeName: routeForm.routeName, stops: stopsArr, distance: routeForm.distance || null, estimatedDuration: routeForm.estimatedDuration || null }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || "Failed to save route");
      flash(editingRouteId ? `✅ Route "${routeForm.routeName}" updated` : `✅ Route "${routeForm.routeName}" added`);
      if (editingRouteId) {
        getSocket().emit("route-updated", { routeId: editingRouteId });
      }
      resetRouteForm();
      loadAll();
    } catch (e: any) { flash(e.message, "err"); }
    finally { setSaving(false); }
  };

  const editRoute = (route: Route) => {
    setEditingRouteId(route.id);
    setRouteForm({
      routeName: route.routeName || "",
      stops: route.stops?.join(", ") || "",
      distance: route.distance ? String(route.distance) : "",
      estimatedDuration: route.estimatedDuration ? String(route.estimatedDuration) : "",
    });
  };

  /* ── delete route ── */
  const deleteRoute = async (id: number) => {
    if (!confirm("Delete this route?")) return;
    const res = await fetch(`/api/routes?id=${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { flash("Route deleted"); loadAll(); }
    else flash(data.error || "Failed to delete route", "err");
  };

  const resetDriverForm = () => {
    setDriverForm({ name: "", email: "", password: "", phone: "", licenseNo: "", assignedBusId: "" });
    setEditingDriverId(null);
  };

  /* ── add/update driver ── */
  const saveDriver = async () => {
    if (!driverForm.name || !driverForm.email || (!editingDriverId && !driverForm.password)) return flash("Name, email, password required", "err");
    if (driverForm.password && driverForm.password.length < 6) return flash("Password must be at least 6 characters long", "err");
    if (driverForm.phone && !/^\d{10}$/.test(driverForm.phone.trim())) return flash("Driver phone number must be exactly 10 digits", "err");
    setSaving(true);
    try {
      const res = await fetch("/api/drivers", {
        method: editingDriverId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingDriverId, ...driverForm, password: driverForm.password || undefined }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || "Failed to save driver");
      flash(editingDriverId ? `✅ Driver "${data.name}" updated` : `✅ Driver "${data.name}" added! ID: ${data.driverId}`);
      resetDriverForm();
      loadAll();
    } catch (e: any) { flash(e.message, "err"); }
    finally { setSaving(false); }
  };

  const editDriver = (driver: Driver) => {
    setEditingDriverId(driver.id);
    setDriverForm({
      name: driver.name || "",
      email: driver.email || "",
      password: "",
      phone: driver.phone || "",
      licenseNo: driver.licenseNo || "",
      assignedBusId: driver.assignedBusId || "",
    });
  };

  /* ── delete driver ── */
  const deleteDriver = async (id: number) => {
    if (!confirm("Delete this driver?")) return;
    const res = await fetch(`/api/drivers?id=${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { flash("Driver deleted"); loadAll(); }
    else flash(data.error || "Failed to delete driver", "err");
  };

  /* ── assign bus to driver ── */
  const assignBusToDriver = async (driverId: number, busId: string) => {
    await fetch("/api/drivers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: driverId, assignedBusId: busId || null }),
    });
    flash("Assignment updated"); loadAll();
  };

  const resetStudentForm = () => {
    setStudentForm({
      studentId: "",
      name: "",
      email: "",
      password: "",
      phone: "",
      parentContact: "",
      village: "",
      assignedBusId: "",
      boardingStop: "",
    });
    setEditingStudentId(null);
  };

  const saveStudent = async () => {
    if (!studentForm.name || !studentForm.email || (!editingStudentId && !studentForm.password)) {
      return flash("Name, email, and password (for new students) are required", "err");
    }
    if (studentForm.password && studentForm.password.length < 6) return flash("Password must be at least 6 characters long", "err");
    if (studentForm.phone && !/^\d{10}$/.test(studentForm.phone.trim())) return flash("Student phone number must be exactly 10 digits", "err");
    if (studentForm.parentContact && !/^\d{10}$/.test(studentForm.parentContact.trim())) return flash("Parent contact number must be exactly 10 digits", "err");
    setSaving(true);
    try {
      const res = await fetch("/api/students", {
        method: editingStudentId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: editingStudentId || undefined,
          ...studentForm,
          password: studentForm.password || undefined,
        }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || "Failed to save student");
      flash(editingStudentId ? `✅ Student "${studentForm.name}" updated` : `✅ Student "${studentForm.name}" added`);
      resetStudentForm();
      loadAll();
    } catch (e: any) {
      flash(e.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const editStudent = (student: Student) => {
    setEditingStudentId(student.id);
    setStudentForm({
      studentId: student.studentId || "",
      name: student.name || "",
      email: student.email || "",
      password: "",
      phone: student.phone || "",
      parentContact: student.parentContact || "",
      village: student.village || "",
      assignedBusId: student.assignedBusId || "",
      boardingStop: student.boardingStop || "",
    });
  };

  const deleteStudent = async (id: number) => {
    if (!token) return flash("Admin token missing. Please login again.", "err");
    if (!confirm("Delete this student login?")) return;
    const res = await fetch(`/api/students?id=${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return flash(data.error || "Failed to delete student", "err");
    setStudents(prev => prev.filter(student => student.id !== id));
    flash("Student deleted");
  };

  const deleteTrip = async (id: number) => {
    if (!confirm(`Delete trip #${id}?`)) return;
    const res = await fetch(`/api/trips?id=${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return flash(data.error || "Failed to delete trip", "err");
    setTrips(prev => prev.filter(trip => trip.id !== id));
    flash("Trip deleted");
  };

  const markAlertResolved = async (alert: AlertNotification) => {
    if (!token || !alert.id) return;
    const res = await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: alert.id, resolved: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return flash(data.error || "Failed to resolve alert", "err");
    const updatedAlert = normalizeAlert(data);
    setAlerts(prev => prev.map(item => item.id === alert.id ? updatedAlert : item));
    getSocket().emit("resolve-alert", {
      id: alert.id,
      busId: updatedAlert.busId || alert.busId,
      resolvedAt: updatedAlert.resolvedAt,
    });
    flash("Alert marked resolved");
  };

  /* ─── ACCESS GUARD ─── */
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F8FAFC] to-[#DBEAFE]">
        <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F8FAFC] to-[#DBEAFE]">
        <div className="card text-center p-10 max-w-sm">
          <div className="w-16 h-16 bg-[#2563EB] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
          </div>
          <h2 className="text-xl font-bold mb-2">Admin Access Required</h2>
          <a href="/" className="btn-primary inline-block mt-4">Go to Home</a>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "overview",   label: "Overview",   icon: "📊" },
    { id: "map",        label: "Live Map",   icon: "🗺️" },
    { id: "buses",      label: "Buses",      icon: "🚍" },
    { id: "routes",     label: "Routes",     icon: "📍" },
    { id: "drivers",    label: "Drivers",    icon: "👨‍✈️" },
    { id: "students",   label: "Students",   icon: "🎓" },
    { id: "complaints", label: "Complaints", icon: "📋" },
    { id: "trips",      label: "Trips",      icon: "⏱" },
  ];
  const unseenAlertCount = alerts.filter(alert => !seenAlertKeys.has(alertKey(alert))).length;
  const openAlerts = () => {
    const nextSeen = new Set(seenAlertKeys);
    alerts.forEach(alert => nextSeen.add(alertKey(alert)));
    setSeenAlertKeys(nextSeen);
    if (user?.id) localStorage.setItem(`admin_alerts_seen_${user.id}`, JSON.stringify([...nextSeen]));
    setShowAlerts(true);
  };

  return (
    <div className="min-h-screen bg-[#F1F5F9]">
      {/* Header */}
      <header className="glass border-b border-[#DBEAFE] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center bg-white border border-gray-100 shadow-sm">
                <img src="/aditya-logo.png" alt="Aditya University Logo" className="w-full h-full object-contain p-0.5" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-[#1E293B]">Admin Dashboard</h1>
                <p className="text-xs text-gray-500">{user?.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={openAlerts}
                className={`relative flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border ${
                  unseenAlertCount ? "bg-red-50 text-red-700 border-red-200" : "bg-white text-gray-500 border-gray-200"
                }`}>
                🚨 Alerts
                {unseenAlertCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-600 text-white text-[10px] min-w-5 h-5 px-1 rounded-full flex items-center justify-center">
                    {unseenAlertCount > 9 ? "9+" : unseenAlertCount}
                  </span>
                )}
              </button>
              {activeBuses.length > 0 && (
                <span className="flex items-center gap-1.5 text-xs font-semibold bg-green-100 text-green-700 px-3 py-1.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full pulse-dot"/>
                  {activeBuses.length} Live
                </span>
              )}
              <button onClick={logout} className="text-sm text-gray-400 hover:text-red-500 font-medium">Logout</button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* Flash message */}
        {msg && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium flex items-center justify-between animate-slide-up ${msg.type === "ok" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            <span>{msg.text}</span>
            <button onClick={() => setMsg(null)} className="text-lg leading-none opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex bg-white rounded-2xl p-1.5 shadow-sm mb-6 overflow-x-auto gap-1">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-semibold rounded-xl transition-all whitespace-nowrap ${tab === t.id ? "bg-[#2563EB] text-white shadow-md" : "text-gray-500 hover:text-[#1E293B] hover:bg-gray-50"}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin h-10 w-10 border-4 border-[#2563EB] border-t-transparent rounded-full"/>
          </div>
        ) : (<>

        {/* ══════════ OVERVIEW ══════════ */}
        {tab === "overview" && (
          <div className="space-y-6 animate-fade-in">
            {/* Welcome Banner */}
            <div className="bg-gradient-to-r from-[#0F172A] via-[#1E293B] to-[#334155] rounded-2xl p-6 text-white shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black">Welcome back, {user?.name || "Admin"}!</h2>
                  <p className="text-slate-300 text-sm mt-1">Manage routes, assign drivers, track buses live, and broadcast emergency alerts.</p>
                </div>
                <div className="bg-white/10 rounded-xl px-4 py-2 text-sm backdrop-blur-sm self-start sm:self-center">
                  📅 {new Date().toLocaleDateString("en-IN", { dateStyle: "long" })}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              {[
                { label: "Total Buses",    value: buses.length,                                  color: "text-[#2563EB]" },
                { label: "Active Buses",   value: buses.filter(b => b.isActive).length,           color: "text-green-600" },
                { label: "Live Now",       value: activeBuses.length,                             color: "text-green-500" },
                { label: "Total Routes",   value: routes.length,                                  color: "text-[#2563EB]" },
                { label: "Total Drivers",  value: drivers.length,                                 color: "text-[#2563EB]" },
              ].map(s => (
                <div key={s.label} className="card text-center py-4">
                  <p className={`text-3xl font-extrabold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Live buses list */}
            <div className="card">
              <h3 className="font-bold text-[#1E293B] mb-4 flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-green-500 rounded-full pulse-dot"/>
                Active Buses Live ({activeBuses.length})
              </h3>
              {activeBuses.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
                  <p className="text-sm">No buses currently active. Drivers need to start a trip.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activeBuses.map(bus => (
                    <div key={bus.busId} className="flex items-center justify-between p-3 bg-[#F8FAFC] rounded-xl hover:bg-[#EFF6FF] transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="w-2.5 h-2.5 bg-green-500 rounded-full pulse-dot"/>
                        <span className="font-bold text-[#1E293B]">{bus.busId}</span>
                        {bus.routeName && <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full border">{bus.routeName}</span>}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="font-semibold text-[#2563EB]">{bus.speed.toFixed(1)} km/h</span>
                        <span className="font-mono">{bus.lat.toFixed(4)}, {bus.lng.toFixed(4)}</span>
                        <span>{formatTime(bus.lastUpdated)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* All trips */}
            <div className="card">
              <h3 className="font-bold text-[#1E293B] mb-4">Last 5 Trips ({recentTrips.length})</h3>
              <div className="space-y-2">
                {recentTrips.map(t => (
                  <div key={t.id} className="flex items-center justify-between p-3 bg-[#F8FAFC] rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${t.status === "active" ? "bg-green-500 pulse-dot" : t.status === "completed" ? "bg-gray-400" : "bg-yellow-500"}`}/>
                      <span className="font-semibold text-sm text-[#1E293B]">{t.busId}</span>
                      {t.driverName && <span className="text-xs text-gray-400">· {t.driverName}</span>}
                      {t.routeName  && <span className="text-xs text-gray-400">· {t.routeName}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span className={`px-2 py-0.5 rounded-full font-semibold ${t.status === "active" ? "bg-green-100 text-green-700" : t.status === "completed" ? "bg-gray-100 text-gray-600" : "bg-yellow-100 text-yellow-700"}`}>{t.status}</span>
                      <span>{formatDateTime(t.startTime)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══════════ LIVE MAP ══════════ */}
        {tab === "map" && (
          <div className="space-y-4 animate-fade-in">
            {/* Search bar */}
            <div className="card p-4">
              <div className="relative">
                <svg className={`absolute ${mapSearch ? "right-10" : "right-4"} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                <input type="text" placeholder="Search bus ID, route, driver, plate, speed, time…"
                  value={mapSearch} onChange={e => { setMapSearch(e.target.value); setMapSelectedBus(null); }}
                  className="input-field pr-20"/>
                {mapSearch && (
                  <button
                    type="button"
                    onClick={() => { setMapSearch(""); setMapSelectedBus(null); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 font-bold"
                    aria-label="Clear map search">
                    ×
                  </button>
                )}
              </div>
              {mapSearch && (
                <div className="mt-3 space-y-2">
                  {filteredMapBuses.map(b => {
                    const busInfo = getBusInfo(b.busId);
                    return (
                      <div key={b.busId} onClick={() => { setMapSelectedBus(b.busId); setMapSearch(""); }}
                        className="flex items-center gap-3 p-3 bg-[#F8FAFC] rounded-xl cursor-pointer hover:bg-[#EFF6FF] border border-transparent hover:border-[#DBEAFE] transition-all">
                        <div className="w-9 h-9 bg-gradient-to-br from-[#2563EB] to-[#3B82F6] rounded-xl flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M17 20H7v1a1 1 0 01-1 1H5a1 1 0 01-1-1v-1H3V8c0-3.5 3.58-4 9-4s9 .5 9 4v12h1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1zM5 14h14v-4H5v4zm0 2v2h3v-2H5zm11 0v2h3v-2h-3zM6.5 12a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm11 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/></svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#1E293B]">{b.busId}</span>
                            <span className="text-xs text-green-600 font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 bg-green-500 rounded-full pulse-dot"/>LIVE</span>
                          </div>
                          <div className="text-xs text-gray-500">{b.routeName || busInfo?.route?.routeName || "No route"} · {b.driverName || busInfo?.driver?.name || "No driver"}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-[#2563EB]">{b.speed.toFixed(1)} km/h</div>
                          <div className="text-xs text-gray-400">{formatTime(b.lastUpdated)}</div>
                        </div>
                      </div>
                    );
                  })}
                  {filteredMapBuses.length === 0 && (
                    <p className="text-center text-gray-400 py-4 text-sm">No live buses match “{mapSearch}”</p>
                  )}
                </div>
              )}
            </div>

            {/* Selected bus detail card */}
            {mapSelectedBus && (() => {
              const b = activeBuses.find(ab => ab.busId === mapSelectedBus);
              const busInfo = buses.find(bus => bus.busId === mapSelectedBus);
              const activeTrip = trips.find(t => t.busId === mapSelectedBus && t.status === "active");
              if (!b) return null;
              return (
                <div className="card border-2 border-[#2563EB] animate-slide-up">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-[#2563EB] to-[#3B82F6] rounded-xl flex items-center justify-center shadow-md">
                        <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M17 20H7v1a1 1 0 01-1 1H5a1 1 0 01-1-1v-1H3V8c0-3.5 3.58-4 9-4s9 .5 9 4v12h1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1zM5 14h14v-4H5v4zm0 2v2h3v-2H5zm11 0v2h3v-2h-3zM6.5 12a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm11 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/></svg>
                      </div>
                      <div>
                        <h3 className="text-xl font-extrabold text-[#1E293B]">{b.busId}</h3>
                        <span className="flex items-center gap-1.5 text-xs font-bold text-green-600"><span className="w-1.5 h-1.5 bg-green-500 rounded-full pulse-dot"/>LIVE · {b.speed.toFixed(1)} km/h</span>
                      </div>
                    </div>
                    <button onClick={() => setMapSelectedBus(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-3 mb-4">
                    <div className="bg-[#F8FAFC] rounded-xl p-3">
                      <p className="text-xs text-gray-400 mb-1">Route</p>
                      <p className="font-semibold text-[#1E293B] text-sm">{b.routeName || busInfo?.route?.routeName || "—"}</p>
                    </div>
                    <div className="bg-[#F8FAFC] rounded-xl p-3">
                      <p className="text-xs text-gray-400 mb-1">Driver</p>
                      <p className="font-semibold text-[#1E293B] text-sm">{b.driverName || busInfo?.driver?.name || "—"}</p>
                    </div>
                    <div className="bg-[#F8FAFC] rounded-xl p-3">
                      <p className="text-xs text-gray-400 mb-1">Plate</p>
                      <p className="font-semibold text-[#1E293B] text-sm">{busInfo?.plateNumber || "—"}</p>
                    </div>
                    <div className="bg-[#F8FAFC] rounded-xl p-3">
                      <p className="text-xs text-gray-400 mb-1">Coordinates</p>
                      <p className="font-mono text-xs text-[#1E293B]">{b.lat.toFixed(5)}, {b.lng.toFixed(5)}</p>
                    </div>
                    <div className="bg-[#F8FAFC] rounded-xl p-3">
                      <p className="text-xs text-gray-400 mb-1">Trip Start</p>
                      <p className="font-semibold text-[#1E293B] text-sm">{formatTime(activeTrip?.startTime)}</p>
                    </div>
                    <div className="bg-[#F8FAFC] rounded-xl p-3">
                      <p className="text-xs text-gray-400 mb-1">Last Update</p>
                      <p className="font-semibold text-[#1E293B] text-sm">{formatTime(b.lastUpdated)}</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-[#1E293B]">Live Bus Locations</h3>
                <span className="text-xs text-gray-500">{visibleMapBuses.length} buses on map</span>
              </div>
              <AdminMap activeBuses={visibleMapBuses} selectedBusId={mapSelectedBus} onBusSelect={setMapSelectedBus} buses={buses} routes={routes} userLocation={adminLoc} students={students} />
            </div>
            {visibleMapBuses.length > 0 && (
              <div className="grid sm:grid-cols-3 gap-4">
                {visibleMapBuses.map(b => {
                  const busInfo = getBusInfo(b.busId);
                  return (
                  <div key={b.busId} onClick={() => setMapSelectedBus(b.busId === mapSelectedBus ? null : b.busId)}
                    className={`card flex items-center gap-3 cursor-pointer transition-all hover:border-[#2563EB] border-2 ${b.busId === mapSelectedBus ? "border-[#2563EB]" : "border-transparent"}`}>
                    <div className="w-10 h-10 bg-gradient-to-br from-[#2563EB] to-[#3B82F6] rounded-xl flex items-center justify-center shadow-md">
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M17 20H7v1a1 1 0 01-1 1H5a1 1 0 01-1-1v-1H3V8c0-3.5 3.58-4 9-4s9 .5 9 4v12h1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1zM5 14h14v-4H5v4zm0 2v2h3v-2H5zm11 0v2h3v-2h-3zM6.5 12a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm11 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/></svg>
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-[#1E293B]">{b.busId}</p>
                      <p className="text-xs text-gray-500 truncate">{b.routeName || busInfo?.route?.routeName || "No route"}</p>
                      <p className="text-xs text-[#2563EB] font-semibold">{b.speed.toFixed(1)} km/h</p>
                    </div>
                  </div>
                );})}

              </div>
            )}
          </div>
        )}

        {/* ══════════ BUSES ══════════ */}
        {tab === "buses" && (
          <div className="space-y-6 animate-fade-in">
            {/* Add Bus Form */}
            <div className="card">
              <h3 className="font-bold text-[#1E293B] mb-4">{editingBusId ? "✏️ Edit Bus" : "➕ Add New Bus"}</h3>
              <div className="grid sm:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Bus ID <span className="text-red-500">*</span></label>
                  <input className="input-field" placeholder="e.g. BUS104" value={busForm.busId} disabled={!!editingBusId} onChange={e => setBusForm(f => ({ ...f, busId: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Bus Number <span className="text-red-500">*</span></label>
                  <input className="input-field" placeholder="e.g. AP05-3456" value={busForm.busNumber} onChange={e => setBusForm(f => ({ ...f, busNumber: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Plate Number</label>
                  <input className="input-field" placeholder="e.g. AP05-3456" value={busForm.plateNumber} onChange={e => setBusForm(f => ({ ...f, plateNumber: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Capacity</label>
                  <input className="input-field" type="number" placeholder="60" value={busForm.capacity} onChange={e => setBusForm(f => ({ ...f, capacity: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Assign Route</label>
                  <select className="input-field" value={busForm.routeId} onChange={e => setBusForm(f => ({ ...f, routeId: e.target.value }))}>
                    <option value="">— No Route —</option>
                    {routes.map(r => <option key={r.id} value={r.id}>{r.routeName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Assign Driver</label>
                  <select className="input-field" value={busForm.driverId} onChange={e => setBusForm(f => ({ ...f, driverId: e.target.value }))}>
                    <option value="">— No Driver —</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.driverId} · {d.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={saveBus} disabled={saving} className="btn-primary px-6 py-2.5 disabled:opacity-50">
                  {saving ? "Saving…" : editingBusId ? "Save Bus" : "Add Bus"}
                </button>
                {editingBusId && <button onClick={resetBusForm} className="px-6 py-2.5 rounded-xl bg-gray-100 text-gray-600 font-semibold hover:bg-gray-200">Cancel</button>}
              </div>
            </div>

            {/* Bus table */}
            <div className="card">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-bold text-[#1E293B]">All Buses ({filteredBuses.length})</h3>
                  <p className="text-xs text-gray-400 mt-1">Manage all college buses, assigned routes, and driver assignments.</p>
                </div>
              </div>
              <div className="relative mb-4">
                <svg className={`absolute ${busSearch ? "right-10" : "right-4"} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search bus ID, number, plate, route, driver..."
                  value={busSearch}
                  onChange={e => setBusSearch(e.target.value)}
                  className="input-field pr-20"
                />
                {busSearch && (
                  <button type="button" onClick={() => setBusSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 font-bold"
                    aria-label="Clear bus search">
                    ×
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="text-left py-3 px-3">Bus ID</th>
                      <th className="text-left py-3 px-3">Number</th>
                      <th className="text-left py-3 px-3">Plate</th>
                      <th className="text-left py-3 px-3">Cap</th>
                      <th className="text-left py-3 px-3">Route</th>
                      <th className="text-left py-3 px-3">Driver</th>
                      <th className="text-left py-3 px-3">Status</th>
                      <th className="text-left py-3 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBuses.map(bus => (
                      <tr key={bus.id} className={`border-b border-gray-50 hover:bg-[#F8FAFC] transition-colors ${!bus.isActive ? "opacity-60" : ""}`}>
                        <td className="py-3 px-3 font-bold text-[#2563EB]">{bus.busId}</td>
                        <td className="py-3 px-3">{bus.busNumber}</td>
                        <td className="py-3 px-3 text-gray-500 text-xs">{bus.plateNumber || "—"}</td>
                        <td className="py-3 px-3">{bus.capacity}</td>
                        <td className="py-3 px-3 text-xs text-gray-500">{bus.route?.routeName || "—"}</td>
                        <td className="py-3 px-3 text-xs text-gray-500">{bus.driver?.name || "—"}</td>
                        <td className="py-3 px-3">
                          <Badge active={bus.isActive} label={bus.isActive ? (activeBuses.find(a => a.busId === bus.busId) ? "🟢 Live" : "Active") : "Inactive"} />
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex gap-2">
                            <button onClick={() => editBus(bus)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-50 text-[#2563EB] hover:bg-blue-100 transition-colors">
                              Edit
                            </button>
                            <button onClick={() => toggleBus(bus.busId, bus.isActive)}
                              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${bus.isActive ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-green-50 text-green-600 hover:bg-green-100"}`}>
                              {bus.isActive ? "Deactivate" : "Activate"}
                            </button>
                            <button onClick={() => deleteBus(bus.busId)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors">
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredBuses.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">{busSearch ? "No buses match your search" : "No buses registered yet."}</p>}
              </div>
            </div>
          </div>
        )}

        {/* ══════════ ROUTES ══════════ */}
        {tab === "routes" && (
          <div className="space-y-6 animate-fade-in">
            <div className="card">
              <h3 className="font-bold text-[#1E293B] mb-1">{editingRouteId ? "✏️ Edit Route" : "➕ Add New Route"}</h3>
              <p className="text-xs text-gray-400 mb-4">Stop coordinates are auto-fetched from OpenStreetMap. Aditya Engineering College is automatically added as the final destination.</p>
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Route Name <span className="text-red-500">*</span></label>
                  <input className="input-field" placeholder="e.g. Jaggampeta (AEC added automatically)" value={routeForm.routeName} onChange={e => setRouteForm(f => ({ ...f, routeName: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Stops (comma separated) <span className="text-red-500">*</span></label>
                  <input className="input-field" placeholder="e.g. Jaggampeta, Nagaram" value={routeForm.stops} onChange={e => setRouteForm(f => ({ ...f, stops: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Distance (km)</label>
                  <input className="input-field" type="number" placeholder="e.g. 29.5" value={routeForm.distance} onChange={e => setRouteForm(f => ({ ...f, distance: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Est. Duration (min)</label>
                  <input className="input-field" type="number" placeholder="e.g. 36" value={routeForm.estimatedDuration} onChange={e => setRouteForm(f => ({ ...f, estimatedDuration: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={saveRoute} disabled={saving} className="btn-primary px-6 py-2.5 disabled:opacity-50">
                  {saving ? "Saving…" : editingRouteId ? "Save Route" : "Add Route"}
                </button>
                {editingRouteId && <button onClick={resetRouteForm} className="px-6 py-2.5 rounded-xl bg-gray-100 text-gray-600 font-semibold hover:bg-gray-200">Cancel</button>}
              </div>
            </div>

            <div className="card">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-bold text-[#1E293B]">All Routes ({filteredRoutes.length})</h3>
                  <p className="text-xs text-gray-400 mt-1">Manage transport routes, stop listings, morning/evening schedules.</p>
                </div>
              </div>
              
              <div className="relative mb-4">
                <svg className={`absolute ${routeSearch ? "right-10" : "right-4"} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search route name, stop name..."
                  value={routeSearch}
                  onChange={e => setRouteSearch(e.target.value)}
                  className="input-field pr-20"
                />
                {routeSearch && (
                  <button type="button" onClick={() => setRouteSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 font-bold"
                    aria-label="Clear route search">
                    ×
                  </button>
                )}
              </div>

              <div className="space-y-3">
                 {filteredRoutes.map(r => (
                   <div key={r.id} className="p-4 bg-[#F8FAFC] rounded-xl border border-gray-100 space-y-3">
                     {/* Row 1: Name + actions */}
                     <div className="flex items-center justify-between gap-2">
                       <div className="flex items-center gap-2 min-w-0">
                         <h4 className="font-bold text-[#1E293B] truncate">{r.routeName}</h4>
                         <Badge active={r.isActive} />
                         {(() => {
                           const direction = getTripDirection(r as any);
                           const badge = getDirectionBadge(direction);
                           return (
                             <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${direction === "morning" ? "bg-amber-100 text-amber-700" : "bg-purple-100 text-purple-700"}`}>
                               {badge.emoji} {badge.label}
                             </span>
                           );
                         })()}
                       </div>
                       <div className="flex items-center gap-2 shrink-0">
                         <button onClick={() => editRoute(r)}
                           className="text-xs font-semibold px-3 py-1.5 bg-blue-50 text-[#2563EB] rounded-lg hover:bg-blue-100 transition-colors">
                           Edit
                         </button>
                         <button
                           onClick={() => { setAdminBuilderRouteId(r.id); setShowAdminBuilder(true); }}
                           className="text-xs font-semibold px-3 py-1.5 bg-[#DBEAFE] text-[#2563EB] rounded-lg hover:bg-[#BFDBFE] transition-colors">
                           🗺️ Edit Map
                         </button>
                         <button onClick={() => deleteRoute(r.id)} className="text-xs text-red-500 hover:text-red-700 font-semibold px-2">Delete</button>
                       </div>
                     </div>

                     {/* Row 2: Stops breadcrumb */}
                     <div className="flex flex-wrap items-center gap-1.5">
                       {getDirectionalRouteStops(r).map((stop, i, visibleStops) => (
                         <React.Fragment key={i}>
                           {i > 0 && <svg className="w-3 h-3 text-[#2563EB]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>}
                           <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${i === 0 ? "bg-green-100 text-green-700" : i === visibleStops.length - 1 ? "bg-red-100 text-red-700" : "bg-white text-gray-700 border border-gray-200"}`}>{stop}</span>
                         </React.Fragment>
                       ))}
                     </div>

                     {/* Row 3: Reversible direction settings */}
                     <div className="pt-2 border-t border-gray-200">
                       <div className="flex items-center gap-3 flex-wrap">
                         {/* Toggle reversible */}
                         <label className="flex items-center gap-2 cursor-pointer">
                           <div
                             onClick={async () => {
                               await fetch("/api/routes", {
                                 method: "PATCH", headers: { "Content-Type": "application/json" },
                                 body: JSON.stringify({ id: r.id, isReversible: !(r as any).isReversible }),
                               });
                               loadAll();
                             }}
                             className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${(r as any).isReversible ? "bg-amber-500" : "bg-gray-300"}`}>
                             <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${(r as any).isReversible ? "translate-x-5" : ""}`}/>
                           </div>
                           <span className="text-xs font-semibold text-gray-600">Morning/Evening Reversal</span>
                         </label>

                         {/* Time settings — only if reversible */}
                         {(r as any).isReversible && (
                           <div className="flex items-center gap-3 flex-wrap">
                             <div className="flex items-center gap-1.5">
                               <span className="text-xs text-amber-600 font-bold">🌅 Morning until</span>
                               <input
                                 type="time"
                                 defaultValue={(r as any).morningCutoff ?? "12:01"}
                                 className="text-xs border border-amber-200 rounded-lg px-2 py-1 bg-white"
                                 onBlur={async e => {
                                   await fetch("/api/routes", {
                                     method: "PATCH", headers: { "Content-Type": "application/json" },
                                     body: JSON.stringify({ id: r.id, morningCutoff: e.target.value }),
                                   });
                                   loadAll();
                                 }}
                               />
                             </div>
                             <div className="flex items-center gap-1.5">
                               <span className="text-xs text-purple-600 font-bold">🌆 Evening from</span>
                               <input
                                 type="time"
                                 defaultValue={(r as any).eveningStart ?? "16:00"}
                                 className="text-xs border border-purple-200 rounded-lg px-2 py-1 bg-white"
                                 onBlur={async e => {
                                   await fetch("/api/routes", {
                                     method: "PATCH", headers: { "Content-Type": "application/json" },
                                     body: JSON.stringify({ id: r.id, eveningStart: e.target.value }),
                                   });
                                   loadAll();
                                 }}
                               />
                             </div>
                             <div className="text-xs text-gray-400 bg-white border border-gray-200 rounded-lg px-2 py-1">
                               🌅 {r.stops[0]} → {r.stops[r.stops.length-1]}<br/>
                               🌆 {r.stops[r.stops.length-1]} → {r.stops[0]}
                             </div>
                           </div>
                         )}
                       </div>
                     </div>
                   </div>
                  ))}
                  {filteredRoutes.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">{routeSearch ? "No routes match your search" : "No routes registered yet."}</p>}
              </div>
            </div>

            {/* ── ROUTE MAP EDITOR ── */}
            {showAdminBuilder && adminBuilderRouteId && (() => {
              const editRoute = routes.find(r => r.id === adminBuilderRouteId);
              if (!editRoute) return null;
              const rawCoords = (editRoute as any).stopCoordinates;
              const initialStops: BuilderStop[] = Array.isArray(rawCoords)
                ? rawCoords.map((s: any) => ({ name: s.name, lat: s.lat, lng: s.lng }))
                : typeof rawCoords === "string"
                ? JSON.parse(rawCoords).map((s: any) => ({ name: s.name, lat: s.lat, lng: s.lng }))
                : editRoute.stops.map((name, i) => ({ name, lat: 17.0 + i * 0.03, lng: 82.0 + i * 0.03 }));

              const handleAdminSave = async (updatedStops: BuilderStop[]) => {
                try {
                  const res = await fetch("/api/routes", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      id: adminBuilderRouteId,
                      stopCoordinates: updatedStops,
                      stops: updatedStops.map(s => s.name),
                    }),
                  });
                  if (!res.ok) throw new Error("Failed");
                  const savedRoute = await res.json();
                  setRoutes(prev => prev.map(route => route.id === adminBuilderRouteId ? { ...route, ...savedRoute } : route));
                  flash(`✅ Route "${editRoute.routeName}" map updated!`);
                  getSocket().emit("route-updated", { routeId: adminBuilderRouteId });
                  setShowAdminBuilder(false);
                  loadAll();
                } catch { flash("Failed to save route", "err"); }
              };

              return (
                <div className="card p-0 overflow-hidden">
                  <RouteBuilderMap
                    initialStops={initialStops}
                    routeName={editRoute.routeName}
                    height={500}
                    onSave={handleAdminSave}
                    onCancel={() => setShowAdminBuilder(false)}
                  />
                </div>
              );
            })()}
          </div>
        )}

        {/* ══════════ DRIVERS ══════════ */}
        {tab === "drivers" && (
          <div className="space-y-6 animate-fade-in">
            {/* Add Driver — admin only */}
            <div className="card border-2 border-[#DBEAFE]">
              <h3 className="font-bold text-[#1E293B] mb-1">{editingDriverId ? "✏️ Edit Driver" : "➕ Add New Driver"}</h3>
              <p className="text-xs text-blue-500 mb-4">{editingDriverId ? "Leave password blank to keep the current password." : "Driver ID is auto-generated. Driver can login with Driver ID or Email."}</p>
              <div className="grid sm:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name <span className="text-red-500">*</span></label>
                  <input className="input-field" placeholder="Driver name" value={driverForm.name} onChange={e => setDriverForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Email <span className="text-red-500">*</span></label>
                  <input className="input-field" type="email" placeholder="driver@email.com" value={driverForm.email} onChange={e => setDriverForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Password {!editingDriverId && <span className="text-red-500">*</span>}</label>
                  <input className="input-field" type="password" placeholder={editingDriverId ? "Leave blank to keep password" : "Set login password"} value={driverForm.password} onChange={e => setDriverForm(f => ({ ...f, password: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label>
                  <input className="input-field" placeholder="Phone number" value={driverForm.phone} onChange={e => setDriverForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">License No</label>
                  <input className="input-field" placeholder="License number" value={driverForm.licenseNo} onChange={e => setDriverForm(f => ({ ...f, licenseNo: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Assign Bus</label>
                  <select className="input-field" value={driverForm.assignedBusId} onChange={e => setDriverForm(f => ({ ...f, assignedBusId: e.target.value }))}>
                    <option value="">— No Bus —</option>
                    {buses.filter(b => b.isActive).map(b => <option key={b.busId} value={b.busId}>{b.busId} · {b.busNumber}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={saveDriver} disabled={saving} className="btn-primary px-6 py-2.5 disabled:opacity-50">
                  {saving ? "Saving…" : editingDriverId ? "Save Driver" : "Add Driver"}
                </button>
                {editingDriverId && <button onClick={resetDriverForm} className="px-6 py-2.5 rounded-xl bg-gray-100 text-gray-600 font-semibold hover:bg-gray-200">Cancel</button>}
              </div>
            </div>

            {/* Driver table */}
            <div className="card">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-bold text-[#1E293B]">All Drivers ({filteredDrivers.length})</h3>
                  <p className="text-xs text-gray-400 mt-1">Manage transport drivers, login credentials, and bus assignments.</p>
                </div>
              </div>
              
              <div className="relative mb-4">
                <svg className={`absolute ${driverSearch ? "right-10" : "right-4"} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search driver ID, name, email, phone, license..."
                  value={driverSearch}
                  onChange={e => setDriverSearch(e.target.value)}
                  className="input-field pr-20"
                />
                {driverSearch && (
                  <button type="button" onClick={() => setDriverSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 font-bold"
                    aria-label="Clear driver search">
                    ×
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="text-left py-3 px-3">Driver ID</th>
                      <th className="text-left py-3 px-3">Name</th>
                      <th className="text-left py-3 px-3">Email</th>
                      <th className="text-left py-3 px-3">Phone</th>
                      <th className="text-left py-3 px-3">License</th>
                      <th className="text-left py-3 px-3">Assigned Bus</th>
                      <th className="text-left py-3 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDrivers.map(d => (
                      <tr key={d.id} className="border-b border-gray-50 hover:bg-[#F8FAFC]">
                        <td className="py-3 px-3 font-bold text-[#7C3AED]">{d.driverId}</td>
                        <td className="py-3 px-3 font-semibold text-[#1E293B]">{d.name}</td>
                        <td className="py-3 px-3 text-xs text-gray-500">{d.email}</td>
                        <td className="py-3 px-3 text-xs text-gray-500">{d.phone || "—"}</td>
                        <td className="py-3 px-3 text-xs text-gray-500">{d.licenseNo || "—"}</td>
                        <td className="py-3 px-3">
                          <select
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                            value={d.assignedBusId || ""}
                            onChange={e => assignBusToDriver(d.id, e.target.value)}
                          >
                            <option value="">— None —</option>
                            {buses.filter(b => b.isActive).map(b => <option key={b.busId} value={b.busId}>{b.busId}</option>)}
                          </select>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex gap-2">
                            <button onClick={() => editDriver(d)} className="text-xs text-[#2563EB] hover:text-blue-700 font-semibold px-3 py-1.5 bg-blue-50 rounded-lg hover:bg-blue-100">
                              Edit
                            </button>
                            <button onClick={() => deleteDriver(d.id)} className="text-xs text-red-500 hover:text-red-700 font-semibold px-3 py-1.5 bg-red-50 rounded-lg hover:bg-red-100">
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredDrivers.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">{driverSearch ? "No drivers match your search" : "No drivers yet. Add one above."}</p>}
              </div>
            </div>
          </div>
        )}

        {/* ══════════ STUDENTS ══════════ */}
        {tab === "students" && (
          <div className="space-y-6 animate-fade-in">
            {/* Add Student Form */}
            <div className="card border-2 border-[#DBEAFE]">
              <h3 className="font-bold text-[#1E293B] mb-1">{editingStudentId ? "✏️ Edit Student" : "➕ Add New Student"}</h3>
              <p className="text-xs text-blue-500 mb-4">{editingStudentId ? "Leave password blank to keep the current password." : "Set password for student login."}</p>
              <div className="grid sm:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Roll No / Student ID</label>
                  <input className="input-field" placeholder="e.g. 21A91A0501" value={studentForm.studentId} onChange={e => setStudentForm(f => ({ ...f, studentId: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name <span className="text-red-500">*</span></label>
                  <input className="input-field" placeholder="Student name" value={studentForm.name} onChange={e => setStudentForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Email <span className="text-red-500">*</span></label>
                  <input className="input-field" type="email" placeholder="student@email.com" value={studentForm.email} onChange={e => setStudentForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Password {!editingStudentId && <span className="text-red-500">*</span>}</label>
                  <input className="input-field" type="password" placeholder={editingStudentId ? "Leave blank to keep password" : "Set login password"} value={studentForm.password} onChange={e => setStudentForm(f => ({ ...f, password: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Student Phone</label>
                  <input className="input-field" placeholder="Phone number" value={studentForm.phone} onChange={e => setStudentForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Parent Contact</label>
                  <input className="input-field" placeholder="Parent contact number" value={studentForm.parentContact} onChange={e => setStudentForm(f => ({ ...f, parentContact: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Village / Area</label>
                  <input className="input-field" placeholder="Village or area" value={studentForm.village} onChange={e => setStudentForm(f => ({ ...f, village: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Assign Bus</label>
                  <select className="input-field" value={studentForm.assignedBusId} onChange={e => setStudentForm(f => ({ ...f, assignedBusId: e.target.value, boardingStop: "" }))}>
                    <option value="">— No Bus —</option>
                    {buses.filter(b => b.isActive).map(b => <option key={b.busId} value={b.busId}>{b.busId} · {b.busNumber}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Boarding Stop</label>
                  <select className="input-field" value={studentForm.boardingStop} disabled={!studentForm.assignedBusId} onChange={e => setStudentForm(f => ({ ...f, boardingStop: e.target.value }))}>
                    <option value="">— Select Stop —</option>
                    {formStops.map((stop: string) => <option key={stop} value={stop}>{stop}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={saveStudent} disabled={saving} className="btn-primary px-6 py-2.5 disabled:opacity-50">
                  {saving ? "Saving…" : editingStudentId ? "Save Student" : "Add Student"}
                </button>
                {(editingStudentId || studentForm.name || studentForm.email || studentForm.studentId || studentForm.password || studentForm.phone || studentForm.parentContact || studentForm.village || studentForm.assignedBusId || studentForm.boardingStop) && (
                  <button onClick={resetStudentForm} className="px-6 py-2.5 rounded-xl bg-gray-100 text-gray-600 font-semibold hover:bg-gray-200">Clear</button>
                )}
              </div>
            </div>

            <div className="card">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-bold text-[#1E293B]">All Students ({filteredStudents.length})</h3>
                  <p className="text-xs text-gray-400 mt-1">Assign buses and boarding stops for student tracking + alert delivery.</p>
                </div>
                <span className="text-xs font-bold bg-blue-50 text-blue-700 border border-blue-100 px-3 py-1.5 rounded-full">
                  Shared backend · Student role only
                </span>
              </div>
              <div className="relative mb-4">
                <svg className={`absolute ${studentSearch ? "right-10" : "right-4"} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search roll no, student, email, phone, bus, stop, route…"
                  value={studentSearch}
                  onChange={event => setStudentSearch(event.target.value)}
                  className="input-field pr-20"
                />
                {studentSearch && (
                  <button type="button" onClick={() => setStudentSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 font-bold"
                    aria-label="Clear student search">
                    ×
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="text-left py-3 px-3">Roll No</th>
                      <th className="text-left py-3 px-3">Name</th>
                      <th className="text-left py-3 px-3">Student Contact</th>
                      <th className="text-left py-3 px-3">Parent Contact</th>
                      <th className="text-left py-3 px-3">Assigned Bus</th>
                      <th className="text-left py-3 px-3">Boarding Stop</th>
                      <th className="text-left py-3 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map(student => {
                      const assignedBus = buses.find(bus => bus.busId === student.assignedBusId);
                      return (
                        <tr key={student.id} className="border-b border-gray-50 hover:bg-[#F8FAFC]">
                          <td className="py-3 px-3">
                            <span className="font-bold text-[#7C3AED]">{student.studentId || "—"}</span>
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-semibold text-[#1E293B]">{student.name || "—"}</p>
                            <p className="text-[10px] text-gray-400 mt-1">{student.email}</p>
                          </td>
                          <td className="py-3 px-3">
                            <p className="text-xs text-gray-600">{student.phone || "—"}</p>
                            <p className="text-[10px] text-gray-400 mt-1">{student.village || "No area"}</p>
                          </td>
                          <td className="py-3 px-3">
                            <span className="text-xs text-gray-600">{student.parentContact || "—"}</span>
                          </td>
                          <td className="py-3 px-3">
                            <div className="text-xs">
                              <p className="font-semibold text-[#1E293B]">{student.assignedBusId || "—"}</p>
                              {assignedBus?.busNumber && <p className="text-gray-400">{assignedBus.busNumber}</p>}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <span className="text-xs text-gray-600">{student.boardingStop || "—"}</span>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex gap-2">
                              <button onClick={() => editStudent(student)}
                                className="text-xs text-[#2563EB] hover:text-blue-700 font-semibold px-3 py-1.5 bg-blue-50 rounded-lg hover:bg-blue-100">
                                Edit
                              </button>
                              <button onClick={() => deleteStudent(student.id)}
                                className="text-xs text-red-500 hover:text-red-700 font-semibold px-3 py-1.5 bg-red-50 rounded-lg hover:bg-red-100">
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredStudents.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">{studentSearch ? "No students match your search" : "No students registered yet."}</p>}
              </div>
            </div>
          </div>
        )}

        {/* ══════════ TRIPS ══════════ */}
        {tab === "trips" && (
          <div className="space-y-4 animate-fade-in">
            {/* Search bar */}
            <div className="card p-4">
              <div className="relative">
                <svg className={`absolute ${tripSearch ? "right-10" : "right-4"} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search bus, driver, route, status, date, time, #id…"
                  value={tripSearch}
                  onChange={e => setTripSearch(e.target.value)}
                  className="input-field pr-20"
                />
                {tripSearch && (
                  <button
                    type="button"
                    onClick={() => setTripSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 font-bold"
                    aria-label="Clear trip search">
                    ×
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-2">Showing {filteredTrips.length} of {trips.length} trips</p>
            </div>

            <div className="card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="text-left py-3 px-3">#</th>
                      <th className="text-left py-3 px-3">Bus</th>
                      <th className="text-left py-3 px-3">Driver</th>
                      <th className="text-left py-3 px-3">Route</th>
                      <th className="text-left py-3 px-3">Status</th>
                      <th className="text-left py-3 px-3">Start</th>
                      <th className="text-left py-3 px-3">End</th>
                      <th className="text-left py-3 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrips.map(t => (
                      <tr key={t.id} className={`border-b border-gray-50 hover:bg-[#F8FAFC] transition-colors ${t.emergencyAlert ? "bg-red-50" : ""}`}>
                        <td className="py-3 px-3 text-gray-400 font-mono text-xs">#{t.id}</td>
                        <td className="py-3 px-3 font-bold text-[#2563EB]">{t.busId}</td>
                        <td className="py-3 px-3">
                          <div className="text-xs">
                            <div className="font-semibold text-[#1E293B]">{t.driverName || "—"}</div>
                            {t.driverUid && <div className="text-[#7C3AED]">{t.driverUid}</div>}
                            {t.driverPhone && <div className="text-gray-400">{t.driverPhone}</div>}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-gray-500">{t.routeName || "—"}</td>
                        <td className="py-3 px-3">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                            t.status === "active"    ? "bg-green-100 text-green-700" :
                            t.status === "completed" ? "bg-gray-100 text-gray-600"  :
                            t.status === "paused"    ? "bg-yellow-100 text-yellow-700" :
                            "bg-gray-100 text-gray-500"
                          }`}>{t.status}</span>
                          {t.emergencyAlert && <span className="ml-1 text-xs text-red-600 font-bold">🚨</span>}
                        </td>
                        <td className="py-3 px-3 text-xs text-gray-500 whitespace-nowrap">{formatDateTime(t.startTime)}</td>
                        <td className="py-3 px-3 text-xs text-gray-500 whitespace-nowrap">{formatDateTime(t.endTime)}</td>
                        <td className="py-3 px-3">
                          <button onClick={() => deleteTrip(t.id)}
                            className="text-xs text-red-500 hover:text-red-700 font-semibold px-3 py-1.5 bg-red-50 rounded-lg hover:bg-red-100">
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredTrips.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">{tripSearch ? "No trips match your search" : "No trips yet"}</p>}
              </div>
            </div>
          </div>
        )}

        {/* ══════════ COMPLAINTS / TICKETS ══════════ */}
        {tab === "complaints" && (
          <div className="space-y-6 animate-fade-in">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <div>
                <h3 className="text-xl font-bold text-[#1E293B]">📋 Student Complaints & Feedback</h3>
                <p className="text-xs text-gray-500 mt-1">Review, track, and provide resolutions for student complaints and tickets.</p>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  placeholder="🔍 Search complaints..."
                  className="input-field max-w-xs"
                  value={complaintSearch}
                  onChange={e => setComplaintSearch(e.target.value)}
                />
                <button
                  onClick={loadComplaints}
                  disabled={complaintsLoading}
                  className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-bold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all shadow-md shadow-blue-500/10 flex items-center gap-1.5 whitespace-nowrap"
                >
                  {complaintsLoading ? "🔄 Refreshing..." : "🔄 Refresh List"}
                </button>
              </div>
            </div>

            {/* Complaints list */}
            {complaintsLoading && complaintsList.length === 0 ? (
              <div className="card text-center py-20">
                <div className="animate-spin h-10 w-10 border-4 border-[#2563EB] border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-sm text-gray-500">Loading complaints...</p>
              </div>
            ) : (
              (() => {
                const filtered = complaintsList.filter(c => {
                  const query = complaintSearch.toLowerCase().trim();
                  if (!query) return true;
                  return (
                    (c.reason || "").toLowerCase().includes(query) ||
                    (c.description || "").toLowerCase().includes(query) ||
                    (c.studentName || "").toLowerCase().includes(query) ||
                    (c.studentEmail || "").toLowerCase().includes(query) ||
                    (c.studentRollNumber || "").toLowerCase().includes(query) ||
                    (c.status || "").toLowerCase().includes(query)
                  );
                });

                if (filtered.length === 0) {
                  return (
                    <div className="card text-center py-16 bg-white border border-dashed border-gray-200">
                      <p className="text-4xl mb-2">📬</p>
                      <p className="text-sm font-semibold text-gray-600">No complaints found</p>
                      <p className="text-xs text-gray-400 mt-1">There are no complaints matching your current filters.</p>
                    </div>
                  );
                }

                return (
                  <div className="grid md:grid-cols-2 gap-4">
                    {filtered.map(complaint => {
                      const isResolved = complaint.status === "resolved";
                      const isBeingResolved = resolvingComplaintId === complaint.id;

                      return (
                        <div
                          key={complaint.id}
                          className={`card border-l-4 shadow-sm flex flex-col justify-between transition-all ${
                            isResolved ? "border-l-green-500 bg-white" : "border-l-amber-500 bg-white"
                          }`}
                        >
                          <div className="space-y-3">
                            {/* Card Header */}
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isResolved ? "bg-green-50 text-green-700 border border-green-200" : "bg-amber-50 text-amber-700 border border-amber-200"
                                }`}>
                                  {isResolved ? "✓ Resolved" : "⏱ Pending"}
                                </span>
                                <h4 className="font-extrabold text-[#1E293B] text-base mt-2">{complaint.reason}</h4>
                              </div>
                              <p className="text-[10px] text-gray-400 font-semibold text-right whitespace-nowrap">
                                {new Date(complaint.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                              </p>
                            </div>

                            {/* Description */}
                            <div className="bg-gray-50 p-3.5 rounded-xl text-sm text-gray-700 leading-relaxed font-medium">
                              {complaint.description}
                            </div>

                            {/* Student Details */}
                            <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 p-2.5 rounded-xl text-xs text-gray-600">
                              <span className="text-base">🎓</span>
                              <div className="truncate">
                                <p className="font-bold text-[#1E293B]">
                                  {complaint.studentName || "Unknown Student"}{complaint.studentRollNumber ? ` (${complaint.studentRollNumber})` : ""}
                                </p>
                                <p className="text-[10px] text-gray-400 mt-0.5">{complaint.studentEmail}</p>
                              </div>
                            </div>

                            {/* Admin Resolution Area */}
                            {isResolved ? (
                              <div className="bg-green-50/50 border border-green-100/50 p-3.5 rounded-xl space-y-1 mt-3">
                                <p className="text-xs font-bold text-green-800 flex items-center gap-1">
                                  ✓ Resolution Explanation:
                                </p>
                                <p className="text-sm text-green-700 leading-relaxed">
                                  {complaint.adminExplanation || "Resolved without explanation."}
                                </p>
                                {complaint.resolvedAt && (
                                  <p className="text-[9px] text-green-500 font-medium pt-1">
                                    Resolved at {new Date(complaint.resolvedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                                  </p>
                                )}
                              </div>
                            ) : (
                              !isBeingResolved ? (
                                <button
                                  onClick={() => {
                                    setResolvingComplaintId(complaint.id);
                                    setAdminExplanationText("");
                                  }}
                                  className="w-full bg-[#10B981] hover:bg-[#059669] text-white font-bold text-xs py-2 rounded-xl active:scale-95 transition-all mt-4"
                                >
                                  Mark as Resolved
                                </button>
                              ) : (
                                <div className="border border-amber-200 bg-amber-50/20 p-4 rounded-xl space-y-3 mt-4 animate-fade-in">
                                  <div>
                                    <label className="block text-xs font-bold text-amber-800 mb-1">Provide Resolution Explanation</label>
                                    <textarea
                                      className="input-field min-h-[80px] bg-white resize-none text-sm"
                                      placeholder="Explain how the issue was resolved..."
                                      value={adminExplanationText}
                                      onChange={e => setAdminExplanationText(e.target.value)}
                                      required
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => resolveComplaint(complaint.id)}
                                      className="flex-1 bg-[#10B981] hover:bg-[#059669] text-white font-bold text-xs py-2 rounded-lg transition-all"
                                    >
                                      Submit Resolution
                                    </button>
                                    <button
                                      onClick={() => setResolvingComplaintId(null)}
                                      className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs px-3 py-2 rounded-lg transition-all"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </div>
        )}

        </>)}
      </div>
      {showAlerts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-slide-up">
            <div className="bg-gradient-to-r from-red-600 to-orange-500 px-5 py-4 text-white flex items-center justify-between">
              <div>
                <h3 className="text-lg font-extrabold">🚨 Admin Bus Alerts</h3>
                <p className="text-xs text-red-100">Emergency and combine alerts from drivers</p>
              </div>
              <button onClick={() => setShowAlerts(false)} className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 font-bold">×</button>
            </div>
            <div className="p-4 max-h-[70vh] overflow-y-auto">
              {alerts.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <p className="text-4xl mb-2">✅</p>
                  <p className="text-sm font-semibold">No bus alerts</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {alerts.map((alert, index) => (
                    <div key={alert.id ?? `${alert.createdAt}-${index}`} className={`rounded-xl border px-4 py-3 ${alert.resolvedAt ? "border-green-100 bg-green-50" : "border-red-100 bg-red-50"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={`font-extrabold text-sm ${alert.resolvedAt ? "text-green-800" : "text-red-800"}`}>{alert.title}</p>
                          {alert.resolvedAt && <p className="text-[10px] font-bold text-green-600 mt-0.5">Resolved · {formatTime(alert.resolvedAt)}</p>}
                        </div>
                        <span className={`text-[10px] whitespace-nowrap ${alert.resolvedAt ? "text-green-500" : "text-red-500"}`}>{formatTime(alert.createdAt || alert.timestamp)}</span>
                      </div>
                      <p className={`text-sm mt-1 leading-relaxed ${alert.resolvedAt ? "text-green-700" : "text-red-700"}`}>{alert.message}</p>
                      {!alert.resolvedAt && alert.id && (
                        <button onClick={() => markAlertResolved(alert)}
                          className="mt-3 text-xs font-bold bg-white text-green-700 border border-green-200 rounded-lg px-3 py-1.5 hover:bg-green-50">
                          Mark Resolved
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
