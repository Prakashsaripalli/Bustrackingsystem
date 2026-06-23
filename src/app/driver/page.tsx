"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { getSocket } from "@/services/socket";
import dynamic from "next/dynamic";
import QRCode from "qrcode";
import type { BuilderStop } from "@/components/RouteBuilderMap";
import {
  getTripDirection, getDirectionalStops, getDirectionLabel, getDirectionBadge,
  getStartEnd,
  type TripDirection, type RouteWithDirection,
} from "@/utils/routeDirection";

function getDirectionalStopNames(route: RouteWithDirection, dir: TripDirection): string[] {
  const names = route.stops ?? [];
  return dir === "evening" ? [...names].reverse() : [...names];
}

const RouteBuilderMap = dynamic(() => import("@/components/RouteBuilderMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[580px] bg-gray-100 rounded-2xl flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-4 border-[#2563EB] border-t-transparent rounded-full" />
    </div>
  ),
});

const QRScanner = dynamic(() => import("@/components/QRScanner"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64 bg-gray-900 rounded-2xl">
      <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

const DriverMap = dynamic(() => import("@/components/DriverMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[440px] bg-gray-100 rounded-2xl flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-4 border-[#2563EB] border-t-transparent rounded-full" />
    </div>
  ),
});

interface Stop   { name: string; lat: number; lng: number; }
interface Route  {
  id: number; routeName: string; stops: string[];
  stopCoordinates?: Stop[] | string;
  distance?: number; estimatedDuration?: number;
  isReversible?: boolean;
  morningStart?: string; eveningStart?: string; morningCutoff?: string;
}
interface Bus    { id: number; busId: string; busNumber: string; routeId: number | null; isActive: boolean; route?: Route | null; }
interface DriverProfile {
  id: number; driverId: string; name: string; email: string;
  phone: string; licenseNo: string; assignedBusId: string; preferredRouteId?: number;
  admins?: { name: string; email: string; phone?: string }[];
}

interface DriverAlert {
  id?: number;
  busId?: string;
  title: string;
  message: string;
  createdAt?: string;
  timestamp?: string;
  resolvedAt?: string | null;
}

type Language = "en" | "te";

interface LoginTranslations {
  // Login Guard
  title: string;
  subtitle: string;
  infoTitle: string;
  infoDesc: string;
  identifierLabel: string;
  identifierPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  fingerprintBtn: string;
  submitBtn: string;
  submitting: string;
  footerText: string;

  // Logged-in Header
  notSignedIn: string;
  driverDashboard: string;
  gpsActive: string;
  gpsInactive: string;
  gpsError: string;
  tabTrip: string;
  tabProfile: string;
  tabDashboard: string;
  logoutBtn: string;

  // Dashboard Tab
  welcomeBack: string;
  welcomeDesc: string;
  assignedBusCard: string;
  noneAssigned: string;
  preferredRouteCard: string;
  notSet: string;
  totalAlertsCard: string;
  licenseCard: string;
  noneSpecified: string;
  editProfileHeader: string;
  fullNameLabel: string;
  phoneLabel: string;
  licenseLabel: string;
  assignedBusLabel: string;
  preferredRouteLabel: string;
  preferredRouteDesc: string;
  saveProfileBtn: string;
  savingProfile: string;
  changePasswordHeader: string;
  currentPasswordPlaceholder: string;
  newPasswordPlaceholder: string;
  confirmPasswordPlaceholder: string;
  changePasswordBtn: string;
  changingPassword: string;
  credentialsHeader: string;
  driverIdLabel: string;
  emailLabel: string;
  fingerprintLoginLabel: string;
  enabledStatus: string;
  notEnabledStatus: string;
  disableBtn: string;
  enableBtn: string;
  pleaseWait: string;
  submittedAlertsHeader: string;
  adminContactHeader: string;
  refreshBtn: string;
  noAlertsText: string;
  resolvedText: string;
  waitingAdminText: string;
  routeMapEditorHeader: string;
  routeMapEditorDesc: string;
  chooseRouteLabel: string;
  openEditorBtn: string;
  editorHowItWorksTitle: string;
  editorHowItWorksDesc: string;

  // Trip Tab
  emergencyModalDesc: string;
  selectProblemLabel: string;
  reasonDetailsLabel: string;
  emergencyModalNote: string;
  sendAlertBtn: string;
  sendingStatus: string;

  // Added keys
  anotherBusNumberLabel: string;
  autoAssignedDesc: string;
  busLabel: string;
  cancelBtn: string;
  combineBusBtn: string;
  combineBusModalDesc: string;
  combineBusModalNote: string;
  combineBusModalTitle: string;
  combineNotifyBtn: string;
  combiningStatus: string;
  emergencyAlertBtn: string;
  endTripBtn: string;
  manualTripBadge: string;
  reasonMessageLabel: string;
  resumeBtn: string;
  routeLabel: string;
  sendEmergencyModalTitle: string;
  startNewTripHeader: string;
  startAssignedTripBtn: string;
  studentDetailsHeader: string;
  studentDetailsDesc: string;
  noStudentsText: string;
  searchStudentsPlaceholder: string;
  studentIdLabel: string;
  boardingStopLabel: string;
  villageLabel: string;
  parentContactLabel: string;
}

const translations: Record<Language, LoginTranslations> = {
  en: {
    title: "Driver Login",
    subtitle: "Sign in to start tracking your bus trip",
    infoTitle: "Driver Login:",
    infoDesc: " Use your Driver ID (e.g. DRV001) or your email address. Contact admin if you don't have credentials.",
    identifierLabel: "Driver ID or Email",
    identifierPlaceholder: "e.g. DRV001 or email@domain.com",
    passwordLabel: "Password",
    passwordPlaceholder: "••••••••",
    fingerprintBtn: "🔐 Login with Fingerprint",
    submitBtn: "Sign In",
    submitting: "Signing in…",
    footerText: "Drivers are registered by the admin.",

    notSignedIn: "Not Signed In",
    driverDashboard: "Driver Dashboard",
    gpsActive: "GPS active",
    gpsInactive: "GPS inactive",
    gpsError: "GPS error",
    tabTrip: "🚍 Trip",
    tabProfile: "👤 Profile",
    tabDashboard: "📊 Dashboard",
    logoutBtn: "Logout",

    welcomeBack: "Welcome back",
    welcomeDesc: "Here is your live driver overview dashboard and account controls.",
    assignedBusCard: "Assigned Bus",
    noneAssigned: "None Assigned",
    preferredRouteCard: "Preferred Route",
    notSet: "Not Set",
    totalAlertsCard: "Total Alerts Sent",
    licenseCard: "Driver License",
    noneSpecified: "None Specified",
    editProfileHeader: "👤 Edit Profile",
    fullNameLabel: "Full Name",
    phoneLabel: "Phone",
    licenseLabel: "License No",
    assignedBusLabel: "Assigned Bus",
    preferredRouteLabel: "⭐ Preferred Route",
    preferredRouteDesc: "— auto-loaded next time you login",
    saveProfileBtn: "Save Profile",
    savingProfile: "Saving…",
    changePasswordHeader: "🔑 Change Password",
    currentPasswordPlaceholder: "Current password",
    newPasswordPlaceholder: "New password (min 6 chars)",
    confirmPasswordPlaceholder: "Confirm new password",
    changePasswordBtn: "Change Password",
    changingPassword: "Updating…",
    credentialsHeader: "🔒 Login Credentials",
    driverIdLabel: "Driver ID",
    emailLabel: "Email",
    fingerprintLoginLabel: "Fingerprint Login",
    enabledStatus: "Enabled",
    notEnabledStatus: "Not enabled",
    disableBtn: "Disable",
    enableBtn: "Enable",
    pleaseWait: "Please wait…",
    submittedAlertsHeader: "🚨 Submitted Alerts",
    adminContactHeader: "👨‍💼 Admin Helpdesk & Contacts",
    refreshBtn: "Refresh",
    noAlertsText: "No alerts submitted yet.",
    resolvedText: "Resolved by admin",
    waitingAdminText: "Waiting for admin action",
    routeMapEditorHeader: "🗺️ Route Map Editor",
    routeMapEditorDesc: "Select a route below, then double-tap the map to add/move stops and update the road path.",
    chooseRouteLabel: "Choose route to edit",
    openEditorBtn: "Open Route Map Editor",
    editorHowItWorksTitle: "How it works:",
    editorHowItWorksDesc: "The map shows the selected route's road path. Double-tap to add new stops, drag existing stops to reposition, click a stop to rename or remove it. Press \"Set Route\" to save changes — the road path will update on the student tracking map too.",

    // Trip Tab
    emergencyModalDesc: "Only Admin + Assigned students will receive the alert",
    selectProblemLabel: "Select Problem",
    reasonDetailsLabel: "Reason / Details",
    emergencyModalNote: "This alert will be sent immediately to the administrative dashboard and all students tracking this bus route.",
    sendAlertBtn: "Send Alert",
    sendingStatus: "Sending…",

    // Added keys
    anotherBusNumberLabel: "Another Bus Number",
    autoAssignedDesc: "Automatically assigned by admin",
    busLabel: "Bus",
    cancelBtn: "Cancel",
    combineBusBtn: "Combine Bus",
    combineBusModalDesc: "The bus you are driving will be shown to another bus's students",
    combineBusModalNote: "Students assigned to the entered bus will receive a notification and their live map will follow your bus.",
    combineBusModalTitle: "Combine Bus",
    combineNotifyBtn: "Combine & Notify",
    combiningStatus: "Combining…",
    emergencyAlertBtn: "Emergency Alert",
    endTripBtn: "End Trip",
    manualTripBadge: "✏️ Manual Trip Entry",
    reasonMessageLabel: "Reason / Message",
    resumeBtn: "Resume",
    routeLabel: "Route",
    sendEmergencyModalTitle: "Send Emergency Alert",
    startNewTripHeader: "Start a New Trip",
    startAssignedTripBtn: "Start My Assigned Trip",
    studentDetailsHeader: "Student Details",
    studentDetailsDesc: "View students assigned to your bus.",
    noStudentsText: "No students assigned to this bus yet.",
    searchStudentsPlaceholder: "Search by name, roll number or stop...",
    studentIdLabel: "Roll Number",
    boardingStopLabel: "Boarding Stop",
    villageLabel: "Village",
    parentContactLabel: "Parent Contact",
  },
  te: {
    title: "డ్రైవర్ లాగిన్",
    subtitle: "బస్సు ప్రయాణాన్ని ట్రాక్ చేయడానికి లాగిన్ అవ్వండి",
    infoTitle: "డ్రైవర్ లాగిన్:",
    infoDesc: " మీ డ్రైవర్ ఐడి (ఉదా. DRV001) లేదా మీ ఈమెయిల్ ఉపయోగించండి. ఆధారాలు లేకుంటే అడ్మిన్‌ను సంప్రదించండి.",
    identifierLabel: "డ్రైవర్ ఐడి లేదా ఈమెయిల్",
    identifierPlaceholder: "ఉదా. DRV001 లేదా email@domain.com",
    passwordLabel: "పాస్‌వర్డ్",
    passwordPlaceholder: "••••••••",
    fingerprintBtn: "🔐 వేలిముద్రతో లాగిన్ అవ్వండి",
    submitBtn: "సైన్ ఇన్",
    submitting: "సైన్ ఇన్ అవుతోంది…",
    footerText: "డ్రైవర్లు అడ్మిన్ ద్వారా నమోదు చేయబడతారు.",

    notSignedIn: "సైన్ ఇన్ చేయలేదు",
    driverDashboard: "డ్రైవర్ డాష్‌బోర్డ్",
    gpsActive: "GPS యాక్టివ్",
    gpsInactive: "GPS ఇనాక్టివ్",
    gpsError: "GPS లోపం",
    tabTrip: "🚍 ట్రిప్",
    tabProfile: "👤 ప్రొఫైల్",
    tabDashboard: "📊 డాష్‌బోర్డ్",
    logoutBtn: "లాగౌట్",

    welcomeBack: "స్వాగతం",
    welcomeDesc: "ఇది మీ ప్రత్యక్ష డ్రైవర్ డాష్‌బోర్డ్ మరియు ఖాతా నియంత్రణలు.",
    assignedBusCard: "కేటాయించిన బస్సు",
    noneAssigned: "ఏదీ కేటాయించలేదు",
    preferredRouteCard: "ఇష్టపడే మార్గం",
    notSet: "సెట్ చేయలేదు",
    totalAlertsCard: "సమర్పించిన మొత్తం హెచ్చరికలు",
    licenseCard: "డ్రైవర్ లైసెన్స్",
    noneSpecified: "పేర్కొనలేదు",
    editProfileHeader: "👤 ప్రొఫైల్ సవరించండి",
    fullNameLabel: "పూర్తి పేరు",
    phoneLabel: "ఫోన్",
    licenseLabel: "లైసెన్స్ నంబర్",
    assignedBusLabel: "కేటాయించిన బస్సు",
    preferredRouteLabel: "⭐ ఇష్టపడే మార్గం",
    preferredRouteDesc: "— తదుపరిసారి లాగిన్ అయినప్పుడు స్వయంచాలకంగా లోడ్ అవుతుంది",
    saveProfileBtn: "ప్రొఫైల్ సేవ్ చేయి",
    savingProfile: "సేవ్ అవుతోంది…",
    changePasswordHeader: "🔑 పాస్‌వర్డ్ మార్చండి",
    currentPasswordPlaceholder: "ప్రస్తుత పాస్‌వర్డ్",
    newPasswordPlaceholder: "కొత్త పాస్‌వర్డ్ (కనీసం 6 అక్షరాలు)",
    confirmPasswordPlaceholder: "కొత్త పాస్‌వర్డ్‌ను నిర్ధారించండి",
    changePasswordBtn: "పాస్‌వర్డ్ మార్చండి",
    changingPassword: "నవీకరిస్తోంది…",
    credentialsHeader: "🔒 లాగిన్ ఆధారాలు",
    driverIdLabel: "డ్రైవర్ ఐడి",
    emailLabel: "ఈమెయిల్",
    fingerprintLoginLabel: "వేలిముద్ర లాగిన్",
    enabledStatus: "ప్రారంభించబడింది",
    notEnabledStatus: "ప్రారంభించబడలేదు",
    disableBtn: "నిలిపివేయి",
    enableBtn: "ప్రారంభించు",
    pleaseWait: "దయచేసి వేచి ఉండండి…",
    submittedAlertsHeader: "🚨 సమర్పించిన హెచ్చరికలు",
    adminContactHeader: "👨‍💼 అడ్మిన్ హెల్ప్‌డెస్క్ & పరిచయాలు",
    refreshBtn: "రిఫ్రెష్",
    noAlertsText: "ఇంకా ఎలాంటి హెచ్చరికలు సమర్పించలేదు.",
    resolvedText: "అడ్మిన్ ద్వారా పరిష్కరించబడింది",
    waitingAdminText: "అడ్మిన్ చర్య కోసం వేచి ఉంది",
    routeMapEditorHeader: "🗺️ రూట్ మ్యాప్ ఎడిటర్",
    routeMapEditorDesc: "రూట్ ఎంచుకోండి, మార్పులు చేయడానికి మ్యాప్‌పై డబుల్ ట్యాప్ చేయండి.",
    chooseRouteLabel: "సవరించడానికి రూట్ ఎంచుకోండి",
    openEditorBtn: "రూట్ మ్యాప్ ఎడిటర్ తెరవండి",
    editorHowItWorksTitle: "ఇది ఎలా పనిచేస్తుంది:",
    editorHowItWorksDesc: "మ్యాప్ ఎంచుకున్న రూట్ మార్గాన్ని చూపుతుంది. కొత్త స్టాప్‌లను జోడించడానికి డబుల్ టాప్ చేయండి, స్టాప్‌లను లాగండి. సేవ్ చేయడానికి సెట్ రూట్ నొక్కండి.",

    // Trip Tab
    emergencyModalDesc: "అడ్మిన్ + కేటాయించిన విద్యార్థులు మాత్రమే హెచ్చరికను అందుకుంటారు",
    selectProblemLabel: "సమస్యను ఎంచుకోండి",
    reasonDetailsLabel: "కారణం / వివరాలు",
    emergencyModalNote: "ఈ హెచ్చరిక వెంటనే అడ్మిన్‌లకు మరియు విద్యార్థులకు పంపబడుతుంది.",
    sendAlertBtn: "హెచ్చరికను పంపండి",
    sendingStatus: "పంపుతోంది…",

    // Added keys
    anotherBusNumberLabel: "మరొక బస్సు సంఖ్య",
    autoAssignedDesc: "అడ్మిన్ ద్వారా స్వయంచాలకంగా కేటాయించబడింది",
    busLabel: "బస్సు",
    cancelBtn: "రద్దు చేయి",
    combineBusBtn: "బస్సు కలపండి",
    combineBusModalDesc: "మీరు నడుపుతున్న బస్సును మరొక బస్సు విద్యార్థులకు చూపబడుతుంది",
    combineBusModalNote: "నమోదు చేసిన బస్సుకు కేటాయించిన విద్యార్థులు నోటిఫికేషన్‌ను స్వీకరిస్తారు మరియు వారి ప్రత్యక్ష మ్యాప్ మీ బస్సును అనుసరిస్తుంది.",
    combineBusModalTitle: "బస్సు కలపండి",
    combineNotifyBtn: "కలపండి & తెలియజేయండి",
    combiningStatus: "కలుపుతోంది…",
    emergencyAlertBtn: "అత్యవసర హెచ్చరిక",
    endTripBtn: "ట్రిప్ ముగించు",
    manualTripBadge: "✏️ మాన్యువల్ ట్రిప్ ఎంట్రీ",
    reasonMessageLabel: "కారణం / సందేశం",
    resumeBtn: "కొనసాగించు",
    routeLabel: "మార్గం",
    sendEmergencyModalTitle: "అత్యవసర హెచ్చరికను పంపండి",
    startNewTripHeader: "కొత్త ట్రిప్ ప్రారంభించండి",
    startAssignedTripBtn: "నా కేటాయించిన ట్రిప్ ప్రారంభించండి",
    studentDetailsHeader: "విద్యార్థుల వివరాలు",
    studentDetailsDesc: "మీ బస్సుకు కేటాయించిన విద్యార్థుల వివరాలను వీక్షించండి.",
    noStudentsText: "ఈ బస్సుకు ఇంకా ఏ విద్యార్థిని కేటాయించలేదు.",
    searchStudentsPlaceholder: "పేరు, రోల్ నంబర్ లేదా స్టాప్ ద్వారా వెతకండి...",
    studentIdLabel: "రోల్ నంబర్",
    boardingStopLabel: "బోర్డింగ్ స్టాప్",
    villageLabel: "గ్రామం",
    parentContactLabel: "తల్లిదండ్రుల సంప్రదింపు",
  }
};

const EMERGENCY_TYPES = [
  { id: "breakdown", label: "Breakdown", emoji: "🛠️" },
  { id: "tyre_puncture", label: "Tyre Puncture", emoji: "🛞" },
  { id: "accident", label: "Accident", emoji: "🚨" },
  { id: "medical", label: "Medical Help", emoji: "🏥" },
  { id: "other", label: "Other", emoji: "📝" },
];

function base64urlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/* haversine km */
function hav(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, r = Math.PI / 180;
  const a = Math.sin((lat2-lat1)*r/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lng2-lng1)*r/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function parseStopCoords(raw: any): Stop[] {
  if (!raw) return [];
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return []; } }
  if (Array.isArray(raw)) return raw;
  return [];
}

