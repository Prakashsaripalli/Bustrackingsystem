"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { getSocket } from "@/services/socket";
import { getTripDirection, getDirectionalStops, getDirectionBadge, getStartEnd } from "@/utils/routeDirection";
import { computeEta, formatEta, formatDist, clearSpeedBuffer, pushSpeed } from "@/services/eta";
import dynamic from "next/dynamic";
import QRCode from "qrcode";

const TrackingMap = dynamic(() => import("@/components/TrackingMap"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center bg-[#E8EEF4] rounded-2xl" style={{ height:"480px" }}>
      <div className="text-center">
        <div className="animate-spin h-10 w-10 border-4 border-[#2563EB] border-t-transparent rounded-full mx-auto mb-3"/>
        <p className="text-sm text-gray-500 font-medium">Loading map…</p>
      </div>
    </div>
  ),
});

type PageTab = "mybus" | "allbuses" | "complaints" | "profile";

interface BusLoc  { lat:number; lng:number; speed:number; heading:number; busId:string; routeId?:number|null; }
interface Stop    { name:string; lat:number; lng:number; }
interface Route   { id:number; routeName:string; stops:string[]; stopCoordinates?:Stop[]|string; distance?:number; estimatedDuration?:number; isActive:boolean; isReversible?:boolean; morningCutoff?:string; }
interface BusInfo {
  id:number;
  busId:string;
  busNumber:string;
  plateNumber?:string;
  capacity?:number;
  routeId:number|null;
  route?:Route|null;
  driver?: { id: number; name: string; driverId: string; phone: string; } | null;
}
interface AlertNotification {
  id?:number;
  busId?:string;
  title:string;
  message:string;
  createdAt?:string;
  timestamp?:string;
  isRead?:boolean|null;
  resolvedAt?:string|null;
  resolvedBy?:number|null;
}

function parseStops(data:any):Stop[] {
  if (!data) return [];
  if (typeof data==="string") { try { return JSON.parse(data); } catch { return []; } }
  if (Array.isArray(data)) return data;
  return [];
}

/* Haversine km */
function hav(lat1:number,lng1:number,lat2:number,lng2:number){
  const R=6371,r=Math.PI/180;
  const a=Math.sin((lat2-lat1)*r/2)**2+Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lng2-lng1)*r/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function formatAlertTime(value?: string) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
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

/* ETA state types */
interface EtaState {
  distKm:  number;
  etaMin:  number;
  speedKmh: number;
  source:  "blended" | "routing" | "stopped";
}

interface NotificationWrapperProps {
  children: React.ReactNode;
  activeNotification: {
    title: string;
    message: string;
    type: "emergency" | "combine" | "proximity";
    timestamp: Date;
  } | null;
  setActiveNotification: (val: any) => void;
}