const ADITYA_COLLEGE_POINTS: Stop[] = [
  { name: "Aditya Engineering College", lat: 17.045, lng: 82.065 },
  { name: "Aditya University Campus", lat: 17.0446, lng: 82.0647 },
];
const COLLEGE_GEOFENCE_RADIUS_M = 1000;
const STOP_END_RADIUS_M = 250;
const AUTO_END_MIN_SECONDS = 45;
const FIRST_GPS_DIRECTION_WINDOW_SECONDS = 30;

function isCollegeStopName(name?: string): boolean {
  const value = (name ?? "").toLowerCase();
  return value.includes("aditya") || value.includes("college") || value.includes("aec") || value.includes("university") || value.includes("campus");
}

function getCollegeUnitPoints(route?: Route | null): Stop[] {
  const stops = route ? parseStopCoords(route.stopCoordinates) : [];
  const namedCollegeStops = stops.filter(stop => isCollegeStopName(stop.name));
  const routeCollegeEndStop = stops.length > 0 ? [stops[stops.length - 1]] : [];
  const points = [...namedCollegeStops, ...routeCollegeEndStop, ...ADITYA_COLLEGE_POINTS];
  const seen = new Set<string>();
  return points.filter(point => {
    const key = `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function distanceToNearestPointMeters(lat: number, lng: number, points: Stop[]): number {
  if (points.length === 0) return Infinity;
  return Math.min(...points.map(point => hav(lat, lng, point.lat, point.lng) * 1000));
}

function isInsideCollegeUnit(lat: number, lng: number, route?: Route | null): boolean {
  return distanceToNearestPointMeters(lat, lng, getCollegeUnitPoints(route)) <= COLLEGE_GEOFENCE_RADIUS_M;
}

function getTripDirectionFromStart(lat: number, lng: number, route?: Route | null): TripDirection {
  return isInsideCollegeUnit(lat, lng, route) ? "evening" : "morning";
}

function getBrowserPosition(timeout = 6000): Promise<GeolocationPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 2000 },
    );
  });
}

function formatAlertTime(value?: string) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

/* Find which route the driver is closest to based on GPS */
function detectNearestRoute(lat: number, lng: number, routes: Route[]): Route | null {
  let best: Route | null = null;
  let bestDist = Infinity;
  routes.forEach(route => {
    const stops = parseStopCoords(route.stopCoordinates);
    stops.forEach(s => {
      const d = hav(lat, lng, s.lat, s.lng);
      if (d < bestDist) { bestDist = d; best = route; }
    });
  });
  return bestDist < 10 ? best : null; // within 10km
}

function makeCoords(
  source: GeolocationCoordinates,
  latitude: number,
  longitude: number,
  heading: number | null,
  speed: number | null,
): GeolocationCoordinates {
  return {
    latitude,
    longitude,
    accuracy: source.accuracy ?? 0,
    altitude: source.altitude,
    altitudeAccuracy: source.altitudeAccuracy,
    heading,
    speed,
  } as GeolocationCoordinates;
}

/* Snap coordinates to closest point on the road path (within 150m) */
function snapToDriverPath(lat: number, lng: number, path: { lat: number; lng: number }[]): { lat: number; lng: number } {
  if (!path || path.length === 0) return { lat, lng };
  if (path.length === 1) return path[0];

  let minDistanceMeters = Infinity;
  let snappedPoint = path[0];

  for (let i = 0; i < path.length - 1; i++) {
    const A = path[i];
    const B = path[i + 1];

    const latA = A.lat, lngA = A.lng;
    const latB = B.lat, lngB = B.lng;

    const dLat = latB - latA;
    const dLng = lngB - lngA;

    const ab2 = dLat * dLat + dLng * dLng;
    let t = 0;
    if (ab2 > 0) {
      t = ((lat - latA) * dLat + (lng - lngA) * dLng) / ab2;
      t = Math.max(0, Math.min(1, t));
    }

    const snapLat = latA + t * dLat;
    const snapLng = lngA + t * dLng;

    const d = hav(lat, lng, snapLat, snapLng) * 1000;
    if (d < minDistanceMeters) {
      minDistanceMeters = d;
      snappedPoint = { lat: snapLat, lng: snapLng };
    }
  }

  if (minDistanceMeters <= 150) {
    return snappedPoint;
  }
  return { lat, lng };
}

function stabilizeDriverLocation(
  raw: GeolocationCoordinates,
  roadPath: { lat: number; lng: number }[],
  previous: { lat: number; lng: number; accuracy: number; timestamp: number } | null,
): { coords: GeolocationCoordinates; speedKmh: number; stable: { lat: number; lng: number; accuracy: number; timestamp: number } } | null {
  const { latitude, longitude, speed: rawSpeed, heading, accuracy } = raw;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) return null;

  let finalLat = latitude;
  let finalLng = longitude;
  if (roadPath.length > 0) {
    const snapped = snapToDriverPath(latitude, longitude, roadPath);
    finalLat = snapped.lat;
    finalLng = snapped.lng;
  }

  const now = Date.now();
  const currentAccuracy = accuracy ?? 999;
  const speedKmh = rawSpeed != null && rawSpeed >= 0 ? +(rawSpeed * 3.6).toFixed(1) : 0;

  if (previous) {
    const dt = Math.max(1, (now - previous.timestamp) / 1000);
    const movedMeters = hav(previous.lat, previous.lng, finalLat, finalLng) * 1000;
    const jitterMeters = Math.max(8, Math.min(30, currentAccuracy * 0.35));
    const plausibleMeters = Math.max(80, (110 / 3.6) * dt + currentAccuracy + previous.accuracy);

    if (movedMeters < jitterMeters) {
      finalLat = previous.lat;
      finalLng = previous.lng;
    } else if (movedMeters > plausibleMeters) {
      const coords = makeCoords(raw, previous.lat, previous.lng, heading ?? null, rawSpeed);
      return {
        coords,
        speedKmh: 0,
        stable: { ...previous, timestamp: now },
      };
    }
  }

  const coords = makeCoords(raw, finalLat, finalLng, heading ?? null, rawSpeed);
  return {
    coords,
    speedKmh,
    stable: { lat: finalLat, lng: finalLng, accuracy: currentAccuracy, timestamp: now },
  };
}

type PageTab = "trip" | "profile";
type ProfileSubTab = "driver-id" | "edit-profile" | "change-password" | "admin-desk" | "route-editor" | "student-details";

export default function DriverDashboard() {
  const { user, isAuthenticated, loading: authLoading, logout, token, updateUser, login, fingerprintLogin } = useAuth();
  const [pageTab, setPageTab] = useState<PageTab>("trip");
  const [profileSubTab, setProfileSubTab] = useState<ProfileSubTab>("driver-id");
  const [assignedStudents, setAssignedStudents] = useState<any[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");

  /* ─ login form state ─ */
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  /* ─ trip setup ─ */
  const [inputTab,       setInputTab]       = useState<"manual" | "qr">("qr");
  const [busNumber,      setBusNumber]      = useState("");
  const [routes,         setRoutes]         = useState<Route[]>([]);
  const [buses,          setBuses]          = useState<Bus[]>([]);
  const [selectedRoute,  setSelectedRoute]  = useState<Route | null>(null);
  const [tripDirection,  setTripDirection]  = useState<TripDirection>("morning");
  const [manualDirection,setManualDirection]= useState<TripDirection | null>(null); // null = auto
  const [qrScanned,      setQrScanned]      = useState(false);
  const [qrScanData,     setQrScanData]     = useState<{ busId: string; routeName?: string } | null>(null);
  const [pendingQrAutoStart, setPendingQrAutoStart] = useState<string | null>(null);
  const [autoAssigned,   setAutoAssigned]   = useState(false);
  const [currentTime,    setCurrentTime]    = useState(new Date());

  /* ─ trip runtime ─ */
  const [tripStatus,      setTripStatus]      = useState<"idle" | "active" | "paused">("idle");
  const [tripId,          setTripId]          = useState<number | null>(null);
  const [location,        setLocation]        = useState<GeolocationCoordinates | null>(null);
  const [gpsStatus,       setGpsStatus]       = useState<"inactive" | "active" | "error">("inactive");
  const [speed,           setSpeed]           = useState(0);
  const [elapsed,         setElapsed]         = useState(0);
  const [watchId,         setWatchId]         = useState<number | null>(null);
  const [positionHistory, setPositionHistory] = useState<{ lat: number; lng: number }[]>([]);
  /* live ETA data from map component */
  const [liveDestEta,     setLiveDestEta]     = useState<number | null>(null);   // remaining mins
  const [liveDestDist,    setLiveDestDist]    = useState<number | null>(null);   // remaining km
  const [liveTotalDist,   setLiveTotalDist]   = useState<number | null>(null);   // total route km
  const [liveTotalTime,   setLiveTotalTime]   = useState<number | null>(null);   // total route mins

  /* ─ profile ─ */
  const [profile,        setProfile]        = useState<DriverProfile | null>(null);
  const [driverAlerts,   setDriverAlerts]   = useState<DriverAlert[]>([]);
  const [profileForm,    setProfileForm]    = useState({ name: "", phone: "", licenseNo: "", assignedBusId: "", preferredRouteId: "" });
  const [pwForm,         setPwForm]         = useState({ current: "", newPw: "", confirm: "" });
  const [profileSaving,  setProfileSaving]  = useState(false);
  const [showRouteBuilder, setShowRouteBuilder] = useState(false);
  const [builderRouteId,   setBuilderRouteId]   = useState<number | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  /* ─ profile photo & QR card interactive states ─ */
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load photo from localStorage on mount / user load
  useEffect(() => {
    if (user?.id) {
      if (typeof window !== "undefined" && window.location.search.includes("mockPhoto=true")) {
        const mockBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQImWNkYGBgYGBgYGBgYGBgAAAABQAB6jPvBQAAAAAASUVORK5CYII=";
        localStorage.setItem(`driver_photo_${user.id}`, mockBase64);
        setProfilePhoto(mockBase64);
      } else {
        const stored = localStorage.getItem(`driver_photo_${user.id}`);
        setProfilePhoto(stored || null);
      }
    } else {
      setProfilePhoto(null);
    }
  }, [user?.id]);

  // Generate QR code for Driver ID
  useEffect(() => {
    const driverId = profile?.driverId || user?.driverId || "";
    if (driverId) {
      QRCode.toDataURL(driverId, { margin: 1, width: 120 })
        .then(setQrCodeUrl)
        .catch(err => console.error("Error generating QR code:", err));
    } else {
      setQrCodeUrl("");
    }
  }, [profile?.driverId, user?.driverId]);

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
          localStorage.setItem(`driver_photo_${user.id}`, base64String);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  const handleRemovePhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    setProfilePhoto(null);
    if (user?.id) {
      localStorage.removeItem(`driver_photo_${user.id}`);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  /* ─ UI ─ */
  const [error,       setError]       = useState("");
  const [info,        setInfo]        = useState("");
  const [starting,    setStarting]    = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

  /* ─ Premium Logic modals & toggles ─ */
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [emergencyType, setEmergencyType] = useState("breakdown");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [sendingEmergency, setSendingEmergency] = useState(false);

  const [showCombineModal, setShowCombineModal] = useState(false);
  const [combineBusId, setCombineBusId] = useState("");
  const [combineReason, setCombineReason] = useState("");
  const [combiningBus, setCombiningBus] = useState(false);

  const [fingerprintEnabled, setFingerprintEnabled] = useState(false);
  const [fingerprintSaving, setFingerprintSaving] = useState(false);
  const [lang, setLang] = useState<Language>("en");

  // Load language preference on client mount to avoid Next.js hydration mismatches
  useEffect(() => {
    const saved = localStorage.getItem("driver_login_lang");
    if (saved === "en" || saved === "te") {
      setLang(saved);
    }
  }, []);

  const handleLangChange = (newLang: Language) => {
    setLang(newLang);
    localStorage.setItem("driver_login_lang", newLang);
  };

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  // Track last auto-detected route to avoid flip-flopping
  const lastAutoDetectedRoute = useRef<number | null>(null);
  const autoDetectIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const roadPathRef = useRef<{ lat: number; lng: number }[]>([]);
  const lastStableLocationRef = useRef<{ lat: number; lng: number; accuracy: number; timestamp: number } | null>(null);
  const autoEndTriggeredRef = useRef(false);
  const tripStartedAtRef = useRef<number | null>(null);
  const tripDirectionResolvedRef = useRef(false);

  useEffect(() => {
    if (!selectedRoute) {
      roadPathRef.current = [];
      return;
    }

    let cancelled = false;
    const stops = getDirectionalStops(selectedRoute as RouteWithDirection, tripDirection);
    const fallbackPath = stops.map(s => ({ lat: s.lat, lng: s.lng }));

    if (stops.length < 2) {
      roadPathRef.current = fallbackPath;
      return;
    }

    Promise.all(stops.slice(0, -1).map(async (start, index) => {
      const end = stops[index + 1];
      const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&steps=false`;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const data = await response.json();
        if (data.code !== "Ok" || !data.routes?.[0]) return null;
        return data.routes[0].geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng }));
      } catch {
        return null;
      }
    })).then(legs => {
      if (cancelled) return;
      const combined: { lat: number; lng: number }[] = [];
      legs.forEach((leg, index) => {
        if (!leg) {
          const stop = stops[index + 1];
          if (combined.length === 0) combined.push({ lat: stops[index].lat, lng: stops[index].lng });
          combined.push({ lat: stop.lat, lng: stop.lng });
          return;
        }
        combined.push(...(combined.length === 0 ? leg : leg.slice(1)));
      });
      roadPathRef.current = combined.length > 1 ? combined : fallbackPath;
    });

    return () => { cancelled = true; };
  }, [selectedRoute, tripDirection]);

  /* ── Clock tick (every minute) to auto-update trip direction ── */
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);
      // Auto-update direction if not manually overridden
      if (tripStatus !== "active" && !manualDirection && selectedRoute?.isReversible) {
        setTripDirection(getTripDirection(selectedRoute as RouteWithDirection, now));
      }
    }, 60000);
    return () => clearInterval(id);
  }, [manualDirection, selectedRoute, tripStatus]);

  /* ── Update direction when route changes ── */
  useEffect(() => {
    if (!selectedRoute || tripStatus === "active") return;
    const dir = manualDirection ?? getTripDirection(selectedRoute as RouteWithDirection, currentTime);
    setTripDirection(dir);
  }, [selectedRoute, manualDirection, currentTime, tripStatus]);

  /* ── Fetch fingerprint status on load ── */
  useEffect(() => {
    if (!token || user?.role !== "driver") return;
    fetch("/api/auth/webauthn/status", { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.ok && res.headers.get("content-type")?.includes("json") ? res.json() : null)
      .then(data => { if (data) setFingerprintEnabled(!!data.enabled); })
      .catch(() => {});
  }, [token, user]);

  /* ── Auto-start trip on QR scan ── */
  useEffect(() => {
    if (pendingQrAutoStart) {
      setPendingQrAutoStart(null);
      void startTrip();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQrAutoStart]);

  /* ════ Load data + auto-assign ════ */
  useEffect(() => {
    if (!isAuthenticated) return;
    loadData();
    loadProfile();
    loadDriverAlerts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id]);

  /* ════ Listen for real-time route updates ════ */
  useEffect(() => {
    if (!isAuthenticated) return;
    const socket = getSocket();
    const handleRouteUpdated = ({ routeId }: { routeId: number }) => {
      console.log("[Socket] Route updated:", routeId);
      loadData();
    };
    socket.on("route-updated", handleRouteUpdated);
    return () => {
      socket.off("route-updated", handleRouteUpdated);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const loadData = async () => {
    setDataLoading(true);
    try {
      const [rRes, bRes] = await Promise.all([
        fetch("/api/routes"),
        fetch("/api/buses?all=true"),
      ]);
      const isJson = (r: Response) => r.ok && (r.headers.get("content-type") ?? "").includes("json");
      const routeData: Route[] = isJson(rRes) ? await rRes.json() : [];
      const busData: Bus[]     = isJson(bRes) ? await bRes.json() : [];
      setRoutes(routeData);
      setBuses(busData.filter(b => b.isActive));

      // Update currently selected route with its fresh version if it exists
      setSelectedRoute(current => {
        if (!current) return null;
        const fresh = routeData.find(r => r.id === current.id);
        return fresh ?? current;
      });

      const assignedId = user?.assignedBusId;
      const preferredRouteId = user?.preferredRouteId;

      if (assignedId) {
        const assignedBus = busData.find(b => b.busId === assignedId);
        if (assignedBus) {
          setBusNumber(assignedBus.busId);
          setAutoAssigned(true);

          // Priority: preferred route > assigned bus route > none
          let route: Route | null = null;
          if (preferredRouteId) {
            route = routeData.find(r => r.id === preferredRouteId) ?? null;
          }
          if (!route && assignedBus.route) {
            route = assignedBus.route as Route;
          } else if (!route && assignedBus.routeId) {
            route = routeData.find(r => r.id === assignedBus.routeId) ?? null;
          }
          if (route) {
            setSelectedRoute(route);
            const src = preferredRouteId ? "preferred" : "assigned";
            setInfo(`✅ Auto-assigned: Bus ${assignedBus.busId} · Route: ${route.routeName} (${src})`);
          } else {
            setInfo(`✅ Auto-assigned: Bus ${assignedBus.busId} · Select route below`);
          }
          setTimeout(() => setInfo(""), 6000);
        }
      }
    } catch { setError("Failed to load data. Please refresh."); }
    finally { setDataLoading(false); }
  };

  const loadProfile = async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } });
      const ct  = res.headers.get("content-type") ?? "";
      if (res.ok && ct.includes("json")) {
        const p = await res.json();
        setProfile(p);
        setProfileForm({
          name: p.name || "", phone: p.phone || "",
          licenseNo: p.licenseNo || "", assignedBusId: p.assignedBusId || "",
          preferredRouteId: p.preferredRouteId ? String(p.preferredRouteId) : "",
        });
      }
    } catch { /**/ }
  };

  const loadDriverAlerts = async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/alerts", { headers: { Authorization: `Bearer ${token}` } });
      const data = res.ok && res.headers.get("content-type")?.includes("json") ? await res.json() : [];
      setDriverAlerts(Array.isArray(data) ? data : []);
    } catch { /**/ }
  };

  const loadAssignedStudents = async () => {
    if (!token) return;
    setStudentsLoading(true);
    try {
      const res = await fetch("/api/students", { headers: { Authorization: `Bearer ${token}` } });
      const ct = res.headers.get("content-type") ?? "";
      if (res.ok && ct.includes("json")) {
        const data = await res.json();
        setAssignedStudents(Array.isArray(data) ? data : []);
      } else {
        setAssignedStudents([]);
      }
    } catch {
      setAssignedStudents([]);
    } finally {
      setStudentsLoading(false);
    }
  };

  useEffect(() => {
    if (pageTab === "profile" && profileSubTab === "student-details" && token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAssignedStudents();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTab, profileSubTab, token]);

  /* ════ Auto-detect route from GPS when on a trip ════ */
  const startRouteAutoDetect = useCallback((currentRoutes: Route[]) => {
    if (autoDetectIntervalRef.current) clearInterval(autoDetectIntervalRef.current);
    autoDetectIntervalRef.current = setInterval(() => {
      if (!location) return;
      const nearest = detectNearestRoute(location.latitude, location.longitude, currentRoutes);
      if (nearest && nearest.id !== lastAutoDetectedRoute.current) {
        // Check if driver has moved significantly away from current route
        if (selectedRoute) {
          const currentStops = parseStopCoords(selectedRoute.stopCoordinates);
          const distFromCurrent = Math.min(...currentStops.map(s =>
            hav(location.latitude, location.longitude, s.lat, s.lng)
          ));
          // Only auto-switch if > 5km from current route AND clearly on another
          if (distFromCurrent > 5) {
            lastAutoDetectedRoute.current = nearest.id;
            setSelectedRoute(nearest);
            setInfo(`🔄 Route auto-changed to: ${nearest.routeName}`);
            setTimeout(() => setInfo(""), 4000);
          }
        }
      }
    }, 30000); // check every 30s
  }, [location, selectedRoute]);

  useEffect(() => {
    if (tripStatus === "active" && routes.length > 0) {
      startRouteAutoDetect(routes);
    }
    return () => {
      if (autoDetectIntervalRef.current) clearInterval(autoDetectIntervalRef.current);
    };
  }, [tripStatus, location, startRouteAutoDetect, routes]);

  /* ════ QR Scan ════ */
  const onQRScan = useCallback((data: { busId: string; routeName?: string }) => {
    setQrScanned(true); setQrScanData(data);
    const scannedBusId = data.busId.trim().toUpperCase();
    const scannedRoute = (data.routeName ?? "").trim();
    setBusNumber(scannedBusId);

    let matched: Route | null = null;
    if (scannedRoute) {
      const lower = scannedRoute.toLowerCase();
      matched = routes.find(r => r.routeName.toLowerCase() === lower)
             ?? routes.find(r => r.routeName.toLowerCase().includes(lower))
             ?? routes.find(r => lower.includes(r.routeName.toLowerCase()))
             ?? null;
    }
    if (!matched) {
      const mb = buses.find(b => b.busId.toUpperCase() === scannedBusId);
      if (mb?.routeId) matched = routes.find(r => r.id === mb.routeId) ?? null;
      if (!matched && mb?.route) matched = mb.route as Route;
    }
    if (matched) {
      setSelectedRoute(matched);
      setInfo(`✅ Bus ${scannedBusId} · Route: ${matched.routeName}. Starting trip automatically…`);
    } else {
      setSelectedRoute(null);
      setInfo(`✅ Bus ${scannedBusId} scanned. Starting trip automatically…`);
    }
    setInputTab("manual");
    setPendingQrAutoStart(scannedBusId);
    setTimeout(() => setInfo(""), 8000);
  }, [routes, buses]);

  /* ════ GPS ════ */
  const stopGPS = useCallback(() => {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); setWatchId(null); }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (autoDetectIntervalRef.current) { clearInterval(autoDetectIntervalRef.current); autoDetectIntervalRef.current = null; }
    lastStableLocationRef.current = null;
    setGpsStatus("inactive");
  }, [watchId]);

  const startGPS = useCallback((activeBusId: string, activeTripId: number | null, routeForTrip?: Route | null) => {
    if (!navigator.geolocation) { setError("Geolocation not supported"); setGpsStatus("error"); return; }

    const publishPosition = (pos: GeolocationPosition, replaceHistory = false) => {
      const stabilized = stabilizeDriverLocation(pos.coords, roadPathRef.current, lastStableLocationRef.current);
      if (!stabilized) return;

      const { coords, speedKmh, stable } = stabilized;
      lastStableLocationRef.current = stable;

      const startedAt = tripStartedAtRef.current;
      if (routeForTrip && !tripDirectionResolvedRef.current && startedAt && Date.now() - startedAt <= FIRST_GPS_DIRECTION_WINDOW_SECONDS * 1000) {
        const gpsDirection = getTripDirectionFromStart(coords.latitude, coords.longitude, routeForTrip);
        setTripDirection(gpsDirection);
        tripDirectionResolvedRef.current = true;
        setInfo(gpsDirection === "morning"
          ? "Morning trip detected from GPS: outside college to campus."
          : "Evening trip detected from GPS: campus to final stop.");
        setTimeout(() => setInfo(""), 5000);
      }

      setLocation(coords);
      setSpeed(speedKmh);
      setGpsStatus("active");
      setPositionHistory(prev => {
        const nextPoint = { lat: coords.latitude, lng: coords.longitude };
        if (replaceHistory || prev.length === 0) return [nextPoint];
        const last = prev[prev.length - 1];
        if (last && hav(last.lat, last.lng, nextPoint.lat, nextPoint.lng) * 1000 < 2) return prev;
        return [...prev, nextPoint].slice(-100);
      });

      getSocket().emit("liveLocation", {
        busId: activeBusId,
        lat: coords.latitude,
        lng: coords.longitude,
        speed: speedKmh,
        heading: coords.heading ?? 0,
        accuracy: coords.accuracy ?? 0,
        tripId: activeTripId,
      });
    };
    
    navigator.geolocation.getCurrentPosition(
      (pos) => publishPosition(pos, true),
      (err) => {
        console.warn("Initial getCurrentPosition failed:", err);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 2000 }
    );

    const id = navigator.geolocation.watchPosition(
      (pos) => publishPosition(pos),
      (err) => { setGpsStatus("error"); setError(`GPS: ${err.message}`); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 }
    );
    setWatchId(id);
  }, []);

  /* ════ Trip lifecycle ════ */
  const startTrip = async () => {
    const activeBusId = busNumber.trim().toUpperCase();
    if (!activeBusId) { setError("Please enter or scan a Bus ID."); return; }
    setStarting(true); setError("");
    try {
      const freshPosition = await getBrowserPosition();
      const startLat = freshPosition?.coords.latitude ?? location?.latitude;
      const startLng = freshPosition?.coords.longitude ?? location?.longitude;
      const hasStartLocation = startLat != null && startLng != null;
      const detectedDirection: TripDirection = hasStartLocation
        ? getTripDirectionFromStart(startLat, startLng, selectedRoute)
        : (manualDirection ?? (selectedRoute ? getTripDirection(selectedRoute as RouteWithDirection, currentTime) : "morning"));
      setTripDirection(detectedDirection);
      autoEndTriggeredRef.current = false;
      tripDirectionResolvedRef.current = hasStartLocation;
      tripStartedAtRef.current = Date.now();

      const res = await fetch("/api/trips", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ busId: activeBusId, driverId: user?.id, routeId: selectedRoute?.id ?? null, status: "active" }),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) throw new Error(`Server error ${res.status}`);
      const trip = await res.json();
      if (!res.ok) throw new Error(trip.error || "Server error");
      setTripId(trip.id); setTripStatus("active");
      await fetch("/api/buses", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ busId: activeBusId, status: "active" }) }).catch(() => {});
      const socket = getSocket();
      socket.emit("driver-connect", { busId: activeBusId, driverId: user?.id, routeId: selectedRoute?.id });
      socket.emit("trip-status", { busId: activeBusId, tripId: trip.id, status: "started", driverId: user?.id });
      startGPS(activeBusId, trip.id, selectedRoute);
      const startTime = Date.now();
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
      setQrScanned(false); setQrScanData(null);
      lastAutoDetectedRoute.current = selectedRoute?.id ?? null;
      setInfo(detectedDirection === "morning"
        ? "Morning trip started: outside college to college. Auto-end at campus."
        : "Evening trip started: college to route end stop. Auto-end at final stop.");
      setTimeout(() => setInfo(""), 6000);
    } catch (err: any) { setError("Failed to start trip: " + err.message); }
    finally { setStarting(false); }
  };

  const pauseTrip = async () => {
    if (!tripId) return;
    await fetch("/api/trips", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: tripId, status: "paused" }) });
    setTripStatus("paused"); stopGPS();
    getSocket().emit("trip-status", { busId: busNumber, tripId, status: "paused" });
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const resumeTrip = async () => {
    if (!tripId) return;
    await fetch("/api/trips", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: tripId, status: "active" }) });
    setTripStatus("active"); startGPS(busNumber, tripId, selectedRoute);
    getSocket().emit("trip-status", { busId: busNumber, tripId, status: "started" });
    const startTime = Date.now() - elapsed * 1000;
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
  };

  const stopTrip = async () => {
    if (!tripId) return;
    await fetch("/api/trips", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: tripId, status: "completed", totalDuration: elapsed }) });
    await fetch("/api/buses", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ busId: busNumber, status: "inactive" }) }).catch(() => {});
    getSocket().emit("trip-status", { busId: busNumber, tripId, status: "completed" });
    setTripStatus("idle"); stopGPS();
    setElapsed(0); setSpeed(0); setPositionHistory([]);
    setTripId(null);
    autoEndTriggeredRef.current = false;
    tripDirectionResolvedRef.current = false;
    tripStartedAtRef.current = null;
    lastAutoDetectedRoute.current = null;
    // Keep preferred route selected for next trip
    if (!user?.preferredRouteId) setBusNumber(user?.assignedBusId ?? "");
  };

  useEffect(() => {
    if (tripStatus !== "active" || !location || !selectedRoute || !tripId || autoEndTriggeredRef.current) return;
    const startedAt = tripStartedAtRef.current;
    if (startedAt && Date.now() - startedAt < AUTO_END_MIN_SECONDS * 1000) return;

    const currentLat = location.latitude;
    const currentLng = location.longitude;
    let shouldAutoEnd = false;
    let reason = "";

    if (tripDirection === "morning") {
      shouldAutoEnd = isInsideCollegeUnit(currentLat, currentLng, selectedRoute);
      reason = "Morning trip auto-ended: bus reached Aditya college campus.";
    } else {
      const originalStops = parseStopCoords(selectedRoute.stopCoordinates);
      const finalStop = originalStops[0];
      if (finalStop) {
        shouldAutoEnd = hav(currentLat, currentLng, finalStop.lat, finalStop.lng) * 1000 <= STOP_END_RADIUS_M;
        reason = `Evening trip auto-ended: bus reached ${finalStop.name}.`;
      }
    }

    if (!shouldAutoEnd) return;
    autoEndTriggeredRef.current = true;
    setInfo(reason);
    void stopTrip();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripStatus, location, selectedRoute, tripId, tripDirection]);

  const sendEmergency = async () => {
    const activeBusId = busNumber.trim().toUpperCase();
    if (!activeBusId) { setError("Bus ID missing. Start or scan a bus first."); return; }
    if (!token) { setError("Login expired. Please sign in again."); return; }

    setSendingEmergency(true);
    setError("");
    try {
      const selectedType = EMERGENCY_TYPES.find(item => item.id === emergencyType) ?? EMERGENCY_TYPES[0];
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          busId: activeBusId,
          category: emergencyType,
          reason: emergencyReason,
          lat: location?.latitude,
          lng: location?.longitude,
          tripId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send alert");

      getSocket().emit("emergency-alert", {
        busId: activeBusId,
        driverId: user?.id,
        lat: location?.latitude,
        lng: location?.longitude,
        category: emergencyType,
        label: selectedType.label,
        reason: emergencyReason,
        alert: data.alert,
      });
      
      setInfo(`🚨 ${selectedType.label} alert sent successfully!`);
      setShowEmergencyModal(false);
      setEmergencyReason("");
      
      // Reload driver alerts history
      await loadDriverAlerts();
      
      setTimeout(() => setInfo(""), 5000);
    } catch (err: any) {
      setError(err.message || "Failed to send emergency alert");
    } finally {
      setSendingEmergency(false);
    }
  };

  const combineBus = async () => {
    const primaryBusId = busNumber.trim().toUpperCase();
    const targetBusId = combineBusId.trim().toUpperCase();
    if (!primaryBusId) { setError("Primary Bus ID missing."); return; }
    if (!targetBusId) { setError("Enter the bus number to combine."); return; }
    setCombiningBus(true);
    setError("");
    try {
      const res = await fetch("/api/combine-bus", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ primaryBusId, targetBusId, reason: combineReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to combine buses");
      getSocket().emit("combine-bus", {
        primaryBusId,
        targetBusId,
        reason: combineReason,
      });
      setInfo(`🔁 ${targetBusId} combined. Its students now track ${primaryBusId}. Notified ${data.studentCount ?? 0} students.`);
      setShowCombineModal(false);
      setCombineBusId("");
      setCombineReason("");
      setTimeout(() => setInfo(""), 6000);
    } catch (err: any) {
      setError("Failed to combine bus: " + err.message);
    } finally {
      setCombiningBus(false);
    }
  };

  useEffect(() => () => { stopGPS(); }, [stopGPS]);

  /* ════ Profile save ════ */
  const saveProfile = async () => {
    if (!token) return;
    if (profileForm.phone && !/^\d{10}$/.test(profileForm.phone.trim())) {
      setError("Mobile number must be exactly 10 digits");
      setTimeout(() => setError(""), 4000);
      return;
    }
    setProfileSaving(true);
    try {
      const payload = {
        name: profileForm.name,
        phone: profileForm.phone,
        licenseNo: profileForm.licenseNo,
        assignedBusId: profileForm.assignedBusId || null,
        preferredRouteId: profileForm.preferredRouteId ? parseInt(profileForm.preferredRouteId) : null,
      };
      const res = await fetch("/api/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const ct1 = res.headers.get("content-type") ?? "";
      if (!ct1.includes("json")) throw new Error(`Server error ${res.status}`);
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || "Failed");
      setProfile(updated);
      // Update user context so auto-assign reflects new preferred route
      updateUser({
        name: updated.name,
        assignedBusId: updated.assignedBusId,
        preferredRouteId: updated.preferredRouteId,
      });
      // Apply preferred route immediately to trip setup
      if (updated.preferredRouteId) {
        const route = routes.find(r => r.id === updated.preferredRouteId);
        if (route) { setSelectedRoute(route); setInfo(`✅ Preferred route set: ${route.routeName}`); }
      }
      setInfo(prev => prev || "✅ Profile updated successfully");
      setTimeout(() => setInfo(""), 5000);
    } catch (e: any) { setError(e.message); }
    finally { setProfileSaving(false); }
  };

  const changePassword = async () => {
    if (!token) return;
    if (pwForm.newPw !== pwForm.confirm) { setError("New passwords don't match"); return; }
    if (pwForm.newPw.length < 6) { setError("Password must be at least 6 characters"); return; }
    setProfileSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: pwForm.current, newPassword: pwForm.newPw }),
      });
      const ct2 = res.headers.get("content-type") ?? "";
      if (!ct2.includes("json")) throw new Error(`Server error ${res.status}`);
      const pwData = await res.json();
      if (!res.ok) throw new Error(pwData.error || "Failed");
      setInfo("✅ Password changed successfully");
      setPwForm({ current: "", newPw: "", confirm: "" });
      setTimeout(() => setInfo(""), 4000);
    } catch (e: any) { setError(e.message); }
    finally { setProfileSaving(false); }
  };

  const enableFingerprintLogin = async () => {
    if (!token) return;
    if (!window.isSecureContext) {
      setError("Fingerprint/passkey needs HTTPS or localhost. For Android local Wi‑Fi, enable Chrome secure-origin flag for this IP or use local HTTPS.");
      return;
    }
    if (!window.PublicKeyCredential) {
      setError("Fingerprint/passkey login is not supported on this device/browser.");
      return;
    }
    setFingerprintSaving(true);
    setError("");
    try {
      const optionsRes = await fetch("/api/auth/webauthn/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(options.error || "Failed to start fingerprint setup");

      const credential = await navigator.credentials.create({
        publicKey: {
          ...options,
          challenge: base64urlToBuffer(options.challenge),
          user: {
            ...options.user,
            id: base64urlToBuffer(options.user.id),
          },
          excludeCredentials: (options.excludeCredentials || []).map((item: any) => ({
            ...item,
            id: base64urlToBuffer(item.id),
          })),
        },
      });

      if (!credential) throw new Error("No credential returned");
      const cred = credential as PublicKeyCredential;
      const attestation = cred.response as AuthenticatorAttestationResponse;

      const registerRes = await fetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: cred.id,
          rawId: bufferToBase64url(cred.rawId),
          type: cred.type,
          response: {
            clientDataJSON: bufferToBase64url(attestation.clientDataJSON),
            attestationObject: bufferToBase64url(attestation.attestationObject),
          },
        }),
      });
      const registerData = await registerRes.json();
      if (!registerRes.ok) throw new Error(registerData.error || "Failed to complete setup");

      setFingerprintEnabled(true);
      setInfo("Fingerprint login enabled successfully.");
      setTimeout(() => setInfo(""), 5000);
    } catch (err: any) {
      setError(err.message || "Failed to enable fingerprint");
    } finally {
      setFingerprintSaving(false);
    }
  };

  const disableFingerprintLogin = async () => {
    if (!token) return;
    setFingerprintSaving(true);
    setError("");
    try {
      const res = await fetch("/api/auth/webauthn/status", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to disable fingerprint");
      setFingerprintEnabled(false);
      localStorage.removeItem("driver_fingerprint_login");
      setInfo("Fingerprint login disabled.");
      setTimeout(() => setInfo(""), 4000);
    } catch (err: any) {
      setError(err.message || "Failed to disable fingerprint");
    } finally {
      setFingerprintSaving(false);
    }
  };

  const handleDriverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      await login(loginEmail, loginPassword, "driver");
    } catch (err: any) {
      setLoginError(err.message || "Login failed");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleDriverFingerprintLogin = async () => {
    setLoginError("");
    setLoginLoading(true);
    try {
      await fingerprintLogin(loginEmail || undefined);
    } catch (err: any) {
      setLoginError(err.message || "Fingerprint login failed");
    } finally {
      setLoginLoading(false);
    }
  };

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  };
  const canStart = busNumber.trim().length > 0;

  /* ── Route Builder: save updated stops back to DB ── */
  const handleRouteBuilderSave = async (updatedStops: BuilderStop[]) => {
    if (!builderRouteId) return;
    try {
      const res = await fetch("/api/routes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: builderRouteId,
          stopCoordinates: updatedStops,
          stops: updatedStops.map(s => s.name),
        }),
      });
      if (!res.ok) throw new Error("Failed to update route");
      const savedRoute = await res.json();
      // Reload routes so trip setup reflects the exact saved path
      await loadData();
      // Update selectedRoute if this was the active one
      if (selectedRoute?.id === builderRouteId) {
        setSelectedRoute(prev => prev ? { ...prev, ...savedRoute } : prev);
      }
      getSocket().emit("route-updated", { routeId: builderRouteId });
      setShowRouteBuilder(false);
      setInfo(`✅ Route road map updated successfully!`);
      setTimeout(() => setInfo(""), 5000);
    } catch (e: any) {
      setError("Failed to save route: " + e.message);
    }
  };

  /* ─── AUTH GUARD ─── */
  if (!isAuthenticated || user?.role !== "driver") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] via-[#EFF6FF] to-[#E0F2FE] text-slate-800 relative overflow-x-hidden flex flex-col justify-start">
        {/* Header */}
        <header className="bg-white/75 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-40">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center bg-white border border-gray-100 shadow-sm shrink-0">
                  <img src="/aditya-logo.png" alt="Aditya University Logo" className="w-full h-full object-contain p-0.5" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-[#1E293B]">Driver Dashboard</h1>
                  <p className="text-xs text-slate-400">Not Signed In</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="relative flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200/80 bg-slate-50 text-slate-700 shadow-sm hover:bg-slate-100 transition-all">
                  <span className="text-xs">🌐</span>
                  <select
                    value={lang}
                    onChange={(e) => handleLangChange(e.target.value as Language)}
                    className="bg-transparent text-xs font-bold focus:outline-none cursor-pointer pr-4 appearance-none"
                  >
                    <option value="en" className="bg-white text-slate-800">English</option>
                    <option value="te" className="bg-white text-slate-800">తెలుగు</option>
                  </select>
                  <svg className="w-3 h-3 text-purple-700 absolute right-2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <a href="/" className="text-sm text-[#2563EB] font-medium hover:underline">Home</a>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="max-w-md mx-auto px-4 py-12 animate-slide-up">
          <div className="relative bg-white/85 backdrop-blur-lg border border-white/60 p-8 rounded-3xl shadow-xl shadow-blue-100/50 max-w-md w-full text-center space-y-6">
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-gradient-to-br from-[#2563EB] to-[#3B82F6] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-200">
                <svg className="w-8 h-8 text-slate-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                </svg>
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight text-[#1E293B]">{translations[lang].title}</h2>
              <p className="text-sm text-slate-500 mt-1">{translations[lang].subtitle}</p>
            </div>

            <div className="mb-4 bg-indigo-50 border border-indigo-100/70 text-indigo-700 rounded-xl px-4 py-3 text-xs">
              <strong>{translations[lang].infoTitle}</strong>{translations[lang].infoDesc}
            </div>

            <form onSubmit={handleDriverSubmit} className="space-y-4">
              {loginError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                  {loginError}
                </div>
              )}
              
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{translations[lang].identifierLabel}</label>
                <input
                  type="text"
                  placeholder={translations[lang].identifierPlaceholder}
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  className="bg-white/90 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{translations[lang].passwordLabel}</label>
                <input
                  type="password"
                  placeholder={translations[lang].passwordPlaceholder}
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  className="bg-white/90 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-sm"
                  required
                />
              </div>

              <button
                type="button"
                onClick={handleDriverFingerprintLogin}
                disabled={loginLoading}
                className="w-full rounded-xl border border-purple-200 bg-purple-50 text-purple-700 py-3.5 font-bold hover:bg-purple-100 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
              >
                {translations[lang].fingerprintBtn}
              </button>

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-slate-800 rounded-xl font-bold transition-all shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loginLoading ? (
                  <>
                    <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                    {translations[lang].submitting}
                  </>
                ) : (
                  translations[lang].submitBtn
                )}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-slate-500">
              {translations[lang].footerText}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] via-[#EFF6FF] to-[#E0F2FE] text-slate-800 relative overflow-x-hidden flex flex-col justify-start">

      {/* Header */}
      <header className="bg-white/75 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-40">
        <div className={`${pageTab === "profile" ? "max-w-6xl" : "max-w-4xl"} mx-auto px-2 sm:px-6 transition-all duration-300`}>
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl overflow-hidden flex items-center justify-center bg-white border border-gray-100 shadow-sm shrink-0">
                <img src="/aditya-logo.png" alt="Aditya University Logo" className="w-full h-full object-contain p-0.5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-lg font-bold text-[#1E293B] whitespace-nowrap">
                  <span className="text-[#F27A35]">ADITYA</span> <span className="text-[#2563EB]">UNIVERSITY</span>
                </h1>
                <p className="text-[10px] sm:text-xs text-slate-400 font-semibold truncate">
                  <span className="hidden sm:inline">{translations[lang].driverDashboard} · </span>
                  {user?.name}
                  {profile?.driverId && <span className="text-[#7C3AED] font-bold ml-1">· {profile.driverId}</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
              <div className="relative flex items-center gap-1 px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-lg border border-slate-200/80 bg-slate-50 text-slate-700 shadow-sm hover:bg-slate-100 transition-all">
                <span className="text-xs">🌐</span>
                <select
                  value={lang}
                  onChange={(e) => handleLangChange(e.target.value as Language)}
                  className="bg-transparent text-[10px] sm:text-xs font-bold focus:outline-none cursor-pointer pr-3 sm:pr-4 appearance-none"
                >
                  <option value="en" className="bg-white text-slate-800">English</option>
                  <option value="te" className="bg-white text-slate-800">తెలుగు</option>
                </select>
                <svg className="w-3 h-3 text-purple-700 absolute right-2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {tripStatus !== "idle" && (
                <div className={`flex items-center gap-1 sm:gap-2 px-1.5 py-1 sm:px-3 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold ${gpsStatus === "active" ? "bg-green-100 text-green-700" : gpsStatus === "error" ? "bg-red-100 text-red-700" : "bg-gray-100 text-slate-400"}`}>
                  <span className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${gpsStatus === "active" ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)] animate-pulse" : gpsStatus === "error" ? "bg-red-500" : "bg-gray-300"}`}/>
                  <span className="hidden sm:inline">
                    {gpsStatus === "active" ? translations[lang].gpsActive : gpsStatus === "error" ? translations[lang].gpsError : translations[lang].gpsInactive}
                  </span>
                </div>
              )}
              <button
                onClick={() => setPageTab(pageTab === "trip" ? "profile" : "trip")}
                className="flex items-center gap-1.5 px-2 py-1.5 sm:px-4 sm:py-2 text-[10px] sm:text-xs font-extrabold rounded-xl border border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-sm cursor-pointer"
              >
                {pageTab === "trip" ? translations[lang].tabProfile : translations[lang].tabTrip}
              </button>
              <button onClick={logout} className="text-xs sm:text-sm text-slate-500 hover:text-red-500 font-semibold">{translations[lang].logoutBtn}</button>
            </div>
          </div>
        </div>
      </header>

      <div className={`${pageTab === "profile" ? "max-w-6xl py-4 mt-2" : "max-w-4xl py-6 mt-6"} mx-auto px-4 sm:px-6 transition-all duration-300`}>
        {/* Alerts */}
        {error && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 animate-slide-up border ${error.includes("🚨") ? "bg-orange-50 text-orange-700 border-orange-200" : "bg-red-50 text-red-700 border-red-200"}`}>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="text-lg leading-none opacity-50 hover:opacity-100">×</button>
          </div>
        )}
        {info && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 bg-green-50 text-green-700 border border-green-200 animate-slide-up">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
            <span className="flex-1">{info}</span>
          </div>
        )}

        {/* ══════ PROFILE TAB ══════ */}
        {pageTab === "profile" && (
          (() => {
            const sidebarItems = [
              { id: "driver-id", icon: "🪪", label: lang === "te" ? "డ్రైవర్ ఐడి కార్డ్" : "Driver ID Card" },
              { id: "edit-profile", icon: "👤", label: lang === "te" ? "ప్రొఫైల్ సవరించండి" : "Edit Profile" },
              { id: "change-password", icon: "🔑", label: lang === "te" ? "పాస్‌వర్డ్ మార్చండి" : "Change Password" },
              { id: "student-details", icon: "🎓", label: lang === "te" ? "విద్యార్థుల వివరాలు" : "Student Details" },
              { id: "admin-desk", icon: "👨‍💼", label: lang === "te" ? "అడ్మిన్ డెస్క్" : "Admin Desk" },
              { id: "route-editor", icon: "🗺️", label: lang === "te" ? "రూట్ మ్యాప్ ఎడిటర్" : "Route Map Editor" },
            ] as const;

            return (
              <div className="grid lg:grid-cols-12 gap-8 animate-fade-in max-w-6xl mx-auto items-start">
                {/* Left Sidebar Navigation (Desktop only) */}
                <div className="hidden lg:block lg:col-span-3 w-full">
                  <div className="bg-white/70 backdrop-blur-md rounded-3xl border border-slate-200/60 p-5 shadow-lg shadow-blue-50/50 lg:sticky lg:top-24">
                    <div className="hidden lg:flex items-center gap-3 pb-4 mb-4 border-b border-slate-100">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-lg shadow-inner">
                        👤
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-sm">Account Settings</h3>
                        <p className="text-[10px] text-slate-400 font-medium">Manage profile & preferences</p>
                      </div>
                    </div>

                    <div className="flex lg:flex-col gap-2">
                      {sidebarItems.map(item => (
                        <button
                          key={item.id}
                          onClick={() => setProfileSubTab(item.id)}
                          className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-left text-xs font-black transition-all flex-shrink-0 cursor-pointer ${
                            profileSubTab === item.id
                              ? "bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20 scale-[1.02]"
                              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 bg-white/50 border border-slate-100/50 hover:border-slate-200"
                          }`}
                        >
                          <span className="text-base leading-none">{item.icon}</span>
                          <span>{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Content Pane */}
                <div className="lg:col-span-9 space-y-6 w-full">
                  {/* Mobile Navigation Trigger */}
                  <div className="lg:hidden">
                    <button
                      onClick={() => setIsMobileSidebarOpen(true)}
                      className="w-full flex items-center justify-between px-5 py-4 bg-white/80 backdrop-blur-md rounded-3xl border border-slate-200/60 shadow-md shadow-blue-50/50 text-slate-800 hover:bg-slate-50 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-lg shadow-inner">
                          ☰
                        </div>
                        <div className="text-left">
                          <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Account Settings</span>
                          <span className="text-xs font-extrabold text-slate-800">
                            {sidebarItems.find(item => item.id === profileSubTab)?.label}
                          </span>
                        </div>
                      </div>
                      <span className="text-slate-400 text-xs">▼</span>
                    </button>
                  </div>

                  {/* Mobile Drawer (sliding sidebar) */}
                  {isMobileSidebarOpen && (
                    <div className="fixed inset-0 z-50 lg:hidden flex">
                      {/* Dark backdrop overlay */}
                      <div 
                        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity"
                        onClick={() => setIsMobileSidebarOpen(false)}
                      />
                      
                      {/* Drawer Content pane sliding from left */}
                      <div className="relative flex-1 flex flex-col max-w-[280px] w-full bg-white p-5 shadow-2xl h-full animate-slide-right border-r border-slate-100">
                        {/* Drawer Header */}
                        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-base shadow-inner">
                              👤
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-800 text-xs">Account Settings</h4>
                              <p className="text-[9px] text-slate-400 font-medium">Manage preferences</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setIsMobileSidebarOpen(false)}
                            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-205 text-slate-500 font-bold flex items-center justify-center cursor-pointer text-sm"
                          >
                            ✕
                          </button>
                        </div>

                        {/* Drawer List */}
                        <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-1">
                          {sidebarItems.map(item => (
                            <button
                              key={item.id}
                              onClick={() => {
                                setProfileSubTab(item.id);
                                setIsMobileSidebarOpen(false);
                              }}
                              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left text-xs font-black transition-all cursor-pointer ${
                                profileSubTab === item.id
                                  ? "bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20"
                                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 bg-white/50 border border-slate-100/50 hover:border-slate-200"
                              }`}
                            >
                              <span className="text-sm leading-none">{item.icon}</span>
                              <span>{item.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Driver ID Sub-tab */}
                  {profileSubTab === "driver-id" && (
                    <div className="space-y-6 animate-fade-in">
                      {/* Premium Digital Transport ID Card */}
                      <div className="relative overflow-hidden rounded-3xl bg-white text-slate-800 shadow-xl shadow-blue-100/40 border border-slate-200/80 max-w-sm mx-auto flex flex-col">
                        {/* Glowing holographic ambient blobs inside the card */}
                        <div className="absolute top-[-10%] right-[-10%] w-32 h-32 rounded-full bg-gradient-to-br from-amber-400/20 to-orange-500/10 blur-2xl pointer-events-none" />
                        <div className="absolute bottom-[30%] left-[-15%] w-36 h-36 rounded-full bg-gradient-to-br from-blue-500/10 to-indigo-600/20 blur-2xl pointer-events-none" />

                        {/* ID Card Header */}
                        <div className="bg-gradient-to-r from-blue-800 to-indigo-950 px-5 py-4 flex items-center justify-between text-white border-b-2 border-amber-400 relative z-10">
                          <div className="flex items-center gap-2.5">
                            <img src="/aditya-logo.png" alt="Aditya Logo" className="w-8 h-8 object-contain bg-white rounded-full p-1 shadow-sm shrink-0" />
                            <div>
                              <h2 className="text-[10px] font-black tracking-widest uppercase text-amber-400 leading-none">ADITYA UNIVERSITY</h2>
                              <p className="text-[7px] font-black text-slate-300 tracking-wider mt-0.5">TRANSPORT DEPARTMENT</p>
                            </div>
                          </div>
                          <div className="bg-amber-400 text-slate-950 font-black text-[9px] px-2 py-0.5 rounded uppercase tracking-wider shadow-sm">
                            STAFF
                          </div>
                        </div>

                        {/* ID Card Body */}
                        <div className="px-5 py-6 flex items-start justify-between relative z-10 gap-3.5 bg-gradient-to-br from-[#FFFBF7] via-white to-[#F0F7FF] border-b border-slate-100">
                          <div className="flex items-start gap-3.5 min-w-0">
                            {/* Avatar Wrapper */}
                            <div className="relative flex-shrink-0">
                              {/* Avatar Block */}
                              <div 
                                onClick={handlePhotoClick}
                                className="w-24 h-28 bg-white border border-slate-200 p-1 shadow-md rounded-xl relative group/avatar overflow-hidden cursor-pointer transition-transform duration-300 hover:scale-[1.02]"
                                title="Click to upload profile photo"
                              >
                                <div className="w-full h-full bg-slate-100 rounded-[8px] flex items-center justify-center overflow-hidden relative">
                                  {profilePhoto ? (
                                    <img src={profilePhoto} alt="Driver Avatar" className="w-full h-full object-cover" />
                                  ) : (
                                    <span className="text-4xl font-black text-slate-300">{user?.name?.charAt(0).toUpperCase()}</span>
                                  )}
                                  {/* Hover Overlay */}
                                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                                    <span className="text-[9px] font-bold text-white text-center px-1">Upload Photo</span>
                                  </div>
                                  {/* Badge Label inside photo */}
                                  <div className="absolute bottom-0 inset-x-0 bg-blue-600/90 text-white text-[8px] font-black text-center py-0.5 uppercase tracking-wide">
                                    DRIVER
                                  </div>
                                </div>
                              </div>

                              {/* Remove Profile Photo Option */}
                              {profilePhoto && (
                                <button
                                  onClick={handleRemovePhoto}
                                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center shadow-lg border border-white transition-colors z-20 text-[9px] font-bold cursor-pointer"
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
                            <div className="flex-1 min-w-0 space-y-2">
                              <div>
                                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Name of Staff</span>
                                <h3 className="text-xs font-black text-slate-800 tracking-tight leading-none uppercase truncate">{profile?.name || user?.name}</h3>
                                <span className="text-[9px] font-semibold text-slate-400 truncate block mt-0.5">{profile?.email || user?.email}</span>
                              </div>
                              
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Driver ID</span>
                                  <p className="text-xs font-black text-blue-700 leading-none">{profile?.driverId || "—"}</p>
                                </div>
                                <div>
                                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Phone</span>
                                  <p className="text-xs font-black text-slate-700 leading-none">{profile?.phone || user?.phone || "—"}</p>
                                </div>
                              </div>

                              <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between gap-2">
                                <div>
                                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Designation</span>
                                  <p className="text-[9px] font-black text-slate-600 leading-none">Bus Driver</p>
                                </div>
                                <div className="text-right">
                                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">License No</span>
                                  <p className="text-[9px] font-black text-slate-700 leading-none">{profile?.licenseNo || "—"}</p>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* QR Code on the right side */}
                          <div className="flex flex-col items-center gap-1 shrink-0">
                            <div className="w-18 h-18 bg-white border border-slate-200 p-1 rounded-xl shadow-inner flex items-center justify-center relative group/qr">
                              {qrCodeUrl ? (
                                <img src={qrCodeUrl} alt="Driver QR" className="w-full h-full object-contain" />
                              ) : (
                                <span className="text-xl">🪪</span>
                              )}
                            </div>
                            <span className="text-[7px] font-bold text-slate-400 uppercase tracking-wide">Verification</span>
                          </div>
                        </div>

                        {/* ID Card Bottom Transport Specs */}
                        <div className="bg-slate-900 text-white p-3.5 flex items-center justify-between text-xs relative overflow-hidden z-10">
                          {/* Micro print pattern in background */}
                          <div className="absolute inset-0 bg-[linear-gradient(45deg,#ffffff02_25%,transparent_25%),linear-gradient(-45deg,#ffffff02_25%,transparent_25%)] bg-[size:6px_6px] pointer-events-none" />
                          
                          <div>
                            <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Assigned Bus ID</p>
                            <p className="font-black text-amber-400 flex items-center gap-1 mt-0.5">
                              {profile?.assignedBusId || user?.assignedBusId ? (
                                <>
                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                  🚍 {profile?.assignedBusId || user?.assignedBusId}
                                </>
                              ) : (
                                <>
                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500"></span>
                                  NONE
                                </>
                              )}
                            </p>
                          </div>
                          
                          <div className="text-right">
                            <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Assigned Route</p>
                            <p className="font-black text-slate-200 mt-0.5 truncate max-w-[160px]" title={profile?.preferredRouteId ? (routes.find(r => r.id === profile.preferredRouteId)?.routeName || "Not set") : "Not set"}>
                              ⭐ {profile?.preferredRouteId ? (routes.find(r => r.id === profile.preferredRouteId)?.routeName || "Not set") : "Not set"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Login Credentials & Fingerprint (light theme) */}
                      <div className="bg-white/70 backdrop-blur-md rounded-3xl border border-slate-200/60 p-5 space-y-3.5 shadow-lg shadow-blue-50/50">
                        <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                          {translations[lang].credentialsHeader}
                        </h3>
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center gap-3 p-3 bg-slate-50/50 rounded-xl border border-slate-100">
                            <span className="text-slate-400 w-24 shrink-0 text-xs font-semibold">{translations[lang].driverIdLabel}</span>
                            <span className="font-bold text-purple-700">{profile?.driverId || "—"}</span>
                          </div>
                          <div className="flex items-center gap-3 p-3 bg-slate-50/50 rounded-xl border border-slate-100">
                            <span className="text-slate-400 w-24 shrink-0 text-xs font-semibold">{translations[lang].emailLabel}</span>
                            <span className="font-semibold text-slate-700 truncate">{profile?.email || user?.email}</span>
                          </div>
                          
                          {/* Fingerprint Toggle */}
                          <div className="flex items-center justify-between gap-3 p-3 bg-slate-50/50 rounded-xl border border-slate-100">
                            <div>
                              <p className="text-[10px] font-semibold text-slate-400">{translations[lang].fingerprintLoginLabel}</p>
                              <p className={`text-xs font-bold ${fingerprintEnabled ? "text-green-600" : "text-slate-400"}`}>
                                {fingerprintEnabled ? translations[lang].enabledStatus : translations[lang].notEnabledStatus}
                              </p>
                            </div>
                            <button onClick={fingerprintEnabled ? disableFingerprintLogin : enableFingerprintLogin} disabled={fingerprintSaving}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 transition-all ${
                                fingerprintEnabled
                                  ? "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                                  : "bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100"
                              }`}>
                              {fingerprintSaving ? translations[lang].pleaseWait : (fingerprintEnabled ? translations[lang].disableBtn : translations[lang].enableBtn)}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Edit Profile Sub-tab */}
                  {profileSubTab === "edit-profile" && (
                    <div className="space-y-6 animate-fade-in">
                      <div className="bg-white/70 backdrop-blur-md rounded-3xl border border-slate-200/60 p-5 space-y-5 shadow-lg shadow-blue-50/50">
                        <div>
                          <h3 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
                            {translations[lang].editProfileHeader}
                          </h3>
                          <p className="text-xs text-gray-500 mt-0.5">Manage your personal transport registration information.</p>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{translations[lang].fullNameLabel}</label>
                            <div className="relative">
                              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">👤</span>
                              <input className="bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-sm" style={{ paddingLeft: "2.5rem" }} value={profileForm.name} onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))} placeholder="Your name"/>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{translations[lang].phoneLabel}</label>
                            <div className="relative">
                              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">📞</span>
                              <input className="bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-sm" style={{ paddingLeft: "2.5rem" }} value={profileForm.phone} onChange={e => setProfileForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone number"/>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{translations[lang].licenseLabel}</label>
                            <div className="relative">
                              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🪪</span>
                              <input className="bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-sm" style={{ paddingLeft: "2.5rem" }} value={profileForm.licenseNo} onChange={e => setProfileForm(f => ({ ...f, licenseNo: e.target.value }))} placeholder="License number"/>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{translations[lang].assignedBusLabel}</label>
                            <div className="relative">
                              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🚍</span>
                              <select className="bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-sm" style={{ paddingLeft: "2.5rem" }} value={profileForm.assignedBusId} onChange={e => setProfileForm(f => ({ ...f, assignedBusId: e.target.value }))}>
                                <option value="">— {translations[lang].noneAssigned} —</option>
                                {buses.map(b => <option key={b.busId} value={b.busId}>{b.busId} · {b.busNumber}</option>)}
                              </select>
                            </div>
                          </div>

                          {/* Preferred Route */}
                          <div className="sm:col-span-2">
                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                              {translations[lang].preferredRouteLabel}
                              <span className="ml-2 text-purple-700 font-normal lowercase">({translations[lang].preferredRouteDesc})</span>
                            </label>
                            <div className="relative">
                              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">⭐</span>
                              <select className="bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 transition-all w-full text-sm"
                                style={{ paddingLeft: "2.5rem" }}
                                value={profileForm.preferredRouteId}
                                onChange={e => setProfileForm(f => ({ ...f, preferredRouteId: e.target.value }))}>
                                <option value="">— {translations[lang].noneAssigned} —</option>
                                {routes.map(r => <option key={r.id} value={r.id}>{r.routeName} ({r.stops.join(" → ")})</option>)}
                              </select>
                            </div>
                          </div>
                        </div>
                        
                        <div className="pt-2">
                          <button onClick={saveProfile} disabled={profileSaving} className="w-full sm:w-auto bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-bold px-6 py-3 rounded-xl transition-all duration-300 shadow-md shadow-blue-200/50 hover:shadow-lg hover:shadow-blue-300/40 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 cursor-pointer">
                            {profileSaving ? translations[lang].savingProfile : translations[lang].saveProfileBtn}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Change Password Sub-tab */}
                  {profileSubTab === "change-password" && (
                    <div className="space-y-6 animate-fade-in">
                      <div className="bg-white/70 backdrop-blur-md rounded-3xl border border-slate-200/60 p-5 space-y-4 shadow-lg shadow-blue-50/50">
                        <div>
                          <h3 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
                            {translations[lang].changePasswordHeader}
                          </h3>
                          <p className="text-xs text-gray-500 mt-0.5">Protect your driver account with a strong password.</p>
                        </div>
                        <div className="grid sm:grid-cols-3 gap-3">
                          <div className="relative">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔑</span>
                            <input type="password" className="bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-sm" style={{ paddingLeft: "2.5rem" }} placeholder={translations[lang].currentPasswordPlaceholder} value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}/>
                          </div>
                          <div className="relative">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🆕</span>
                            <input type="password" className="bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-sm" style={{ paddingLeft: "2.5rem" }} placeholder={translations[lang].newPasswordPlaceholder} value={pwForm.newPw} onChange={e => setPwForm(f => ({ ...f, newPw: e.target.value }))}/>
                          </div>
                          <div className="relative">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔄</span>
                            <input type="password" className="bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-sm" style={{ paddingLeft: "2.5rem" }} placeholder={translations[lang].confirmPasswordPlaceholder} value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}/>
                          </div>
                        </div>
                        <div className="pt-1">
                          <button onClick={changePassword} disabled={profileSaving || !pwForm.current || !pwForm.newPw} className="w-full sm:w-auto bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-800 hover:to-slate-900 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all duration-300 disabled:opacity-50 cursor-pointer">
                            {profileSaving ? translations[lang].changingPassword : translations[lang].changePasswordBtn}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Student Details Sub-tab */}
                  {profileSubTab === "student-details" && (() => {
                    const filtered = assignedStudents.filter(s => {
                      const term = studentSearch.toLowerCase();
                      return (s.name ?? "").toLowerCase().includes(term) ||
                             (s.studentId ?? "").toLowerCase().includes(term) ||
                             (s.boardingStop ?? "").toLowerCase().includes(term);
                    });
                    const activeBusId = profile?.assignedBusId || user?.assignedBusId || "";
                    
                    return (
                      <div className="space-y-6 animate-fade-in">
                        <div className="bg-white/70 backdrop-blur-md rounded-3xl border border-slate-200/60 p-5 space-y-4 shadow-lg shadow-blue-50/50">
                          
                          {/* Header with Refresh */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100">
                            <div>
                              <h3 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
                                {translations[lang].studentDetailsHeader}
                              </h3>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {translations[lang].studentDetailsDesc}
                              </p>
                              {activeBusId && (
                                <span className="inline-block mt-2 px-2.5 py-1 text-[10px] font-black rounded-lg bg-green-50 text-green-700 border border-green-150 shadow-sm">
                                  🚍 Bus: {activeBusId}
                                </span>
                              )}
                            </div>
                            <button 
                              onClick={loadAssignedStudents} 
                              disabled={studentsLoading}
                              className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 hover:bg-blue-100 self-start sm:self-center shrink-0 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                            >
                              {studentsLoading ? (
                                <div className="animate-spin h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent rounded-full" />
                              ) : (
                                <span>🔄</span>
                              )}
                              {translations[lang].refreshBtn}
                            </button>
                          </div>

                          {/* Search Bar */}
                          <div className="relative">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
                            <input
                              type="text"
                              className="bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-xs"
                              style={{ paddingLeft: "2.5rem" }}
                              placeholder={translations[lang].searchStudentsPlaceholder}
                              value={studentSearch}
                              onChange={e => setStudentSearch(e.target.value)}
                            />
                          </div>

                          {/* Students List */}
                          {studentsLoading ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-3">
                              <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
                              <p className="text-xs text-slate-400 font-bold">Loading students...</p>
                            </div>
                          ) : filtered.length === 0 ? (
                            <div className="text-center py-10 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200/80">
                              <span className="text-3xl">🎓</span>
                              <p className="text-slate-500 text-xs mt-2 font-black">
                                {translations[lang].noStudentsText}
                              </p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/50">
                              <table className="min-w-full divide-y divide-slate-200/80 text-left">
                                <thead>
                                  <tr className="bg-slate-50/75 backdrop-blur-sm sticky top-0 z-10 shadow-sm">
                                    <th scope="col" className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                                      {translations[lang].fullNameLabel}
                                    </th>
                                    <th scope="col" className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                                      {translations[lang].studentIdLabel}
                                    </th>
                                    <th scope="col" className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                                      {translations[lang].boardingStopLabel}
                                    </th>
                                    <th scope="col" className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                                      {translations[lang].villageLabel}
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white/40">
                                  {filtered.map((student) => (
                                    <tr key={student.id} className="hover:bg-blue-50/20 transition-colors">
                                      <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="flex items-center gap-3">
                                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-black text-xs shrink-0 shadow-sm">
                                            {student.name ? student.name.charAt(0).toUpperCase() : "S"}
                                          </div>
                                          <div>
                                            <div className="font-bold text-slate-800 text-xs">{student.name}</div>
                                            <div className="text-[10px] text-slate-400 font-medium">{student.email || "—"}</div>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3 whitespace-nowrap">
                                        {student.studentId ? (
                                          <span className="px-2 py-1 text-[9px] font-black rounded-lg bg-purple-50 text-purple-700 border border-purple-100 uppercase tracking-wider">
                                            {student.studentId}
                                          </span>
                                        ) : (
                                          <span className="text-slate-400">—</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600 font-extrabold">
                                        {student.boardingStop || "—"}
                                      </td>
                                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600 font-semibold">
                                        {student.village || "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                        </div>
                      </div>
                    );
                  })()}

                  {/* Admin Desk Sub-tab */}
                  {profileSubTab === "admin-desk" && (
                    <div className="space-y-6 animate-fade-in">
                      {/* Admin Contact Information / Helpdesk (light theme) */}
                      <div className="bg-gradient-to-br from-blue-50/40 to-indigo-50/40 backdrop-blur-md rounded-3xl border border-slate-200/60 p-5 space-y-3.5 shadow-lg shadow-blue-50/50">
                        <div className="flex items-center justify-between">
                          <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                            {translations[lang].adminContactHeader}
                          </h3>
                        </div>
                        <div className="space-y-2">
                          {/* Primary helpline */}
                          <div className="flex items-center justify-between bg-white p-3.5 rounded-2xl border border-blue-100 shadow-sm">
                            <div>
                              <p className="text-sm font-black text-slate-800">Transport Control Office</p>
                              <p className="text-[10px] text-slate-400 mt-0.5">Primary Administrative Helpline</p>
                              <p className="text-xs text-blue-600 mt-1.5 font-bold flex items-center gap-1">
                                <span>📞</span> +91 99887 76655
                              </p>
                            </div>
                            <a
                              href="tel:+919988776655"
                              className="w-10 h-10 bg-gradient-to-r from-blue-600 to-indigo-600 hover:scale-105 active:scale-95 transition-all text-white rounded-xl flex items-center justify-center shadow-md shadow-blue-500/20"
                              title="Call Transport Control Office"
                            >
                              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                                <path d="M6.62 10.79a15.09 15.09 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.11-.27 11.36 11.36 0 0 0 3.58.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.36 11.36 0 0 0 .57 3.58 1 1 0 0 1-.27 1.11z"/>
                              </svg>
                            </a>
                          </div>
                          {/* Dynamic admins list */}
                          {profile?.admins?.map((admin, idx) => (
                            <div key={idx} className="flex items-center justify-between bg-white p-3.5 rounded-2xl border border-blue-100 shadow-sm">
                              <div>
                                <p className="text-sm font-black text-slate-800">{admin.name}</p>
                                <p className="text-[10px] text-slate-400 mt-0.5 font-semibold">{admin.email}</p>
                                {admin.phone && (
                                  <p className="text-xs text-blue-600 mt-1.5 font-bold flex items-center gap-1">
                                    <span>📞</span> {admin.phone}
                                  </p>
                                )}
                              </div>
                              {admin.phone && (
                                <a
                                  href={`tel:${admin.phone}`}
                                  className="w-10 h-10 bg-gradient-to-r from-blue-600 to-indigo-600 hover:scale-105 active:scale-95 transition-all text-white rounded-xl flex items-center justify-center shadow-md shadow-blue-500/20"
                                  title={`Call ${admin.name}`}
                                >
                                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                                    <path d="M6.62 10.79a15.09 15.09 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.11-.27 11.36 11.36 0 0 0 3.58.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.36 11.36 0 0 0 .57 3.58 1 1 0 0 1-.27 1.11z"/>
                                  </svg>
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Alert history */}
                      <div className="bg-white/70 backdrop-blur-md rounded-3xl border border-slate-200/60 p-5 space-y-4 shadow-lg shadow-blue-50/50">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
                            {translations[lang].submittedAlertsHeader}
                          </h3>
                          <button onClick={loadDriverAlerts}
                            className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5 hover:bg-blue-100">
                            {translations[lang].refreshBtn}
                          </button>
                        </div>
                        <div className="space-y-2">
                          {driverAlerts.length === 0 ? (
                            <p className="text-slate-500 text-xs text-center py-6">{translations[lang].noAlertsText}</p>
                          ) : (
                            driverAlerts.map(alert => (
                              <div key={alert.id} className="p-3.5 bg-slate-50 border border-slate-150 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm shadow-sm">
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-extrabold text-slate-700">{alert.title}</span>
                                    <span className="text-[10px] text-slate-400">({formatAlertTime(alert.createdAt || alert.timestamp)})</span>
                                  </div>
                                  <p className="text-xs text-slate-500 mt-1 font-medium">{alert.message}</p>
                                </div>
                                <span className={`px-2.5 py-1 text-[10px] font-bold rounded-lg self-start sm:self-center border ${
                                  alert.resolvedAt
                                    ? "bg-green-50 text-green-700 border-green-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200"
                                }`}>
                                  {alert.resolvedAt ? translations[lang].resolvedText : translations[lang].waitingAdminText}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Route Editor Sub-tab */}
                  {profileSubTab === "route-editor" && (
                    <div className="space-y-6 animate-fade-in">
                      <div className="bg-white/70 backdrop-blur-md rounded-3xl border border-slate-200/60 shadow-lg shadow-blue-50/50 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-150 bg-slate-50 flex items-center justify-between">
                          <div>
                            <h3 className="font-bold text-slate-800 text-base">{translations[lang].routeMapEditorHeader}</h3>
                            <p className="text-xs text-slate-400 mt-0.5">{translations[lang].routeMapEditorDesc}</p>
                          </div>
                          {showRouteBuilder && (
                            <button onClick={() => setShowRouteBuilder(false)}
                              className="text-slate-500 hover:text-red-500 text-lg font-bold transition-colors">✕</button>
                          )}
                        </div>

                        <div className="p-6">
                          {!showRouteBuilder ? (
                            <div className="space-y-4">
                              <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">{translations[lang].chooseRouteLabel}</label>
                                <select className="bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-sm"
                                  value={builderRouteId ?? ""}
                                  onChange={e => setBuilderRouteId(e.target.value ? parseInt(e.target.value) : null)}>
                                  <option value="">— {translations[lang].chooseRouteLabel} —</option>
                                  {routes.map(r => (
                                    <option key={r.id} value={r.id}>
                                      {r.id === (user?.preferredRouteId) ? "⭐ " : ""}
                                      {r.routeName} ({r.stops.join(" → ")})
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <button
                                onClick={() => builderRouteId && setShowRouteBuilder(true)}
                                disabled={!builderRouteId}
                                className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-bold transition-all shadow-md shadow-blue-500/20 disabled:opacity-40 flex items-center gap-2 cursor-pointer">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
                                </svg>
                                {translations[lang].openEditorBtn}
                              </button>
                              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 flex items-start gap-2 shadow-sm">
                                <span className="text-base mt-0.5">💡</span>
                                <div>
                                  <strong>{translations[lang].editorHowItWorksTitle}</strong> {translations[lang].editorHowItWorksDesc}
                                </div>
                              </div>
                            </div>
                          ) : (
                            (() => {
                              const editRoute = routes.find(r => r.id === builderRouteId);
                              const initialStops: BuilderStop[] = editRoute
                                ? parseStopCoords(editRoute.stopCoordinates).map(s => ({ name: s.name, lat: s.lat, lng: s.lng }))
                                : [];
                              return (
                                <RouteBuilderMap
                                  initialStops={initialStops}
                                  routeName={editRoute?.routeName}
                                  height={480}
                                  onSave={handleRouteBuilderSave}
                                  onCancel={() => setShowRouteBuilder(false)}
                                />
                              );
                            })()
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()
        )}

        {/* ══════ TRIP TAB ══════ */}
        {pageTab === "trip" && (<>
          {/* IDLE: Setup */}
          {tripStatus === "idle" && (
            <div className="max-w-3xl mx-auto animate-slide-up">
              {autoAssigned && inputTab === "qr" && (
                <button
                  onClick={startTrip}
                  disabled={starting}
                  className="w-full mb-4 py-4 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white rounded-2xl font-extrabold transition-all shadow-md shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-3 cursor-pointer"
                >
                  <span className="text-xl">⚡</span>
                  <span>
                    {lang === "te" ? "నా ట్రిప్" : "My Trip"}
                    {busNumber && <span className="bg-white/20 text-xs px-2 py-0.5 rounded-lg font-bold ml-1.5">{busNumber}{selectedRoute && ` · ${selectedRoute.routeName}`}</span>}
                  </span>
                </button>
              )}

              <div className="card p-0 overflow-hidden bg-white/80 backdrop-blur-md border border-white/60 rounded-2xl shadow-md shadow-blue-100/30">
                <div className="bg-gradient-to-r from-[#1D4ED8] to-[#2563EB] px-8 py-6 text-slate-800 border-b border-blue-200/50">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center">
                      <svg className="w-7 h-7 text-slate-800" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">{translations[lang].startNewTripHeader}</h2>
                      <p className="text-blue-100 text-sm mt-0.5">
                        {autoAssigned ? `${translations[lang].autoAssignedDesc}: ${busNumber}` : "Enter bus details or scan QR code"}
                        {user?.preferredRouteId && selectedRoute && ` · Preferred: ${selectedRoute.routeName}`}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-6 sm:p-8">

                  {inputTab === "manual" && (
                    <div className="space-y-4">
                      {/* QR scanned banner */}
                      {qrScanned && qrScanData && (
                        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                          <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shrink-0">
                            <svg className="w-5 h-5 text-slate-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-green-700">QR Code Scanned</p>
                            <p className="text-xs text-green-600">Bus: <strong>{qrScanData.busId}</strong>{qrScanData.routeName && ` · ${qrScanData.routeName}`}</p>
                          </div>
                          <button onClick={() => { setQrScanned(false); setQrScanData(null); }} className="text-green-400 hover:text-green-600 text-lg">×</button>
                        </div>
                      )}

                      {/* Auto-assigned banner */}
                      {autoAssigned && !qrScanned && (
                        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                          <span className="text-lg">🔗</span>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-blue-700">{translations[lang].autoAssignedDesc}</p>
                            <p className="text-xs text-blue-600">
                              Bus: <strong>{busNumber}</strong>
                              {selectedRoute && ` · Route: ${selectedRoute.routeName}`}
                              {user?.preferredRouteId && <span className="ml-1 text-purple-600">⭐ Preferred</span>}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Bus ID */}
                      <div>
                        <label className="block text-sm font-semibold text-slate-300 mb-1.5">{translations[lang].busLabel} ID <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <input type="text" placeholder="e.g. BUS101" value={busNumber}
                            onChange={e => setBusNumber(e.target.value.toUpperCase())}
                            className="bg-white/90 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-lg font-bold text-center pr-10"/>
                          {busNumber && (
                            <button onClick={() => { setBusNumber(""); setSelectedRoute(null); setQrScanned(false); setAutoAssigned(false); }}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400 text-xl">×</button>
                          )}
                        </div>
                      </div>

                      {/* Route */}
                      <div>
                        <label className="block text-sm font-semibold text-slate-300 mb-1.5">{translations[lang].routeLabel}</label>
                        {dataLoading ? (
                          <div className="input-field flex items-center gap-2 text-slate-500">
                            <div className="w-4 h-4 border-2 border-gray-300 border-t-[#2563EB] rounded-full animate-spin"/>Loading…
                          </div>
                        ) : (
                          <select className="bg-white/90 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-sm" value={selectedRoute?.id ?? ""}
                            onChange={e => setSelectedRoute(routes.find(r => r.id === Number(e.target.value)) ?? null)}>
                            <option value="">— {translations[lang].chooseRouteLabel} —</option>
                            {routes.map(r => (
                              <option key={r.id} value={r.id}>
                                {r.id === user?.preferredRouteId ? "⭐ " : ""}
                                {r.routeName} ({r.stops.join(" → ")})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Route preview with direction indicator */}
                      {selectedRoute && (() => {
                        const badge    = getDirectionBadge(tripDirection);
                        const dirStops = getDirectionalStopNames(selectedRoute as RouteWithDirection, tripDirection);
                        const se       = getStartEnd(selectedRoute as RouteWithDirection, tripDirection);
                        return (
                          <div className="space-y-3">
                            {/* ── Direction banner (reversible routes only) ── */}
                            {selectedRoute.isReversible && (
                              <div className={`rounded-2xl overflow-hidden border-2 ${tripDirection === "morning" ? "border-amber-200" : "border-purple-200"}`}>
                                {/* Colour header */}
                                <div className={`px-4 py-3 flex items-center justify-between flex-wrap gap-2 ${tripDirection === "morning" ? "bg-amber-100 text-amber-800 border-b border-amber-200" : "bg-purple-100 text-purple-800 border-b border-purple-200"}`}>
                                  <div className="flex items-center gap-2">
                                    <span className="text-2xl">{badge.emoji}</span>
                                    <div>
                                      <p className="text-slate-800 font-extrabold text-sm">{badge.label}</p>
                                      <p className="text-slate-800/80 text-xs">{badge.sublabel}</p>
                                    </div>
                                  </div>
                                  {/* Manual override */}
                                  <div className="flex items-center gap-1 bg-white/20 rounded-xl p-1">
                                    {(["morning", "auto", "evening"] as const).map(val => {
                                      const em = val === "morning" ? "🌅" : val === "evening" ? "🌆" : null;
                                      const lbl = val === "morning" ? "Morning" : val === "evening" ? "Evening" : "Auto";
                                      const active = val === "auto" ? manualDirection === null : manualDirection === val;
                                      return (
                                        <button key={val}
                                          onClick={() => setManualDirection(val === "auto" ? null : val as TripDirection)}
                                          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${active ? "bg-white text-gray-900 shadow" : "text-slate-800/80 hover:text-slate-800"}`}>
                                          {em} {lbl}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Start → End clearly labelled */}
                                <div className={`px-4 py-3 flex items-center gap-3 ${tripDirection === "morning" ? "bg-amber-50/50" : "bg-purple-50/50"}`}>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <div className="flex items-center gap-2 bg-green-100 border border-green-300 rounded-xl px-3 py-2">
                                        <span className="text-green-700 font-black text-base">A</span>
                                        <div>
                                          <p className="text-[10px] text-green-600 font-bold uppercase tracking-wide">Starting Point</p>
                                          <p className="text-sm font-extrabold text-green-900 leading-tight">{se.start}</p>
                                        </div>
                                      </div>
                                      <svg className="w-6 h-6 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
                                      </svg>
                                      <div className="flex items-center gap-2 bg-red-100 border border-red-300 rounded-xl px-3 py-2">
                                        <span className="text-red-700 font-black text-base">B</span>
                                        <div>
                                          <p className="text-[10px] text-red-600 font-bold uppercase tracking-wide">Destination</p>
                                          <p className="text-sm font-extrabold text-red-900 leading-tight">{se.end}</p>
                                        </div>
                                      </div>
                                    </div>
                                    <p className={`text-xs mt-2 font-semibold ${tripDirection === "morning" ? "text-amber-700" : "text-purple-700"}`}>
                                      {tripDirection === "morning"
                                        ? `🌅 Morning service — before ${selectedRoute.morningCutoff ?? "12:00"} (auto-detected)`
                                        : `🌆 Evening service — after ${selectedRoute.morningCutoff ?? "12:00"} (auto-detected)`}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* ── Stop order list ── */}
                            <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-sm shadow-blue-100/10">
                              <p className="text-xs font-bold text-[#2563EB] uppercase tracking-wide mb-3">
                                Route Stops — {tripDirection === "morning" ? "Morning Order" : "Evening Order"}
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                {dirStops.map((stop, i) => (
                                  <React.Fragment key={i}>
                                    {i > 0 && <svg className="w-4 h-4 text-[#2563EB] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>}
                                    <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                                      i === 0               ? "bg-green-100 text-green-800 border border-green-300" :
                                      i === dirStops.length-1 ? "bg-red-100 text-red-800 border border-red-300" :
                                      "bg-white text-slate-300 border border-gray-200"
                                    }`}>
                                      {i === 0 ? "🟢 " : i === dirStops.length-1 ? "🔴 " : ""}{stop}
                                    </span>
                                  </React.Fragment>
                                ))}
                              </div>
                              {selectedRoute.distance && (
                                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#DBEAFE] text-xs text-slate-400">
                                  <span>📏 {selectedRoute.distance} km</span>
                                  {selectedRoute.estimatedDuration && <span>⏱ ~{selectedRoute.estimatedDuration} min</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Start button */}
                      <button onClick={startTrip} disabled={!canStart || starting}
                        className="w-full py-4 mt-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-slate-800 rounded-xl font-bold transition-all shadow-md shadow-blue-500/20 flex items-center justify-center gap-3 disabled:opacity-40">
                        {starting
                          ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>Starting…</>
                          : <><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                            {lang === "te" ? "ట్రిప్ ప్రారంభించండి" : "Start Trip"}{busNumber && <span className="bg-white/20 text-sm px-2 py-0.5 rounded-lg font-bold ml-1">{busNumber}</span>}</>
                        }
                      </button>
                      {!canStart && <p className="text-center text-xs text-slate-500">Enter a bus ID or scan the QR code</p>}

                      <button onClick={() => setInputTab("qr")}
                        className="w-full py-3 mt-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all border border-slate-200 flex items-center justify-center gap-2">
                        📷 Back to QR Scanner
                      </button>
                    </div>
                  )}

                  {inputTab === "qr" && (
                    <QRScanner onScan={onQRScan} onError={msg => setError("QR Error: " + msg)} onClose={() => setInputTab("manual")}/>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ACTIVE/PAUSED: Trip Dashboard */}
          {tripStatus !== "idle" && (
            <div className="space-y-5 animate-fade-in">
              {/* Stats — 6 cards */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {[
                  {
                    label: lang === "te" ? "స్థితి" : "Status",
                    value: <div className="flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full ${tripStatus === "active" ? "bg-green-500 pulse-dot" : "bg-yellow-500"}`}/><span className="capitalize font-semibold text-base">{tripStatus}</span></div>,
                  },
                  {
                    label: lang === "te" ? "వేగం" : "Speed",
                    value: <><span className="text-2xl font-black">{speed.toFixed(0)}</span><span className="text-sm font-normal text-slate-500"> km/h</span></>,
                  },
                  {
                    label: lang === "te" ? "మిగిలిన సమయం" : "Remaining Time",
                    value: liveDestEta != null
                      ? <span className="text-[#2563EB] font-black text-xl">{liveDestEta >= 60 ? `${Math.floor(liveDestEta/60)}h ${liveDestEta%60}m` : `${liveDestEta} min`}</span>
                      : <span className="text-slate-500 text-base">—</span>,
                  },
                  {
                    label: lang === "te" ? "మిగిలిన దూరం" : "Remaining Dist",
                    value: liveDestDist != null
                      ? <><span className="text-2xl font-black">{liveDestDist.toFixed(1)}</span><span className="text-sm font-normal text-slate-500"> km</span></>
                      : <span className="text-slate-500 text-base">—</span>,
                  },
                  {
                    label: lang === "te" ? "మొత్తం దూరం" : "Total Distance",
                    value: liveTotalDist != null
                      ? <><span className="text-2xl font-black">{liveTotalDist.toFixed(1)}</span><span className="text-sm font-normal text-slate-500"> km</span></>
                      : (selectedRoute?.distance ? <><span className="text-2xl font-black">{selectedRoute.distance.toFixed(1)}</span><span className="text-sm font-normal text-slate-500"> km</span></> : <span className="text-slate-500 text-base">—</span>),
                  },
                  {
                    label: lang === "te" ? "బస్సు / రూట్" : "Bus / Route",
                    value: <div><div className="font-black text-[#2563EB] text-lg leading-tight">{busNumber}</div><div className="text-xs text-slate-500 truncate max-w-[90px]">{selectedRoute?.routeName ?? "—"}</div></div>,
                  },
                ].map((s, i) => (
                  <div key={i} className="card py-3 px-4 bg-white border border-blue-100 rounded-xl shadow-md shadow-blue-100/20 text-slate-800">
                    <p className="text-[10px] text-slate-500 mb-1 font-semibold uppercase tracking-wide">{s.label}</p>
                    <div className="text-slate-800">{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Map — direction-aware route */}
              <div className="card p-0 overflow-hidden shadow-md bg-white border border-[#DBEAFE]">
                <DriverMap
                   location={location}
                   positionHistory={positionHistory}
                   speed={speed}
                   elapsed={elapsed}
                   busId={busNumber}
                   route={selectedRoute ? {
                     ...selectedRoute,
                     stopCoordinates: getDirectionalStops(selectedRoute as RouteWithDirection, tripDirection),
                     stops: getDirectionalStopNames(selectedRoute as RouteWithDirection, tripDirection),
                   } : null}
                   onEtaUpdate={({ destEtaMin, destDistKm, totalDistKm, totalDurMin }) => {
                     setLiveDestEta(destEtaMin);
                     setLiveDestDist(destDistKm);
                     setLiveTotalDist(totalDistKm);
                     setLiveTotalTime(totalDurMin);
                   }}
                 />
              </div>

              {/* Direction badge on active trip — shows start→end clearly */}
              {selectedRoute?.isReversible && (() => {
                const badge = getDirectionBadge(tripDirection);
                const se    = getStartEnd(selectedRoute as RouteWithDirection, tripDirection);
                return (
                  <div className={`rounded-xl overflow-hidden border ${tripDirection === "morning" ? "border-amber-300" : "border-purple-300"}`}>
                    <div className={`flex items-center gap-3 px-4 py-2 ${tripDirection === "morning" ? "bg-amber-400 text-slate-800" : "bg-purple-600 text-slate-800"}`}>
                      <span className="text-xl">{badge.emoji}</span>
                      <div>
                        <p className="font-extrabold text-sm">{badge.label}</p>
                        <p className="text-slate-800/75 text-xs">{badge.sublabel}</p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-3 px-4 py-2.5 ${tripDirection === "morning" ? "bg-amber-50" : "bg-purple-50"}`}>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-800 border border-green-300`}>🟢 {se.start}</span>
                      <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-800 border border-red-300`}>🔴 {se.end}</span>
                    </div>
                  </div>
                );
              })()}

              {/* GPS coords */}
              <div className="card py-3 px-4 flex items-center gap-3 bg-white border border-[#DBEAFE]">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${gpsStatus === "active" ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)] animate-pulse" : "bg-gray-300"}`}/>
                <span className="text-xs text-slate-400">{lang === "te" ? "నిర్దేశాంకాలు:" : "Coordinates:"}</span>
                <span className="text-xs font-mono font-semibold text-slate-800">
                  {location ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}` : "Waiting for GPS…"}
                </span>
                {location?.accuracy && <span className="ml-auto text-xs text-slate-500">±{location.accuracy.toFixed(0)}m</span>}
              </div>

              {/* Controls */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {tripStatus === "active"
                  ? <button onClick={pauseTrip} className="bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 rounded-xl py-3.5 font-bold flex items-center justify-center gap-2 transition-all"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>{lang === "te" ? "పాజ్" : "Pause"}</button>
                  : <button onClick={resumeTrip} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-slate-800 rounded-xl py-3.5 font-bold flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 disabled:opacity-50"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/></svg>{translations[lang].resumeBtn}</button>
                }
                <button onClick={stopTrip} className="bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-slate-800 rounded-xl py-3.5 font-bold flex items-center justify-center gap-2 shadow-md shadow-red-500/20">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>{translations[lang].endTripBtn}
                </button>
                <button onClick={() => setShowCombineModal(true)}
                  className="bg-gradient-to-r from-blue-500 to-indigo-650 hover:from-blue-600 hover:to-indigo-700 text-slate-800 rounded-xl py-3.5 font-bold flex items-center justify-center gap-2 shadow-md">
                  🚍 {translations[lang].combineBusBtn}
                </button>
                <button onClick={() => setShowEmergencyModal(true)}
                  className="bg-gradient-to-r from-red-500 to-red-650 text-slate-800 rounded-xl py-3.5 font-bold hover:from-red-600 hover:to-red-700 flex items-center justify-center gap-2 shadow-md">
                  🚨 {translations[lang].emergencyAlertBtn}
                </button>
              </div>
            </div>
          )}
        </>)}
      </div>

      {/* Combine Bus Modal */}
      {showCombineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white text-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-slide-up border border-slate-100">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-650 px-5 py-4 text-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold">🔁 {translations[lang].combineBusModalTitle}</h3>
                <p className="text-xs text-blue-100 mt-0.5">{translations[lang].combineBusModalDesc} ({busNumber || "—"})</p>
              </div>
              <button onClick={() => !combiningBus && setShowCombineModal(false)}
                className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 font-bold">
                ×
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-800">
                {translations[lang].combineBusModalNote}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">{translations[lang].anotherBusNumberLabel}</label>
                <input
                  type="text"
                  placeholder="e.g. BUS102"
                  value={combineBusId}
                  onChange={e => setCombineBusId(e.target.value.toUpperCase())}
                  className="bg-white/90 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all w-full text-sm"
                  disabled={combiningBus}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">{translations[lang].reasonMessageLabel}</label>
                <textarea
                  placeholder="e.g. Bus 101 broke down, combining routes."
                  value={combineReason}
                  onChange={e => setCombineReason(e.target.value)}
                  className="input-field min-h-[80px]"
                  disabled={combiningBus}
                />
              </div>
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowCombineModal(false)} disabled={combiningBus}
                className="px-5 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 rounded-xl font-bold transition-all">
                {translations[lang].cancelBtn}
              </button>
              <button onClick={combineBus} disabled={combiningBus || !combineBusId}
                className="px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-slate-800 rounded-xl font-bold transition-all shadow-md shadow-blue-500/20">
                {combiningBus ? translations[lang].combiningStatus : translations[lang].combineNotifyBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emergency Alert Modal */}
      {showEmergencyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white text-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-slide-up border border-slate-100">
            <div className="bg-gradient-to-r from-red-600 to-orange-600 px-5 py-4 text-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold">🚨 {translations[lang].sendEmergencyModalTitle}</h3>
                <p className="text-xs text-red-100 mt-0.5">{translations[lang].emergencyModalDesc}</p>
              </div>
              <button onClick={() => !sendingEmergency && setShowEmergencyModal(false)}
                className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 font-bold">
                ×
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-800">
                {translations[lang].emergencyModalNote}
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">{translations[lang].selectProblemLabel}</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {EMERGENCY_TYPES.map(type => (
                    <button
                      key={type.id}
                      onClick={() => setEmergencyType(type.id)}
                      className={`px-3 py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                        emergencyType === type.id
                          ? "bg-red-50 text-red-700 border-red-300 shadow-sm"
                          : "bg-white hover:bg-gray-50 border-gray-200"
                      }`}
                    >
                      <span>{type.emoji}</span>
                      <span>{type.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">{translations[lang].reasonDetailsLabel}</label>
                <textarea
                  placeholder="e.g. Engine heat indicator high, pulling over safely."
                  value={emergencyReason}
                  onChange={e => setEmergencyReason(e.target.value)}
                  className="input-field min-h-[80px]"
                  disabled={sendingEmergency}
                />
              </div>
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowEmergencyModal(false)} disabled={sendingEmergency}
                className="px-5 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 rounded-xl font-bold transition-all">
                {translations[lang].cancelBtn}
              </button>
              <button onClick={sendEmergency} disabled={sendingEmergency}
                className="px-5 py-2 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-slate-800 rounded-xl font-bold transition-all shadow-md shadow-red-500/20">
                {sendingEmergency ? translations[lang].sendingStatus : translations[lang].sendAlertBtn}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}