function NotificationWrapper({
  children,
  activeNotification,
  setActiveNotification,
}: NotificationWrapperProps) {
  return (
    <div className="min-h-screen bg-[#F1F5F9] relative">
      {/* Push Notification Banner Overlay */}
      {activeNotification && (
        <div className="fixed top-4 right-4 w-full max-w-sm z-50 transition-all duration-300 animate-slide-up pointer-events-auto">
          <div className="bg-white border-2 border-blue-100 rounded-2xl p-4 shadow-2xl flex gap-3 items-start relative border-l-4 border-l-[#2563EB]">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#F27A35] to-[#2563EB] p-0.5 shadow-sm shrink-0 flex items-center justify-center">
              <img src="/aditya-logo.png" alt="Aditya" className="w-full h-full object-contain p-0.5 bg-white rounded-[9px]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#2563EB] font-extrabold uppercase tracking-wide">BusTrack Live</span>
                <span className="text-[9px] text-gray-400 font-semibold">now</span>
              </div>
              <p className="text-sm font-black text-slate-800 mt-0.5">{activeNotification.title}</p>
              <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{activeNotification.message}</p>
            </div>
            <button 
              onClick={() => setActiveNotification(null)}
              className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-xs text-gray-400 hover:text-gray-600 transition-colors shrink-0 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {children}
    </div>
  );
}

export default function StudentDashboard() {
  const { user, isAuthenticated, loading: authLoading, logout, token, updateUser, login, register } = useAuth();
  const [pageTab, setPageTab] = useState<PageTab>("mybus");

  /* ─ student login/register state ─ */
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  // Student registration state fields
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regParentContact, setRegParentContact] = useState("");
  const [regVillage, setRegVillage] = useState("");
  const [regBoardingStop, setRegBoardingStop] = useState("");
  const [regBusId, setRegBusId] = useState("");
  const [regStudentId, setRegStudentId] = useState("");

  /* ─ data ─ */
  const [routes,    setRoutes]    = useState<Route[]>([]);
  const [buses,     setBuses]     = useState<BusInfo[]>([]);
  const [dataReady, setDataReady] = useState(false);

  /* ─ live tracking ─ */
  const [busLocations, setBusLocations] = useState<Map<string,BusLoc>>(new Map());
  const [activeBusIds, setActiveBusIds] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<AlertNotification[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [seenAlertKeys, setSeenAlertKeys] = useState<Set<string>>(new Set());

  /* ─ native notifications ─ */
  const [activeNotification, setActiveNotification] = useState<{
    title: string;
    message: string;
    type: "emergency" | "combine" | "proximity";
    timestamp: Date;
  } | null>(null);
  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const playChime = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = ctx.currentTime;
      
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
      
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(880, now + 0.12);
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.24); // D6
      
      gainNode.gain.setValueAtTime(0.12, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      
      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc1.start(now);
      osc1.stop(now + 0.2);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.35);
    } catch (e) {
      console.error("Audio Context failed:", e);
    }
  }, []);

  const triggerAppNotification = useCallback((title: string, message: string, type: "emergency" | "combine" | "proximity") => {
    setActiveNotification({ title, message, type, timestamp: new Date() });
    playChime();
    if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current);
    notificationTimeoutRef.current = setTimeout(() => {
      setActiveNotification(null);
    }, 6000);
  }, [playChime]);


  // Cleanup notification timer
  useEffect(() => {
    return () => {
      if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current);
    };
  }, []);

  /* ─ my bus tracking ─ */
  const [myBusLoc,         setMyBusLoc]         = useState<BusLoc|null>(null);
  const [myRouteStops,     setMyRouteStops]      = useState<Stop[]>([]);
  const [boardingStop,     setBoardingStop]      = useState<Stop|null>(null);
  const [collegeStop,      setCollegeStop]       = useState<Stop|null>(null);
  const [busPastMyStop,    setBusPastMyStop]     = useState(false);  // has bus crossed my boarding stop?
  const [etaToMyStop,      setEtaToMyStop]       = useState<EtaState|null>(null);
  const [etaToCampus,      setEtaToCampus]       = useState<EtaState|null>(null);
  const [etaLoading,       setEtaLoading]        = useState(false);
  const etaComputingRef = useRef(false);

  /* ─ all buses view ─ */
  const [search,        setSearch]        = useState("");
  const [selectedAllBus,setSelectedAllBus]= useState<string|null>(null);
  const [allStops,      setAllStops]      = useState<Stop[]>([]);
  const [allAutoFly,    setAllAutoFly]    = useState(false);

  /* ─ profile ─ */
  const [profileForm,   setProfileForm]   = useState({ name:"", phone:"", parentContact:"", village:"", boardingStop:"", assignedBusId:"", studentId:"" });
  const [pwForm,        setPwForm]        = useState({ current:"", newPw:"", confirm:"" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg,    setProfileMsg]    = useState<{text:string;ok:boolean}|null>(null);
  const [tick, setTick] = useState(0);
  const [directionTick, setDirectionTick] = useState(0);

  /* ─ Transport ID card interactive states ─ */
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load photo from localStorage on mount / user load
  useEffect(() => {
    if (user?.id) {
      if (typeof window !== "undefined" && window.location.search.includes("mockPhoto=true")) {
        const mockBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQImWNkYGBgYGBgYGBgYGBgAAAABQAB6jPvBQAAAAAASUVORK5CYII=";
        localStorage.setItem(`student_photo_${user.id}`, mockBase64);
        setProfilePhoto(mockBase64);
      } else {
        const stored = localStorage.getItem(`student_photo_${user.id}`);
        setProfilePhoto(stored || null);
      }
    } else {
      setProfilePhoto(null);
    }
  }, [user?.id]);

  // Generate QR code for Roll Number (studentId)
  useEffect(() => {
    if (user?.studentId) {
      QRCode.toDataURL(user.studentId, { margin: 1, width: 120 })
        .then(setQrCodeUrl)
        .catch(err => console.error("Error generating QR code:", err));
    } else {
      setQrCodeUrl("");
    }
  }, [user?.studentId]);

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setProfilePhoto(base64String);
        if (user?.id) {
          localStorage.setItem(`student_photo_${user.id}`, base64String);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = ""; // Reset value so same file can be re-selected if deleted
  };

  const handleRemovePhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    setProfilePhoto(null);
    if (user?.id) {
      localStorage.removeItem(`student_photo_${user.id}`);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  /* ─ complaints / ticket rise ─ */
  interface Complaint {
    id: number;
    studentId: number;
    reason: string;
    description: string;
    status: string;
    adminExplanation: string | null;
    resolvedAt: string | null;
    createdAt: string;
  }

  const [complaintsList, setComplaintsList] = useState<Complaint[]>([]);
  const [complaintReason, setComplaintReason] = useState("");
  const [complaintDesc, setComplaintDesc] = useState("");
  const [complaintSubmitting, setComplaintSubmitting] = useState(false);
  const [complaintMsg, setComplaintMsg] = useState<{text:string;ok:boolean}|null>(null);
  const [complaintsLoading, setComplaintsLoading] = useState(false);

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
    if (isAuthenticated && pageTab === "complaints") {
      loadComplaints();
    }
  }, [isAuthenticated, pageTab, loadComplaints]);

  const submitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaintReason.trim() || !complaintDesc.trim()) {
      setComplaintMsg({ text: "Please fill in all fields", ok: false });
      return;
    }
    setComplaintSubmitting(true);
    setComplaintMsg(null);
    try {
      const res = await fetch("/api/complaints", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          reason: complaintReason,
          description: complaintDesc
        })
      });
      if (res.ok) {
        setComplaintReason("");
        setComplaintDesc("");
        setComplaintMsg({ text: "Complaint submitted successfully!", ok: true });
        loadComplaints();
      } else {
        const data = await res.json();
        setComplaintMsg({ text: data.error || "Failed to submit complaint", ok: false });
      }
    } catch {
      setComplaintMsg({ text: "Network error. Please try again.", ok: false });
    } finally {
      setComplaintSubmitting(false);
    }
  };

  useEffect(() => {
    const intervalId = setInterval(() => setDirectionTick(value => value + 1), 60000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  }, []);

  /* ─ load data ─ */
  const loadData = useCallback(async () => {
    try {
      const [rRes, bRes] = await Promise.all([fetch("/api/routes"), fetch("/api/buses")]);
      if (rRes.ok && rRes.headers.get("content-type")?.includes("json")) setRoutes(await rRes.json());
      if (bRes.ok && bRes.headers.get("content-type")?.includes("json")) setBuses(await bRes.json());
    } catch { /**/ }
    finally { setDataReady(true); }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* ─ load profile ─ */
  useEffect(() => {
    if (!token || !user) return;
    fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (!r.ok || !r.headers.get("content-type")?.includes("json")) throw new Error("not json");
        return r.json();
      })
      .then(p => {
        setProfileForm({
          name: p.name || "", phone: p.phone || "", parentContact: p.parentContact || "", village: p.village || "",
          boardingStop: p.boardingStop || "", assignedBusId: p.assignedBusId || "",
          studentId: p.studentId || "",
        });
      }).catch(() => { });
  }, [token, user]);

  useEffect(() => {
    if (!token || user?.role !== "student") return;
    fetch("/api/alerts", { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.ok && res.headers.get("content-type")?.includes("json") ? res.json() : [])
      .then(data => setAlerts(Array.isArray(data) ? data.map(normalizeAlert) : []))
      .catch(() => {});
  }, [token, user?.role]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = localStorage.getItem(`student_alerts_seen_${user.id}`);
      setSeenAlertKeys(new Set(raw ? JSON.parse(raw) : []));
    } catch {
      setSeenAlertKeys(new Set());
    }
  }, [user?.id]);

  /* ─ socket ─ */
  useEffect(() => {
    const socket = getSocket();

    // Request current active buses immediately
    socket.emit("get-active-buses");
    const onConnect   = () => socket.emit("get-active-buses");
    const onReconnect = () => socket.emit("get-active-buses");
    socket.on("connect",   onConnect);
    socket.on("reconnect", onReconnect);
    if (user?.assignedBusId) socket.emit("track-bus", user.assignedBusId);

    const onLoc = (data: any) => {
      if (data.lat === 0 && data.lng === 0) return;
      const loc: BusLoc = {
        busId: data.busId,
        lat: data.lat,
        lng: data.lng,
        speed: data.speed || 0,
        heading: data.heading || 0,
        routeId: data.routeId
      };
      setBusLocations(prev => { const m = new Map(prev); m.set(data.busId, loc); return m; });
      setActiveBusIds(prev => prev.includes(data.busId) ? prev : [...prev, data.busId]);
      if (data.busId === user?.assignedBusId) { setMyBusLoc(loc); setTick(t => t+1); }
    };

    const onStatus = (d: {busId:string; status:string}) => {
      if (d.status === "active") {
        setActiveBusIds(prev => prev.includes(d.busId) ? prev : [...prev, d.busId]);
      } else if (d.status === "inactive" || d.status === "disconnected") {
        setBusLocations(prev => { const m = new Map(prev); m.delete(d.busId); return m; });
        setActiveBusIds(prev => prev.filter(id => id !== d.busId));
        if (d.busId === user?.assignedBusId) setMyBusLoc(null);
      }
    };

    const onActiveList = (list: any[]) => {
      list.forEach(b => {
        if (!b.lat && !b.lng) return;
        const loc: BusLoc = { busId:b.busId, lat:b.lat, lng:b.lng, speed:b.speed||0, heading:b.heading||0, routeId:b.routeId };
        setBusLocations(prev => { const m = new Map(prev); m.set(b.busId, loc); return m; });
        setActiveBusIds(prev => prev.includes(b.busId) ? prev : [...prev, b.busId]);
        if (b.busId === user?.assignedBusId) { setMyBusLoc(loc); setTick(t => t+1); }
      });
    };

    const onTripUpdate = (d: any) => {
      if (d.status === "active") {
        setActiveBusIds(prev => prev.includes(d.busId) ? prev : [...prev, d.busId]);
      } else if (d.status === "completed") {
        setBusLocations(prev => { const m = new Map(prev); m.delete(d.busId); return m; });
        setActiveBusIds(prev => prev.filter(id => id !== d.busId));
        if (d.busId === user?.assignedBusId) setMyBusLoc(null);
      }
    };

    const onEmergency = (data: any) => {
      if (data.busId !== user?.assignedBusId) return;
      const normalized = normalizeAlert(data);
      setAlerts(prev => [normalized, ...prev.filter(alert => alert.id !== data.id)].slice(0, 50));
      showWebNotification(normalized.title, normalized.message);
      triggerAppNotification(normalized.title, normalized.message, "emergency");
    };

    const onBusCombined = (data: any) => {
      if (data.targetBusId !== user?.assignedBusId && data.busId !== user?.assignedBusId) return;
      const normalized = normalizeAlert(data);
      setAlerts(prev => [normalized, ...prev.filter(alert => alert.id !== data.id)].slice(0, 50));
      setActiveBusIds(prev => user?.assignedBusId && !prev.includes(user.assignedBusId) ? [...prev, user.assignedBusId] : prev);
      showWebNotification(normalized.title, normalized.message);
      triggerAppNotification(normalized.title, normalized.message, "combine");
    };

    const onAlertResolved = (data: any) => {
      setAlerts(prev => prev.map(alert => {
        if (alert.id === data.id) {
          return { ...alert, resolvedAt: data.resolvedAt };
        }
        return alert;
      }));
    };

    const onRouteUpdated = () => {
      console.log("[Socket] Route updated, reloading...");
      loadData();
    };

    socket.on("bus-location-update", onLoc);
    socket.on("bus-status",          onStatus);
    socket.on("active-buses-list",   onActiveList);
    socket.on("trip-update",         onTripUpdate);
    socket.on("emergency",           onEmergency);
    socket.on("bus-combined",        onBusCombined);
    socket.on("alert-resolved",      onAlertResolved);
    socket.on("route-updated",       onRouteUpdated);

    return () => {
      if (user?.assignedBusId) socket.emit("untrack-bus", user.assignedBusId);
      socket.off("connect",              onConnect);
      socket.off("reconnect",            onReconnect);
      socket.off("bus-location-update",  onLoc);
      socket.off("bus-status",           onStatus);
      socket.off("active-buses-list",    onActiveList);
      socket.off("trip-update",          onTripUpdate);
      socket.off("emergency",            onEmergency);
      socket.off("bus-combined",         onBusCombined);
      socket.off("alert-resolved",      onAlertResolved);
      socket.off("route-updated",       onRouteUpdated);
    };
  }, [user?.assignedBusId, loadData]);

  /* ─ compute my route stops from assigned bus ─ */
  useEffect(() => {
    if (!user?.assignedBusId || !buses.length) {
      setMyRouteStops([]);
      setBoardingStop(null);
      setCollegeStop(null);
      setEtaToMyStop(null);
      setEtaToCampus(null);
      return;
    }
    const myBus = buses.find(b=>b.busId===user.assignedBusId);
    if (!myBus?.route) {
      setMyRouteStops([]);
      setBoardingStop(null);
      setCollegeStop(null);
      setEtaToMyStop(null);
      setEtaToCampus(null);
      return;
    }
    const dirStops = getDirectionalStops(myBus.route as any);
    if (!dirStops.length) {
      setMyRouteStops([]);
      setBoardingStop(null);
      setCollegeStop(null);
      setEtaToMyStop(null);
      setEtaToCampus(null);
      return;
    }
    setMyRouteStops(dirStops);

    // Boarding stop = user's configured boardingStop
    const bStop = user.boardingStop
      ? dirStops.find(s=>s.name.toLowerCase().includes((user.boardingStop||"").toLowerCase()))
        ?? dirStops[0]
      : dirStops[0];
    setBoardingStop(bStop);

    // Destination = last stop in current trip direction
    setCollegeStop(dirStops[dirStops.length-1]);
  },[user?.assignedBusId,user?.boardingStop,buses,directionTick]);

  /* ─ ETA: recompute on every GPS update (like Google Maps) ─ */
  useEffect(() => {
    if (!myBusLoc || !boardingStop || !collegeStop) return;
    if (etaComputingRef.current) return;
    etaComputingRef.current = true;
    setEtaLoading(true);

    pushSpeed(myBusLoc.speed);

    /* Detect if bus has PASSED the student's boarding stop.
       Once it has moved past the stop, show ETA to the current destination. */
    const distBusToMyStop = Math.sqrt(
      Math.pow((myBusLoc.lat - boardingStop.lat) * 111, 2) +
      Math.pow((myBusLoc.lng - boardingStop.lng) * 111 * Math.cos(boardingStop.lat * Math.PI/180), 2)
    ) * 1000; // metres

    if (distBusToMyStop > 100000) {
      // Tracker is out of range (e.g. Taiwan) -> skip OSRM calls and use static fallback route totals
      const startStop = myRouteStops[0] || boardingStop;
      
      // Compute segment from start of route to boarding stop
      let segmentStopKm = 0;
      const startIdx = myRouteStops.findIndex(s => s.name === startStop.name);
      const boardingIdx = myRouteStops.findIndex(s => s.name === boardingStop.name);
      if (startIdx !== -1 && boardingIdx !== -1 && startIdx < boardingIdx) {
        for (let i = startIdx; i < boardingIdx; i++) {
          segmentStopKm += hav(myRouteStops[i].lat, myRouteStops[i].lng, myRouteStops[i+1].lat, myRouteStops[i+1].lng);
        }
      } else {
        segmentStopKm = hav(startStop.lat, startStop.lng, boardingStop.lat, boardingStop.lng);
      }
      const distStopKm = +(segmentStopKm * 1.25).toFixed(2);
      const etaStopMin = Math.max(1, Math.round((distStopKm / 25) * 60));

      // Compute segment from start of route to college
      let segmentCampusKm = 0;
      const collegeIdx = myRouteStops.findIndex(s => s.name === collegeStop.name);
      if (startIdx !== -1 && collegeIdx !== -1 && startIdx < collegeIdx) {
        for (let i = startIdx; i < collegeIdx; i++) {
          segmentCampusKm += hav(myRouteStops[i].lat, myRouteStops[i].lng, myRouteStops[i+1].lat, myRouteStops[i+1].lng);
        }
      } else {
        segmentCampusKm = hav(startStop.lat, startStop.lng, collegeStop.lat, collegeStop.lng);
      }
      const distCampusKm = +(segmentCampusKm * 1.25).toFixed(2);
      const etaCampusMin = Math.max(1, Math.round((distCampusKm / 25) * 60));

      setEtaToMyStop({
        distKm: distStopKm,
        etaMin: etaStopMin,
        speedKmh: 0,
        source: "routing",
      });
      setEtaToCampus({
        distKm: distCampusKm,
        etaMin: etaCampusMin,
        speedKmh: 0,
        source: "routing",
      });
      setEtaLoading(false);
      etaComputingRef.current = false;
      return;
    }

    // Check route order: if bus is closer to destination than to boarding stop,
    // it has likely passed the boarding stop
    const distBusToCollege = Math.sqrt(
      Math.pow((myBusLoc.lat - collegeStop.lat) * 111, 2) +
      Math.pow((myBusLoc.lng - collegeStop.lng) * 111 * Math.cos(collegeStop.lat * Math.PI/180), 2)
    ) * 1000;
    const distMyStopToCollege = Math.sqrt(
      Math.pow((boardingStop.lat - collegeStop.lat) * 111, 2) +
      Math.pow((boardingStop.lng - collegeStop.lng) * 111 * Math.cos(boardingStop.lat * Math.PI/180), 2)
    ) * 1000;

    // Bus has passed stop if: bus is closer to destination than boarding stop is
    const hasPassed = distBusToCollege < distMyStopToCollege * 0.85;
    setBusPastMyStop(hasPassed);

    if (hasPassed) {
      /* Bus has passed my stop → show only ETA bus→destination */
      computeEta(myBusLoc.lat, myBusLoc.lng, collegeStop.lat, collegeStop.lng, myBusLoc.speed)
        .then(toCampus => {
          if (toCampus) setEtaToCampus({ distKm: toCampus.distKm, etaMin: toCampus.etaMin, speedKmh: toCampus.speedKmh, source: toCampus.source });
          setEtaToMyStop(null);  // bus already passed your stop
          setEtaLoading(false);
          etaComputingRef.current = false;
        }).catch(() => { setEtaLoading(false); etaComputingRef.current = false; });
    } else {
      /* Bus approaching → compute ETA bus→my stop AND bus→destination */
      Promise.all([
        computeEta(myBusLoc.lat, myBusLoc.lng, boardingStop.lat, boardingStop.lng, myBusLoc.speed),
        computeEta(myBusLoc.lat, myBusLoc.lng, collegeStop.lat,  collegeStop.lng,  myBusLoc.speed),
      ]).then(([toStop, toCampus]) => {
        if (toStop)   setEtaToMyStop  ({ distKm: toStop.distKm,   etaMin: toStop.etaMin,   speedKmh: toStop.speedKmh,   source: toStop.source });
        if (toCampus) setEtaToCampus  ({ distKm: toCampus.distKm, etaMin: toCampus.etaMin, speedKmh: toCampus.speedKmh, source: toCampus.source });
        
        // 5 km Proximity Notification (Morning Only: 5 AM - 12 PM)
        const distKm = toStop ? toStop.distKm : (distBusToMyStop / 1000);
        if (distKm <= 5.0) {
          const now = new Date();
          const hr = now.getHours();
          if (hr >= 5 && hr < 12) {
            const todayStr = now.toDateString();
            const lastNotified = localStorage.getItem(`lastProximityAlertDate_${user?.id || "guest"}`);
            if (lastNotified !== todayStr) {
              localStorage.setItem(`lastProximityAlertDate_${user?.id || "guest"}`, todayStr);
              triggerAppNotification(
                "🚍 Bus Approaching!",
                `Bus ${myBusLoc.busId} is within 5.0 km of your boarding stop (${boardingStop.name}).`,
                "proximity"
              );
            }
          }
        }

        setEtaLoading(false);
        etaComputingRef.current = false;
      }).catch(() => { setEtaLoading(false); etaComputingRef.current = false; });
    }
  }, [myBusLoc, boardingStop, collegeStop, myRouteStops]);

  /* Clear speed buffer when bus goes inactive */
  useEffect(() => {
    if (!myBusLoc) { clearSpeedBuffer(); setBusPastMyStop(false); }
  }, [myBusLoc]);

  /* ─ All Buses tab: select bus ─ */
  const selectAllBus = useCallback((busId:string) => {
    setSelectedAllBus(busId);
    const bus = buses.find(b=>b.busId===busId);
    if (bus?.route) {
      setAllStops(getDirectionalStops(bus.route as any));
      setAllAutoFly(true);
      setTimeout(()=>setAllAutoFly(false),3000);
    }
    getSocket().emit("track-bus",busId);
  },[buses]);

  useEffect(() => {
    if (!selectedAllBus) return;
    const bus = buses.find(b=>b.busId===selectedAllBus);
    if (bus?.route) setAllStops(getDirectionalStops(bus.route as any));
  }, [selectedAllBus, buses, directionTick]);

  /* ─ Profile save ─ */
  const saveProfile = async () => {
    if (!token) return;
    if (profileForm.phone && !/^\d{10}$/.test(profileForm.phone.trim())) {
      setProfileMsg({ text: "Mobile number must be exactly 10 digits", ok: false });
      setTimeout(() => setProfileMsg(null), 4000);
      return;
    }
    if (profileForm.parentContact && !/^\d{10}$/.test(profileForm.parentContact.trim())) {
      setProfileMsg({ text: "Parent contact number must be exactly 10 digits", ok: false });
      setTimeout(() => setProfileMsg(null), 4000);
      return;
    }
    setProfileSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(profileForm),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) throw new Error("Server error");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      updateUser({ name: data.name, phone: data.phone, parentContact: data.parentContact, village: data.village, boardingStop: data.boardingStop, assignedBusId: data.assignedBusId, studentId: data.studentId });
      setProfileMsg({ text: "✅ Profile updated!", ok: true });
    } catch (e: any) { setProfileMsg({ text: e.message, ok: false }); }
    finally { setProfileSaving(false); setTimeout(() => setProfileMsg(null), 4000); }
  };

  const changePassword = async () => {
    if (!token) return;
    if (pwForm.newPw !== pwForm.confirm) { setProfileMsg({ text: "Passwords don't match", ok: false }); return; }
    if (pwForm.newPw.length < 6) {
      setProfileMsg({ text: "Password must be at least 6 characters long", ok: false });
      setTimeout(() => setProfileMsg(null), 4000);
      return;
    }
    setProfileSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: pwForm.current, newPassword: pwForm.newPw }),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) throw new Error("Server error");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setProfileMsg({ text: "✅ Password changed!", ok: true });
      setPwForm({ current: "", newPw: "", confirm: "" });
    } catch (e: any) { setProfileMsg({ text: e.message, ok: false }); }
    finally { setProfileSaving(false); setTimeout(() => setProfileMsg(null), 4000); }
  };

  /* ─ derived ─ */
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F1F5F9]">
        <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      if (isRegisterMode) {
        if (regPassword.length < 6) {
          throw new Error("Password must be at least 6 characters long");
        }
        if (regPhone && !/^\d{10}$/.test(regPhone.trim())) {
          throw new Error("Mobile number must be exactly 10 digits");
        }
        if (regParentContact && !/^\d{10}$/.test(regParentContact.trim())) {
          throw new Error("Parent contact number must be exactly 10 digits");
        }
        await register({
          name: regName,
          email: regEmail,
          password: regPassword,
          role: "student",
          phone: regPhone,
          parentContact: regParentContact,
          village: regVillage,
          boardingStop: regBoardingStop,
          assignedBusId: regBusId,
          studentId: regStudentId,
        });
      } else {
        await login(loginEmail, loginPassword, "student");
      }
    } catch (err: any) {
      setLoginError(err.message || "Failed to authenticate");
    } finally {
      setLoginLoading(false);
    }
  };

  /* ─ derived ─ */
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F1F5F9]">
        <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== "student") {
    const selectedBus = buses.find(b => b.busId === regBusId);
    const availableStops = selectedBus?.route?.stops ?? [];

    return (
      <NotificationWrapper
        activeNotification={activeNotification}
        setActiveNotification={setActiveNotification}
      >
        <div className="min-h-full bg-[#F1F5F9] pb-8">
          {/* Header */}
          <header className="glass border-b border-[#DBEAFE] sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <div className="flex items-center justify-between h-16">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center bg-white border border-gray-100 shadow-sm">
                    <img src="/aditya-logo.png" alt="Aditya University Logo" className="w-full h-full object-contain p-0.5" />
                  </div>
                  <div>
                    <h1 className="text-lg font-extrabold tracking-wide"><span className="text-[#F27A35]">ADITYA</span> <span className="text-[#2563EB]">UNIVERSITY</span></h1>
                    <p className="text-xs text-gray-500">Not Signed In</p>
                  </div>
                </div>
                <a href="/" className="text-sm text-[#2563EB] font-medium hover:underline">Home</a>
              </div>
            </div>
          </header>

          {/* Content */}
          <div className="max-w-md mx-auto px-4 py-12 animate-slide-up">
            <div className="glass-solid rounded-2xl p-8 shadow-2xl relative">
              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-gradient-to-br from-[#2563EB] to-[#3B82F6] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-200">
                  <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-[#1E293B]">
                  {isRegisterMode ? "Student Registration" : "Student Login"}
                </h2>
                <p className="text-gray-500 text-sm mt-1">
                  {isRegisterMode ? "Create an account to track your university bus" : "Sign in to track your bus in real time"}
                </p>
              </div>

              <form onSubmit={handleStudentSubmit} className="space-y-4">
                {loginError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                    {loginError}
                  </div>
                )}

                {isRegisterMode ? (
                  /* Registration Fields */
                  <div className="space-y-3">
                    <div className="bg-[#F8FAFC] rounded-xl p-3 space-y-2 border border-gray-100">
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Personal Details</p>
                      <input
                        type="text"
                        placeholder="Full Name *"
                        value={regName}
                        onChange={e => setRegName(e.target.value)}
                        className="input-field"
                        required
                      />
                      <input
                        type="email"
                        placeholder="Email Address *"
                        value={regEmail}
                        onChange={e => setRegEmail(e.target.value)}
                        className="input-field"
                        required
                      />
                      <input
                        type="password"
                        placeholder="Password *"
                        value={regPassword}
                        onChange={e => setRegPassword(e.target.value)}
                        className="input-field"
                        required
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="tel"
                          placeholder="Phone Number"
                          value={regPhone}
                          onChange={e => setRegPhone(e.target.value)}
                          className="input-field"
                        />
                        <input
                          type="text"
                          placeholder="Student ID / Roll No"
                          value={regStudentId}
                          onChange={e => setRegStudentId(e.target.value)}
                          className="input-field"
                        />
                      </div>
                      <input
                        type="tel"
                        placeholder="Parent Contact Number"
                        value={regParentContact}
                        onChange={e => setRegParentContact(e.target.value)}
                        className="input-field"
                      />
                    </div>

                    <div className="bg-[#EFF6FF] border border-[#DBEAFE] rounded-xl p-3 space-y-2">
                      <p className="text-xs font-bold text-[#2563EB] uppercase tracking-wide">🚍 Bus Assignment</p>
                      <input
                        type="text"
                        placeholder="Your Village / Area *"
                        value={regVillage}
                        onChange={e => setRegVillage(e.target.value)}
                        className="input-field"
                        required
                      />
                      <select
                        className="input-field"
                        value={regBusId}
                        onChange={e => { setRegBusId(e.target.value); setRegBoardingStop(""); }}
                      >
                        <option value="">— Select your bus (optional) —</option>
                        {buses.map(b => (
                          <option key={b.busId} value={b.busId}>
                            {b.busId} · {b.route?.stops?.join(" → ") ?? ""}
                          </option>
                        ))}
                      </select>

                      {regBusId && availableStops.length > 0 && (
                        <select
                          className="input-field"
                          value={regBoardingStop}
                          onChange={e => setRegBoardingStop(e.target.value)}
                        >
                          <option value="">— Select your boarding stop —</option>
                          {availableStops.map((s, i) => <option key={i} value={s}>{s}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Login Fields */
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Email Address</label>
                      <input
                        type="email"
                        placeholder="email@domain.com"
                        value={loginEmail}
                        onChange={e => setLoginEmail(e.target.value)}
                        className="input-field"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Password</label>
                      <input
                        type="password"
                        placeholder="••••••••"
                        value={loginPassword}
                        onChange={e => setLoginPassword(e.target.value)}
                        className="input-field"
                        required
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="btn-primary w-full text-base py-3 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loginLoading ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Processing…
                    </>
                  ) : (
                    isRegisterMode ? "Create Account" : "Sign In"
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => { setIsRegisterMode(!isRegisterMode); setLoginError(""); }}
                  className="text-sm text-[#2563EB] font-semibold hover:underline"
                >
                  {isRegisterMode ? "Already have an account? Sign In" : "New student? Register here"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </NotificationWrapper>
    );
  }

  const myBus    = buses.find(b=>b.busId===user?.assignedBusId);
  const myIsLive = user?.assignedBusId ? activeBusIds.includes(user.assignedBusId) : false;
  const myDirection = myBus?.route ? getTripDirection(myBus.route as any) : null;
  const myDirectionBadge = myDirection ? getDirectionBadge(myDirection) : null;
  const myStartEnd = myBus?.route && myDirection ? getStartEnd(myBus.route as any, myDirection) : null;
  const unseenAlertCount = alerts.filter(alert => !seenAlertKeys.has(alertKey(alert))).length;
  const openAlerts = () => {
    const nextSeen = new Set(seenAlertKeys);
    alerts.forEach(alert => nextSeen.add(alertKey(alert)));
    setSeenAlertKeys(nextSeen);
    if (user?.id) localStorage.setItem(`student_alerts_seen_${user.id}`, JSON.stringify([...nextSeen]));
    setShowAlerts(true);
  };

  const filteredBuses = buses.filter(b => {
    const q = search.toLowerCase();
    return !q
      || b.busId.toLowerCase().includes(q)
      || b.busNumber.toLowerCase().includes(q)
      || b.route?.routeName?.toLowerCase().includes(q)
      || b.route?.stops?.some(s=>s.toLowerCase().includes(q));
  });

  /* ════════════════════════════════════════
     RENDER
  ════════════════════════════════════════ */
  return (
    <NotificationWrapper
      activeNotification={activeNotification}
      setActiveNotification={setActiveNotification}
    >
      <div className="min-h-full bg-[#F1F5F9]">

      {/* ── HEADER ── */}
      <header className="glass border-b border-[#DBEAFE] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center bg-white border border-gray-100 shadow-sm">
                <img src="/aditya-logo.png" alt="Aditya University Logo" className="w-full h-full object-contain p-0.5" />
              </div>
              <div>
                <h1 className="text-lg font-extrabold tracking-wide"><span className="text-[#F27A35]">ADITYA</span> <span className="text-[#2563EB]">UNIVERSITY</span></h1>
                {user && <p className="text-xs text-gray-500">Welcome, {user.name}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {user && (
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
              )}
              {activeBusIds.length > 0 && (
                <span className="flex items-center gap-1.5 text-xs font-semibold bg-green-100 text-green-700 px-3 py-1.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full pulse-dot"/>
                  {activeBusIds.length} live
                </span>
              )}
              {user
                ? <button onClick={logout} className="text-sm text-gray-400 hover:text-red-500 font-medium">Logout</button>
                : <a href="/" className="text-sm text-[#2563EB] font-medium hover:underline">Sign In</a>
              }
            </div>
          </div>
        </div>
      </header>

      {/* ── BOTTOM TAB BAR (mobile-style sticky nav) ── */}
      <div className="sticky top-16 z-40 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex">
            {([
              { id:"mybus",      icon:"🚍", label:"My Bus" },
              { id:"allbuses",   icon:"🗺️", label:"All Buses" },
              { id:"complaints", icon:"📋", label:"Complaints" },
              { id:"profile",    icon:"👤", label:"Profile" },
            ] as {id:PageTab;icon:string;label:string}[]).map(tab => (
              <button key={tab.id} onClick={() => setPageTab(tab.id)}
                className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 text-sm font-semibold transition-all border-b-2 ${
                  pageTab===tab.id ? "border-[#2563EB] text-[#2563EB]" : "border-transparent text-gray-500 hover:text-gray-700"
                }`}>
                <span className="text-lg sm:text-base">{tab.icon}</span>
                <span className="text-xs sm:text-sm">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">

        {/* ══════════════════════════════════
            TAB 1: MY BUS
        ══════════════════════════════════ */}
        {pageTab==="mybus" && (
          <div className="space-y-4 animate-fade-in">

            {/* No bus assigned */}
            {!user?.assignedBusId && (
              <div className="card text-center py-12">
                <div className="text-5xl mb-4">🚍</div>
                <h2 className="text-xl font-bold text-[#1E293B] mb-2">No Bus Assigned</h2>
                <p className="text-gray-500 text-sm mb-5 max-w-sm mx-auto">
                  You haven't been assigned a bus yet. Go to your <strong>Profile</strong> tab to select your bus and boarding stop.
                </p>
                <button onClick={()=>setPageTab("profile")} className="btn-primary px-6 py-2.5">
                  Go to Profile →
                </button>
              </div>
            )}

            {user?.assignedBusId && (<>

              {/* Bus status card */}
              <div className={`card-blue p-5`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17 20H7v1a1 1 0 01-1 1H5a1 1 0 01-1-1v-1H3V8c0-3.5 3.58-4 9-4s9 .5 9 4v12h1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1zM5 14h14v-4H5v4zm0 2v2h3v-2H5zm11 0v2h3v-2h-3zM6.5 12a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm11 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/>
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-xl font-extrabold text-white">{user.assignedBusId}</h2>
                      <p className="text-blue-200 text-sm">{myBus?.route?.routeName ?? "—"}</p>
                      {myDirectionBadge && myStartEnd && (
                        <p className="text-blue-100 text-xs font-semibold mt-1">
                          {myDirectionBadge.emoji} {myDirectionBadge.label}: {myStartEnd.start} → {myStartEnd.end}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {myIsLive
                      ? <span className="flex items-center gap-1.5 text-xs font-bold bg-green-500 text-white px-3 py-1.5 rounded-full"><span className="w-1.5 h-1.5 bg-white rounded-full pulse-dot"/>LIVE</span>
                      : <span className="text-xs font-bold bg-white/20 text-white px-3 py-1.5 rounded-full">Not Active</span>
                    }
                    {myBusLoc && <p className="text-blue-200 text-xs mt-1">{myBusLoc.speed.toFixed(1)} km/h</p>}
                  </div>
                </div>

                {/* Boarding stop + destination */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/15 rounded-xl p-3">
                    <p className="text-blue-200 text-xs font-semibold mb-1">📍 Your Stop</p>
                    <p className="text-white font-bold text-sm truncate">{user.boardingStop || boardingStop?.name || "Not set"}</p>
                  </div>
                  <div className="bg-white/15 rounded-xl p-3">
                    <p className="text-blue-200 text-xs font-semibold mb-1">🏁 Destination</p>
                    <p className="text-white font-bold text-sm truncate">{collegeStop?.name ?? myStartEnd?.end ?? "—"}</p>
                  </div>
                </div>
              </div>

              {/* ETA cards */}
              {myIsLive && (
                <div className="space-y-3">
                  {/* Bus passed my stop banner */}
                  {busPastMyStop && (
                    <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                      <span className="text-2xl">⚠️</span>
                      <div>
                        <p className="text-sm font-bold text-amber-800">Bus has passed your boarding stop</p>
                        <p className="text-xs text-amber-600">Showing ETA to destination only</p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* Speed */}
                    <div className="card py-3 px-4 text-center">
                      <p className="text-2xl mb-1">⚡</p>
                      <p className="text-2xl font-extrabold leading-none text-[#2563EB]">
                        {myBusLoc ? myBusLoc.speed.toFixed(0) : "--"}
                      </p>
                      <p className="text-xs text-gray-500 font-semibold mt-0.5">km/h</p>
                      <p className="text-[10px] text-gray-400 mt-1">Current Speed</p>
                    </div>

                    {/* ETA to my stop (only if bus hasn't passed) */}
                    <div className={`card py-3 px-4 text-center ${busPastMyStop ? "opacity-40" : ""}`}>
                      <p className="text-2xl mb-1">{busPastMyStop ? "✅" : "🏃"}</p>
                      <p className={`text-2xl font-extrabold leading-none ${busPastMyStop ? "text-gray-400" : "text-green-600"}`}>
                        {busPastMyStop
                          ? "Passed"
                          : etaLoading ? "…"
                          : etaToMyStop ? formatEta(etaToMyStop.etaMin)
                          : "--"}
                      </p>
                      {!busPastMyStop && etaToMyStop && (
                        <p className="text-xs text-gray-400 mt-0.5">{formatDist(etaToMyStop.distKm)} road</p>
                      )}
                      <p className="text-[10px] text-gray-400 mt-1">To Your Stop</p>
                    </div>

                    {/* ETA to current destination */}
                    <div className="card py-3 px-4 text-center">
                      <p className="text-2xl mb-1">🏁</p>
                      <p className="text-2xl font-extrabold leading-none text-amber-600">
                        {etaLoading ? "…" : etaToCampus ? formatEta(etaToCampus.etaMin) : "--"}
                      </p>
                      {etaToCampus && (
                        <p className="text-xs text-gray-400 mt-0.5">{formatDist(etaToCampus.distKm)} road</p>
                      )}
                      <p className="text-[10px] text-gray-400 mt-1">To Destination</p>
                    </div>

                    {/* Distance remaining */}
                    <div className="card py-3 px-4 text-center">
                      <p className="text-2xl mb-1">📍</p>
                      <p className="text-2xl font-extrabold leading-none text-purple-600">
                        {busPastMyStop
                          ? (etaToCampus ? formatDist(etaToCampus.distKm) : "--")
                          : (etaToMyStop ? formatDist(etaToMyStop.distKm) : "--")
                        }
                      </p>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {busPastMyStop ? "Bus→Destination" : "Bus→Your Stop"}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Not live message */}
              {!myIsLive && (
                <div className="card text-center py-8 border-2 border-dashed border-gray-200">
                  <div className="text-3xl mb-2">⏳</div>
                  <p className="text-sm font-semibold text-gray-600">Bus not active yet</p>
                  <p className="text-xs text-gray-400 mt-1">ETA will appear here once the driver starts the trip</p>
                </div>
              )}

              {/* My bus map */}
              <div className="card p-0 overflow-hidden shadow-md">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-bold text-[#1E293B] text-sm">Live Map — {user.assignedBusId}</h3>
                  {myIsLive && myBusLoc && (
                    <span className="text-xs text-gray-400 font-mono">
                      {myBusLoc.lat.toFixed(4)}, {myBusLoc.lng.toFixed(4)}
                    </span>
                  )}
                </div>
                <TrackingMap
                  busLocations={myIsLive && myBusLoc
                    ? new Map([[user.assignedBusId, myBusLoc]])
                    : new Map()
                  }
                  selectedBusId={user.assignedBusId}
                  routeStops={myRouteStops}
                  allRoutes={routes}
                  autoFlyToStart={false}
                />
              </div>

              {/* Boarding stop info */}
              {boardingStop && myIsLive && myBusLoc && (
                <div className={`card border ${busPastMyStop ? "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200" : "bg-gradient-to-r from-green-50 to-emerald-50 border-green-200"}`}>
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${busPastMyStop ? "bg-amber-500" : "bg-green-500"}`}>
                      <span className="text-white font-black text-lg">{busPastMyStop ? "✓" : "A"}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold uppercase tracking-wide ${busPastMyStop ? "text-amber-600" : "text-green-600"}`}>
                        {busPastMyStop ? "Bus Passed Your Stop" : "Your Boarding Stop"}
                      </p>
                      <p className={`text-base font-extrabold mt-0.5 ${busPastMyStop ? "text-amber-900" : "text-green-900"}`}>{boardingStop.name}</p>
                      {!busPastMyStop && etaToMyStop && (
                        <div className="mt-1.5 space-y-0.5">
                          <p className="text-sm font-bold text-green-800">
                            🚍 Bus arrives at your stop in <strong>{formatEta(etaToMyStop.etaMin)}</strong>
                          </p>
                          <p className="text-xs text-green-600">
                            {formatDist(etaToMyStop.distKm)} by road
                            {etaToMyStop.speedKmh > 3 && <> · bus moving at {etaToMyStop.speedKmh.toFixed(0)} km/h</>}
                          </p>
                        </div>
                      )}
                      {busPastMyStop && etaToCampus && (
                        <div className="mt-1.5">
                          <p className="text-sm font-bold text-amber-800">
                            🏁 Bus reaches destination in <strong>{formatEta(etaToCampus.etaMin)}</strong>
                          </p>
                          <p className="text-xs text-amber-600">{formatDist(etaToCampus.distKm)} remaining to destination</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </>)}
          </div>
        )}

        {/* ══════════════════════════════════
            TAB 2: ALL BUSES — Split panel layout
        ══════════════════════════════════ */}
        {pageTab==="allbuses" && (
          <div className="animate-fade-in flex flex-col lg:flex-row gap-4" style={{ minHeight:"calc(100vh - 200px)" }}>

            {/* ── LEFT: Search + Bus List ── */}
            <div className="w-full lg:w-[360px] shrink-0 flex flex-col gap-3">

              {/* Search */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-1.5 flex gap-2">
                <div className="flex-1 relative">
                  <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                  <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
                    placeholder="Search bus, route, stop…"
                    className="w-full pl-12 pr-4 py-3 text-sm font-medium text-[#1E293B] placeholder:text-gray-400 rounded-xl outline-none bg-transparent"/>
                </div>
                {search && <button onClick={()=>setSearch("")} className="px-4 text-gray-400 hover:text-gray-600 font-bold text-xl">×</button>}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2">
                {[{l:"Total",v:buses.length,c:"text-[#2563EB]"},{l:"Live",v:activeBusIds.length,c:"text-green-600"},{l:"Routes",v:routes.length,c:"text-[#2563EB]"}].map(s=>(
                  <div key={s.l} className="bg-white rounded-xl border border-gray-100 py-2 text-center shadow-sm">
                    <p className={`text-lg font-extrabold ${s.c}`}>{s.v}</p>
                    <p className="text-[10px] text-gray-400 font-semibold">{s.l}</p>
                  </div>
                ))}
              </div>

              {/* Bus list */}
              <div className="flex-1 space-y-2 overflow-y-auto lg:max-h-[calc(100vh-300px)]">
                {filteredBuses.length===0 && (
                  <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
                    <p className="text-3xl mb-2">🔍</p>
                    <p className="text-sm font-semibold text-gray-500">No buses match &ldquo;{search}&rdquo;</p>
                  </div>
                )}
                {filteredBuses.map(bus=>{
                  const isLive=activeBusIds.includes(bus.busId);
                  const isMyBus=bus.busId===user?.assignedBusId;
                  const isSel=selectedAllBus===bus.busId;
                  const loc=busLocations.get(bus.busId);
                  const dir=bus.route?getTripDirection(bus.route as any):"morning";
                  const badge=getDirectionBadge(dir);
                  const se=bus.route?getStartEnd(bus.route as any,dir):null;
                  return(
                    <div key={bus.busId} onClick={()=>selectAllBus(bus.busId)}
                      className={`bg-white rounded-2xl border-2 cursor-pointer transition-all shadow-sm hover:shadow-md ${isSel?"border-[#2563EB] bg-[#EFF6FF]":isMyBus?"border-green-400":"border-transparent hover:border-[#DBEAFE]"}`}>
                      <div className="p-3.5">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isLive?"bg-gradient-to-br from-[#2563EB] to-[#3B82F6]":"bg-gray-100"}`}>
                              <svg className={`w-5 h-5 ${isLive?"text-white":"text-gray-400"}`} fill="currentColor" viewBox="0 0 24 24"><path d="M17 20H7v1a1 1 0 01-1 1H5a1 1 0 01-1-1v-1H3V8c0-3.5 3.58-4 9-4s9 .5 9 4v12h1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1zM5 14h14v-4H5v4zm0 2v2h3v-2H5zm11 0v2h3v-2h-3zM6.5 12a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm11 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/></svg>
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="font-extrabold text-[#1E293B] text-sm">{bus.busId}</span>
                                {isMyBus&&<span className="text-[9px] bg-green-100 text-green-700 font-black px-1.5 py-0.5 rounded-full">MY BUS</span>}
                              </div>
                              <p className="text-[10px] text-gray-400 truncate">{bus.busNumber}</p>
                            </div>
                          </div>
                          {isLive
                            ?<span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0"><span className="w-1.5 h-1.5 bg-green-500 rounded-full pulse-dot"/>{loc?`${loc.speed.toFixed(0)} km/h`:"LIVE"}</span>
                            :<span className="text-[10px] font-semibold bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full flex-shrink-0">Inactive</span>
                          }
                        </div>
                        {bus.route&&(
                          <div className="space-y-1">
                            <p className="text-xs font-semibold text-gray-600 truncate">{bus.route.routeName}</p>
                            {se?(
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded-full truncate max-w-[140px]">🟢 {se.start}</span>
                                <svg className="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
                                <span className="text-[10px] bg-red-100 text-red-800 font-bold px-2 py-0.5 rounded-full truncate max-w-[140px]">🔴 {se.end}</span>
                              </div>
                            ):(
                              <div className="flex flex-wrap items-center gap-1">
                                {bus.route.stops?.map((s,i)=>(
                                  <React.Fragment key={i}>
                                    {i>0&&<span className="text-gray-300 text-xs">›</span>}
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${i===0?"bg-green-100 text-green-700":i===bus.route!.stops.length-1?"bg-red-100 text-red-700":"bg-gray-100 text-gray-500"}`}>{s}</span>
                                  </React.Fragment>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-3 text-[10px] text-gray-400">
                              {bus.route.distance&&<span>📏 {bus.route.distance}km</span>}
                              {bus.route.estimatedDuration&&<span>⏱~{bus.route.estimatedDuration}min</span>}
                              <span className={`font-bold ${dir==="morning"?"text-amber-600":"text-purple-600"}`}>{badge.emoji}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── RIGHT: Map + Details ── */}
            <div className="flex-1 flex flex-col gap-4 min-w-0">
              {!selectedAllBus&&(
                <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-center" style={{minHeight:"400px"}}>
                  <div className="text-center px-8 py-12">
                    <div className="w-16 h-16 bg-[#DBEAFE] rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-[#2563EB]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
                    </div>
                    <p className="text-base font-bold text-[#1E293B] mb-1">Select a bus to track</p>
                    <p className="text-sm text-gray-400 max-w-xs mx-auto">Click any bus from the list on the left to see its live location, route map, and stop details</p>
                  </div>
                </div>
              )}

              {selectedAllBus&&(()=>{
                const selBus=buses.find(b=>b.busId===selectedAllBus);
                const selLoc=busLocations.get(selectedAllBus);
                const isLive=activeBusIds.includes(selectedAllBus);
                const dir=selBus?.route?getTripDirection(selBus.route as any):"morning";
                const badge=getDirectionBadge(dir);
                const se=selBus?.route?getStartEnd(selBus.route as any,dir):null;
                return(
                  <>
                    {/* Header detail card */}
                    <div className="bg-gradient-to-r from-[#1D4ED8] to-[#2563EB] rounded-2xl p-4 text-white">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center">
                            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M17 20H7v1a1 1 0 01-1 1H5a1 1 0 01-1-1v-1H3V8c0-3.5 3.58-4 9-4s9 .5 9 4v12h1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1zM5 14h14v-4H5v4zm0 2v2h3v-2H5zm11 0v2h3v-2h-3zM6.5 12a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm11 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/></svg>
                          </div>
                          <div>
                            <h3 className="text-xl font-extrabold">{selectedAllBus}</h3>
                            <p className="text-blue-200 text-xs">{selBus?.busNumber} · Capacity: {selBus?.capacity??"-"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isLive
                            ?<span className="flex items-center gap-1.5 text-xs font-bold bg-green-500 text-white px-3 py-1.5 rounded-full"><span className="w-1.5 h-1.5 bg-white rounded-full pulse-dot"/>LIVE{selLoc&&` · ${selLoc.speed.toFixed(0)} km/h`}</span>
                            :<span className="text-xs font-bold bg-white/20 text-white px-3 py-1.5 rounded-full">Inactive</span>
                          }
                          <button onClick={()=>{setSelectedAllBus(null);setAllStops([]);}}
                            className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center text-white font-bold transition-colors">✕</button>
                        </div>
                      </div>
                      {selBus?.route&&(
                        <div className="bg-white/10 rounded-xl p-3">
                          <p className="text-sm font-bold text-white mb-2">{selBus.route.routeName}</p>
                          {se&&(
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs bg-green-500 text-white font-bold px-2.5 py-1 rounded-full">🟢 {se.start}</span>
                              <svg className="w-4 h-4 text-blue-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
                              <span className="text-xs bg-red-500 text-white font-bold px-2.5 py-1 rounded-full">🔴 {se.end}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-3 text-xs text-blue-200 mt-2">
                            {selBus.route.distance&&<span>📏 {selBus.route.distance} km</span>}
                            {selBus.route.estimatedDuration&&<span>⏱ ~{selBus.route.estimatedDuration} min</span>}
                            <span>{badge.emoji} {badge.label}</span>
                          </div>
                        </div>
                      )}
                      {isLive&&selLoc&&(
                        <div className="grid grid-cols-3 gap-2 mt-3">
                          {[{l:"Speed",v:`${selLoc.speed.toFixed(1)}`,u:"km/h"},{l:"Lat",v:`${selLoc.lat.toFixed(4)}`,u:"°N"},{l:"Lng",v:`${selLoc.lng.toFixed(4)}`,u:"°E"}].map(s=>(
                            <div key={s.l} className="bg-white/10 rounded-xl py-2 px-3 text-center">
                              <p className="text-sm font-extrabold text-white">{s.v}</p>
                              <p className="text-[10px] text-blue-200">{s.u}</p>
                              <p className="text-[9px] text-blue-300 uppercase">{s.l}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Live map */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden" style={{minHeight:"400px"}}>
                      <TrackingMap
                        busLocations={busLocations}
                        selectedBusId={selectedAllBus}
                        routeStops={allStops}
                        allRoutes={routes}
                        autoFlyToStart={allAutoFly}
                      />
                    </div>

                    {/* Stops list */}
                    {allStops.length>0&&(
                      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Route Stops</p>
                        <div className="relative">
                          <div className="absolute left-[11px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-green-400 via-[#2563EB] to-red-400 opacity-30"/>
                          {allStops.map((stop,idx)=>{
                            const isFirst=idx===0,isLast=idx===allStops.length-1;
                            return(
                              <div key={idx} className="flex items-center gap-3 py-2">
                                <div className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${isFirst?"bg-green-500":isLast?"bg-red-500":"bg-white border-2 border-[#2563EB]"}`}>
                                  <span className="text-white font-black text-[9px]">{isFirst?"A":isLast?"B":idx+1}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm font-semibold truncate ${isFirst?"text-green-700":isLast?"text-red-700":"text-[#1E293B]"}`}>{stop.name}</p>
                                  <p className="text-xs text-gray-400">{isFirst?"Starting point":isLast?"Destination":`Stop ${idx+1}`}</p>
                                </div>
                                {(isFirst||isLast)&&<span className={`text-[10px] font-black px-2 py-0.5 rounded-full flex-shrink-0 ${isFirst?"bg-green-100 text-green-700":"bg-red-100 text-red-700"}`}>{isFirst?"START":"END"}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════
            TAB 3: PROFILE
        ══════════════════════════════════ */}
        {pageTab==="profile" && user && (
          <div className="grid lg:grid-cols-12 gap-6 animate-fade-in max-w-5xl mx-auto">
            {/* Left Column: ID Card & Driver details */}
            <div className="lg:col-span-5 space-y-6">
              {/* Digital Transport ID Card */}
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0F172A] via-[#1E1B4B] to-[#020617] text-white p-6 shadow-xl border border-slate-800">
                {/* Card background glowing circles */}
                <div className="absolute top-[-20%] right-[-10%] w-32 h-32 rounded-full bg-gradient-to-br from-[#F27A35]/20 to-orange-600/20 blur-2xl pointer-events-none" />
                <div className="absolute bottom-[-20%] left-[-10%] w-36 h-36 rounded-full bg-gradient-to-br from-[#2563EB]/20 to-indigo-600/20 blur-2xl pointer-events-none" />
                
                {/* Tech lines background grid pattern */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:14px_14px] pointer-events-none" />

                {/* ID Card Header */}
                <div className="flex items-center justify-between pb-4 border-b border-white/10 relative z-10">
                  <div className="flex items-center gap-2">
                    <img src="/aditya-logo.png" alt="Aditya Logo" className="w-6 h-6 object-contain" />
                    <span className="text-[10px] font-black tracking-widest text-slate-300 uppercase">Aditya Transport ID</span>
                  </div>
                  {/* Chip Icon */}
                  <div className="w-7 h-5.5 rounded bg-gradient-to-br from-amber-400 to-yellow-600 p-0.5 border border-amber-300/30 flex flex-col justify-between shadow-inner">
                    <div className="h-0.5 w-full bg-white/20 rounded-full" />
                    <div className="flex-1 border-t border-b border-black/10 my-0.5 flex">
                      <div className="w-1/2 border-r border-black/10" />
                      <div className="w-1/2" />
                    </div>
                    <div className="h-0.5 w-full bg-white/20 rounded-full" />
                  </div>
                </div>

                {/* ID Card Body */}
                <div className="flex items-start justify-between py-6 relative z-10 gap-3">
                  <div className="flex items-start gap-4 min-w-0">
                    {/* Avatar Wrapper with absolute position remove button outside overflow-hidden */}
                    <div className="relative flex-shrink-0">
                      {/* Avatar Block */}
                      <div 
                        onClick={handlePhotoClick}
                        className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#F27A35] via-amber-500 to-[#2563EB] p-0.5 shadow-md cursor-pointer relative group/avatar overflow-hidden"
                        title="Click to upload profile photo"
                      >
                        <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center overflow-hidden relative">
                          {profilePhoto ? (
                            <img src={profilePhoto} alt="Student Avatar" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-3xl font-black text-white">{user.name?.charAt(0).toUpperCase()}</span>
                          )}
                          {/* Hover Overlay */}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                            <span className="text-[9px] font-bold text-white text-center px-1">Upload Photo</span>
                          </div>
                        </div>
                      </div>

                      {/* Remove Profile Photo Option */}
                      {profilePhoto && (
                        <button
                          onClick={handleRemovePhoto}
                          className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center shadow-lg border border-slate-900 transition-colors z-20 text-[10px] font-bold cursor-pointer"
                          title="Remove profile photo"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Hidden File Input */}
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handlePhotoChange} 
                      accept="image/*" 
                      className="hidden" 
                    />

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-black truncate leading-snug tracking-tight">{user.name}</h3>
                      <p className="text-[10px] font-semibold text-slate-400 truncate mt-0.5">{user.email}</p>
                      <div className="mt-3.5 space-y-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                          <span className="text-slate-500">ID:</span> 
                          <span className="text-white font-extrabold">{user.studentId || "—"}</span>
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                          <span className="text-slate-500">Village:</span> 
                          <span className="text-white font-extrabold truncate">{user.village || "—"}</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* QR Code on the right side */}
                  {qrCodeUrl ? (
                    <div className="w-20 h-20 bg-white rounded-2xl p-1.5 flex items-center justify-center shadow-md flex-shrink-0 border border-slate-700/50 relative group/qr">
                      <img src={qrCodeUrl} alt="Roll No QR" className="w-full h-full object-contain" />
                      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 bg-slate-950/80 text-[8px] font-bold text-slate-300 py-0.5 px-1.5 rounded opacity-0 group-hover/qr:opacity-100 transition-opacity whitespace-nowrap z-20">
                        Roll No QR
                      </div>
                    </div>
                  ) : (
                    <div className="w-20 h-20 bg-white/5 border border-dashed border-white/20 rounded-2xl flex flex-col items-center justify-center text-center p-1 text-[8px] text-slate-500 flex-shrink-0">
                      <span>🪪</span>
                      <span>No Student ID</span>
                    </div>
                  )}
                </div>

                {/* ID Card Bottom Transport Specs */}
                <div className="bg-white/5 rounded-2xl p-3 border border-white/5 relative z-10 flex items-center justify-between text-xs">
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Assigned Bus</p>
                    <p className="text-white font-extrabold mt-0.5 flex items-center gap-1">
                      {user.assignedBusId ? (
                        <>
                          <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                          🚍 {user.assignedBusId}
                        </>
                      ) : (
                        <>
                          <span className="inline-block w-2 h-2 rounded-full bg-red-500"></span>
                          No bus assigned
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-right border-l border-white/10 pl-4">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Boarding Stop</p>
                    <p className="text-white font-extrabold mt-0.5 truncate max-w-[140px]" title={user.boardingStop || "Not set"}>
                      📍 {user.boardingStop || "Not set"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Driver Contact Information */}
              {(() => {
                const myBus = buses.find(b => b.busId === user.assignedBusId);
                const driver = myBus?.driver;
                if (!driver) return null;
                return (
                  <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/50 rounded-3xl border border-blue-100 p-5 space-y-3.5 shadow-sm animate-fade-in">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-[#1E293B] text-sm flex items-center gap-1.5">
                        👨‍✈️ Driver Contact Details
                      </h3>
                      <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                        Bus {user.assignedBusId}
                      </span>
                    </div>
                    <div className="flex items-center justify-between bg-white p-3.5 rounded-2xl border border-blue-150/40 shadow-sm">
                      <div>
                        <p className="text-sm font-black text-[#1E293B]">{driver.name}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5 font-semibold">Driver ID: {driver.driverId}</p>
                        {driver.phone && (
                          <p className="text-xs text-[#2563EB] mt-1.5 font-bold flex items-center gap-1">
                            <span>📞</span> {driver.phone}
                          </p>
                        )}
                      </div>
                      {driver.phone && (
                        <a
                          href={`tel:${driver.phone}`}
                          className="w-10 h-10 bg-gradient-to-r from-[#2563EB] to-[#3B82F6] hover:scale-105 active:scale-95 transition-all text-white rounded-xl flex items-center justify-center shadow-md shadow-blue-500/20"
                          title={`Call ${driver.name}`}
                        >
                          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                            <path d="M6.62 10.79a15.09 15.09 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.11-.27 11.36 11.36 0 0 0 3.58.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.36 11.36 0 0 0 .57 3.58 1 1 0 0 1-.27 1.11z"/>
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Right Column: Flash message & Forms */}
            <div className="lg:col-span-7 space-y-6">
              {/* Flash message */}
              {profileMsg && (
                <div className={`px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ${profileMsg.ok?"bg-green-50 text-green-700 border border-green-200":"bg-red-50 text-red-700 border border-red-200"}`}>
                  {profileMsg.text}
                </div>
              )}

              {/* Edit profile */}
              <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-md space-y-5">
                <div>
                  <h3 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
                    <span>👤</span> Edit Profile Details
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">Manage your personal transport registration information.</p>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Full Name</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">👤</span>
                      <input className="input-field" style={{ paddingLeft: "2.5rem" }} value={profileForm.name} onChange={e=>setProfileForm(f=>({...f,name:e.target.value}))} placeholder="Your full name"/>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Phone Number</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">📞</span>
                      <input className="input-field" style={{ paddingLeft: "2.5rem" }} value={profileForm.phone} onChange={e=>setProfileForm(f=>({...f,phone:e.target.value}))} placeholder="Phone number"/>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Parent Contact</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">👨‍👩‍👦</span>
                      <input className="input-field" style={{ paddingLeft: "2.5rem" }} value={profileForm.parentContact} onChange={e=>setProfileForm(f=>({...f,parentContact:e.target.value}))} placeholder="Parent contact phone"/>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Village / Area</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🏡</span>
                      <input className="input-field" style={{ paddingLeft: "2.5rem" }} value={profileForm.village} onChange={e=>setProfileForm(f=>({...f,village:e.target.value}))} placeholder="Your village/area"/>
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Student ID / Roll No</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🪪</span>
                      <input className="input-field" style={{ paddingLeft: "2.5rem" }} value={profileForm.studentId} onChange={e=>setProfileForm(f=>({...f,studentId:e.target.value}))} placeholder="College roll number"/>
                    </div>
                  </div>
                </div>
                
                <div className="pt-2">
                  <button onClick={saveProfile} disabled={profileSaving} className="w-full sm:w-auto bg-gradient-to-r from-[#2563EB] to-[#3B82F6] hover:from-[#1D4ED8] hover:to-[#2563EB] text-white text-sm font-bold px-6 py-3 rounded-xl transition-all duration-300 shadow-md shadow-blue-200/50 hover:shadow-lg hover:shadow-blue-300/40 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 cursor-pointer">
                    {profileSaving ? "Saving changes..." : "Save Profile Changes"}
                  </button>
                </div>
              </div>

              {/* Change password */}
              <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-md space-y-4">
                <div>
                  <h3 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
                    <span>🔐</span> Change Account Password
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">Protect your transport account with a strong password.</p>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔑</span>
                    <input type="password" className="input-field text-sm" style={{ paddingLeft: "2.5rem" }} placeholder="Current password" value={pwForm.current} onChange={e=>setPwForm(f=>({...f,current:e.target.value}))}/>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🆕</span>
                    <input type="password" className="input-field text-sm" style={{ paddingLeft: "2.5rem" }} placeholder="New password" value={pwForm.newPw}  onChange={e=>setPwForm(f=>({...f,newPw:e.target.value}))}/>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔄</span>
                    <input type="password" className="input-field text-sm" style={{ paddingLeft: "2.5rem" }} placeholder="Confirm password" value={pwForm.confirm} onChange={e=>setPwForm(f=>({...f,confirm:e.target.value}))}/>
                  </div>
                </div>
                <div className="pt-1">
                  <button onClick={changePassword} disabled={profileSaving||!pwForm.current||!pwForm.newPw} className="w-full sm:w-auto bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-800 hover:to-slate-900 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all duration-300 disabled:opacity-50 cursor-pointer">
                    {profileSaving ? "Updating password..." : "Update Password"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════
            TAB: COMPLAINTS / TICKETS
        ══════════════════════════════════ */}
        {pageTab==="complaints" && (
          <div className="grid md:grid-cols-3 gap-6 animate-fade-in">
            {/* Form Column */}
            <div className="md:col-span-1 space-y-4">
              <div className="card space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-[#1E293B] mb-1">✍️ Raise a Complaint</h3>
                  <p className="text-xs text-gray-500">Submit a ticket directly to the transport administrators.</p>
                </div>

                {complaintMsg && (
                  <div className={`px-4 py-3 rounded-xl text-sm font-medium ${complaintMsg.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                    {complaintMsg.text}
                  </div>
                )}

                <form onSubmit={submitComplaint} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Reason / Subject</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. Bus delay, AC issue"
                      value={complaintReason}
                      onChange={e => setComplaintReason(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
                    <textarea
                      className="input-field min-h-[120px] resize-none"
                      placeholder="Provide details about the issue..."
                      value={complaintDesc}
                      onChange={e => setComplaintDesc(e.target.value)}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={complaintSubmitting}
                    className="btn-primary w-full py-2.5 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {complaintSubmitting ? (
                      <>
                        <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        Submitting...
                      </>
                    ) : (
                      "Submit Complaint"
                    )}
                  </button>
                </form>
              </div>
            </div>

            {/* List Column */}
            <div className="md:col-span-2 space-y-4">
              <div className="card space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-[#1E293B] mb-1">📋 Your Ticket History</h3>
                    <p className="text-xs text-gray-500">Track and view resolutions of your submitted tickets.</p>
                  </div>
                  <button
                    onClick={loadComplaints}
                    disabled={complaintsLoading}
                    className="text-xs bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all text-[#2563EB] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1"
                  >
                    {complaintsLoading ? "🔄 Loading..." : "🔄 Refresh"}
                  </button>
                </div>

                {complaintsLoading && complaintsList.length === 0 ? (
                  <div className="text-center py-10">
                    <div className="animate-spin h-8 w-8 border-4 border-[#2563EB] border-t-transparent rounded-full mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Loading tickets...</p>
                  </div>
                ) : complaintsList.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                    <p className="text-4xl mb-2">📬</p>
                    <p className="text-sm font-semibold text-gray-600">No complaints raised yet</p>
                    <p className="text-xs text-gray-400 mt-1">If you have any issues, use the form on the left to submit a ticket.</p>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
                    {complaintsList.map(complaint => {
                      const isResolved = complaint.status === "resolved";
                      return (
                        <div key={complaint.id} className="p-4 rounded-xl border border-gray-100 bg-white hover:border-gray-200 shadow-sm transition-all space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h4 className="font-extrabold text-[#1E293B] text-base">{complaint.reason}</h4>
                              <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                                Submitted · {new Date(complaint.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                              </p>
                            </div>
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                              isResolved ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                            }`}>
                              {isResolved ? "✓ Resolved" : "⏱ Pending"}
                            </span>
                          </div>

                          <div className="bg-gray-50/50 p-3 rounded-lg text-sm text-gray-700 leading-relaxed">
                            {complaint.description}
                          </div>

                          {isResolved && (
                            <div className="bg-green-50/50 border border-green-100/50 p-3.5 rounded-lg space-y-1.5">
                              <p className="text-xs font-bold text-green-800 flex items-center gap-1">
                                🛠️ Administrator Explanation:
                              </p>
                              <p className="text-sm text-green-700 leading-relaxed">
                                {complaint.adminExplanation || "The issue has been resolved. No additional details were provided."}
                              </p>
                              {complaint.resolvedAt && (
                                <p className="text-[9px] text-green-500 font-medium">
                                  Resolved at {new Date(complaint.resolvedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
      {showAlerts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-slide-up">
            <div className="bg-gradient-to-r from-red-600 to-orange-500 px-5 py-4 text-white flex items-center justify-between">
              <div>
                <h3 className="text-lg font-extrabold">🚨 Bus Alerts</h3>
                <p className="text-xs text-red-100">Emergency and combine alerts for your assigned bus</p>
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
                  {alerts.map((alert, index) => {
                    const isResolved = !!alert.resolvedAt;
                    return (
                      <div key={alert.id ?? `${alert.createdAt}-${index}`} className={`rounded-xl border px-4 py-3 ${isResolved ? "border-green-200 bg-green-50" : "border-red-100 bg-red-50"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <p className={`font-extrabold text-sm ${isResolved ? "text-green-800" : "text-red-800"}`}>{alert.title}</p>
                          <span className={`text-[10px] whitespace-nowrap ${isResolved ? "text-green-500 font-semibold" : "text-red-500"}`}>
                            {isResolved ? "Resolved" : formatAlertTime(alert.createdAt || alert.timestamp)}
                          </span>
                        </div>
                        <p className={`text-sm mt-1 leading-relaxed ${isResolved ? "text-green-700" : "text-red-700"}`}>{alert.message}</p>
                        {isResolved && (
                          <p className="text-[10px] text-green-600 mt-1.5 font-medium">
                            ✓ Resolved · {formatAlertTime(alert.resolvedAt ?? undefined)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </NotificationWrapper>
  );
}
