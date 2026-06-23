"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function Home() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const { login, fingerprintLogin, register } = useAuth();
  const [showLogin, setShowLogin]   = useState(false);
  const [loginRole, setLoginRole]   = useState("student");
  const [lockedLoginRole, setLockedLoginRole] = useState<string | null>(null);
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError]           = useState("");
  const [loading, setLoading]       = useState(false);

  // Login fields
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");

  // Register fields
  const [regName,         setRegName]         = useState("");
  const [regEmail,        setRegEmail]        = useState("");
  const [regPassword,     setRegPassword]     = useState("");
  const [regPhone,        setRegPhone]        = useState("");
  const [regParentContact,setRegParentContact]= useState("");
  const [regVillage,      setRegVillage]      = useState("");
  const [regBoardingStop, setRegBoardingStop] = useState("");
  const [regBusId,        setRegBusId]        = useState("");
  const [regStudentId,    setRegStudentId]    = useState("");
  const [buses,           setBuses]           = useState<{ busId: string; busNumber: string; route?: { stops: string[] } }[]>([]);

  // Load buses when register form opens
  useEffect(() => {
    if (isRegister && loginRole === "student" && buses.length === 0) {
      fetch("/api/buses")
        .then(r => {
          if (!r.ok || !r.headers.get("content-type")?.includes("json")) throw new Error("not json");
          return r.json();
        })
        .then(setBuses)
        .catch(() => { });
    }
  }, [isRegister, loginRole, buses.length]);

  // Get stops for selected bus
  const selectedBus    = buses.find(b => b.busId === regBusId);
  const availableStops = selectedBus?.route?.stops ?? [];

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (user.role === "driver") router.replace("/driver");
    else if (user.role === "student") router.replace("/student");
    else if (user.role === "admin") router.replace("/admin");
  }, [isAuthenticated, user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      if (isRegister) {
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
          name: regName, email: regEmail, password: regPassword,
          role: "student", phone: regPhone, parentContact: regParentContact, village: regVillage,
          boardingStop: regBoardingStop, assignedBusId: regBusId,
          studentId: regStudentId,
        });
      } else {
        await login(email, password, loginRole);
      }
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleFingerprintLogin = async () => {
    setError(""); setLoading(true);
    try {
      await fingerprintLogin(email);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const openDriverPortal = async () => {
    setLoginRole("driver");
    setLockedLoginRole("driver");
    setIsRegister(false);
    setError("");

    const fingerprintRemembered = localStorage.getItem("driver_fingerprint_login");
    if (!fingerprintRemembered) {
      setShowLogin(true);
      return;
    }

    setLoading(true);
    try {
      await fingerprintLogin();
    } catch (err: any) {
      setError(err.message);
      setShowLogin(true);
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated && user) return null;

  return (
    <div className="min-h-screen bg-gradient-to-tr from-[#F0F7FF] via-[#FFFFFF] to-[#FFF7ED] relative overflow-hidden">
      {/* Background Glowing Mesh Orbs */}
      <div className="absolute top-[-10%] left-[-15%] w-[45vw] h-[45vw] rounded-full bg-gradient-to-tr from-blue-200/18 to-indigo-200/18 blur-[120px] animate-orb-slow pointer-events-none z-0" />
      <div className="absolute bottom-[25%] right-[-15%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-tr from-orange-200/18 to-amber-200/18 blur-[130px] animate-orb-slower pointer-events-none z-0" />
      <div className="absolute top-[45%] left-[20%] w-[35vw] h-[35vw] rounded-full bg-gradient-to-br from-blue-100/12 to-indigo-100/12 blur-[120px] pointer-events-none z-0" />

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-slate-200/30 bg-white/45 backdrop-blur-xl transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-18">
            <div className="flex items-center gap-3">
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[#F27A35] to-[#2563EB] rounded-2xl blur-sm opacity-40 group-hover:opacity-75 transition duration-300"></div>
                <div className="relative w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center bg-white shadow-md border border-slate-100 transition-transform duration-300 group-hover:scale-105 p-1">
                  <img src="/aditya-logo.png" alt="Aditya University Logo" className="w-full h-full object-contain" />
                </div>
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight leading-none flex gap-1.5 items-center">
                  <span className="bg-gradient-to-r from-[#F27A35] to-[#E25C05] bg-clip-text text-transparent">ADITYA</span>
                  <span className="bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] bg-clip-text text-transparent">UNIVERSITY</span>
                </h1>
                <p className="text-xs font-extrabold text-slate-400 uppercase tracking-widest mt-1">Real-Time Tracking</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {!showLogin ? (
                <button
                  onClick={() => { setLockedLoginRole(null); setShowLogin(true); }}
                  className="bg-gradient-to-r from-[#2563EB] to-[#3B82F6] hover:from-[#1D4ED8] hover:to-[#2563EB] text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all duration-300 shadow-md shadow-blue-200/50 hover:shadow-lg hover:shadow-blue-300/40 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                >
                  Sign In
                </button>
              ) : (
                <button
                  onClick={() => { setShowLogin(false); setLockedLoginRole(null); }}
                  className="btn-secondary text-xs px-5 py-2.5 hover:bg-slate-50 transition-all duration-300 cursor-pointer"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            <div className="lg:col-span-7 animate-slide-up">
              <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-full px-4.5 py-2 mb-6 shadow-sm">
                <span className="w-2.5 h-2.5 bg-[#2563EB] rounded-full pulse-dot"></span>
                <span className="text-sm font-semibold text-[#2563EB] tracking-wide">Live GPS Streaming Active</span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-[#1E293B] leading-[1.15] mb-6 tracking-tight">
                Real-Time{" "}
                <span className="bg-gradient-to-r from-[#2563EB] via-indigo-600 to-[#3B82F6] bg-clip-text text-transparent">
                  Aditya University Bus
                </span>{" "}
                Tracker
              </h1>
              <p className="text-lg text-gray-600 mb-8 max-w-xl leading-relaxed">
                Effortlessly monitor your college transportation status. Connect directly with live GPS updates broadcasted directly by driver consoles, and find the perfect campus routes.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/student" className="btn-primary text-base px-8 py-3.5 inline-flex items-center gap-2 shadow-lg shadow-blue-200 hover:shadow-blue-300 hover:scale-[1.02]">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Track a Bus
                </Link>
                <button
                  type="button"
                  onClick={openDriverPortal}
                  className="btn-secondary text-base px-8 py-3.5 inline-flex items-center gap-2 hover:scale-[1.02] hover:bg-slate-50 transition-all"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Driver Portal
                </button>
              </div>
            </div>
            
            {/* Live Interactive HUD Mockup */}
            <div className="lg:col-span-5 relative animate-fade-in">
              {/* Background Glow */}
              <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-[#2563EB] to-[#F27A35] opacity-25 blur-2xl pointer-events-none z-0"></div>
              
              <div className="relative bg-white/80 backdrop-blur-xl border border-white/90 p-6 sm:p-8 rounded-3xl shadow-xl z-10 hover:shadow-2xl transition-all duration-300">
                {/* HUD Header */}
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-lg shadow-sm">
                      🚍
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Broadcasting</p>
                      <p className="text-base font-bold text-slate-800">BUS-516 • Jaggampeta Route</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-bold border border-blue-100 shadow-sm">
                    <span className="w-2 h-2 bg-blue-600 rounded-full pulse-dot"></span>
                    LIVE
                  </div>
                </div>

                {/* Animated SVG Route Grid Graphic */}
                <div className="relative bg-slate-900 rounded-2xl p-6 mb-6 shadow-inner overflow-hidden border border-slate-800">
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none"></div>
                  
                  <svg className="w-full h-36 relative z-10" viewBox="0 0 340 140" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* Base grey line */}
                    <path d="M40 70 C 100 20, 160 120, 300 70" stroke="#334155" strokeWidth="4" strokeLinecap="round" />
                    
                    {/* Glowing active line */}
                    <path d="M40 70 C 100 20, 160 120, 300 70" stroke="#2563EB" strokeWidth="4" strokeLinecap="round" className="route-path-animated" />
                    
                    {/* Jaggampeta stop */}
                    <circle cx="40" cy="70" r="6" fill="#10B981" />
                    <circle cx="40" cy="70" r="12" stroke="#10B981" strokeWidth="1.5" className="pulse-ring-element" />
                    <text x="40" y="98" fill="#94A3B8" fontSize="9" fontWeight="bold" textAnchor="middle">Jaggampeta</text>
                    
                    {/* Nagaram transit stop */}
                    <circle cx="160" cy="70" r="5" fill="#F59E0B" />
                    <text x="160" y="98" fill="#94A3B8" fontSize="9" fontWeight="bold" textAnchor="middle">Nagaram</text>
                    
                    {/* Destination Aditya Campus */}
                    <circle cx="300" cy="70" r="6" fill="#EF4444" />
                    <text x="300" y="98" fill="#E2E8F0" fontSize="9" fontWeight="bold" textAnchor="middle">Aditya Campus</text>
                    
                    {/* Bus Indicator */}
                    <g transform="translate(138, 55)">
                      <circle cx="12" cy="12" r="10" fill="#2563EB" opacity="0.25" className="pulse-ring-element" />
                      <circle cx="12" cy="12" r="6" fill="#3B82F6" />
                      <text x="12" y="16" fill="white" fontSize="10" fontWeight="bold" textAnchor="middle">🚌</text>
                    </g>
                  </svg>
                </div>

                {/* Details HUD */}
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-slate-50 border border-gray-100 rounded-xl p-3 shadow-sm hover:border-blue-100 transition-all">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Speed</p>
                    <p className="text-xl font-extrabold text-slate-800">45 <span className="text-xs font-semibold text-gray-500">km/h</span></p>
                  </div>
                  <div className="bg-slate-50 border border-gray-100 rounded-xl p-3 shadow-sm hover:border-blue-100 transition-all">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">ETA</p>
                    <p className="text-xl font-extrabold text-slate-800">08 <span className="text-xs font-semibold text-gray-500">mins</span></p>
                  </div>
                  <div className="bg-slate-50 border border-gray-100 rounded-xl p-3 shadow-sm hover:border-blue-100 transition-all">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Stops Left</p>
                    <p className="text-xl font-extrabold text-slate-800">2 <span className="text-xs font-semibold text-gray-500">more</span></p>
                  </div>
                </div>
              </div>

              {/* Floating tags */}
              <div className="absolute -top-4 -right-4 bg-white border border-blue-50 rounded-2xl shadow-lg p-3.5 flex items-center gap-2.5 z-20 animate-bounce">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                </span>
                <span className="text-xs font-bold text-slate-700">48 Students tracking live</span>
              </div>
              
              <div className="absolute -bottom-4 -left-4 bg-white border border-green-50 rounded-2xl shadow-lg p-3.5 flex items-center gap-2.5 z-20">
                <span className="text-base">⚡</span>
                <span className="text-xs font-bold text-slate-700">Smart Traffic Routing</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works (Timeline Step process) */}
      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24 z-10">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">How It Works</h2>
          <p className="text-gray-500 mt-3 max-w-2xl mx-auto">
            Broadcasting live coordinates coordinates seamlessly between drivers and students.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            { step: "01", icon: "🚍", title: "Driver Starts Trip", desc: "Driver logs in, scans QR code or selects route, and triggers the tracking system.", color: "text-blue-600 bg-blue-50 border-blue-200" },
            { step: "02", icon: "📱", title: "GPS Transmission", desc: "The driver's mobile device starts streaming precise GPS coordinate updates.", color: "text-amber-600 bg-amber-50 border-amber-200" },
            { step: "03", icon: "📡", title: "Instant Syncing", desc: "Data streams through Socket.IO, updating server states every 3-5 seconds.", color: "text-purple-600 bg-purple-50 border-purple-200" },
            { step: "04", icon: "🗺️", title: "Student Map Tracker", desc: "Students track bus on dynamic Mapbox with precise arrival schedules.", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
          ].map((step, i) => (
            <div key={i} className="timeline-step group bg-white/70 backdrop-blur-sm border border-white p-6 rounded-2xl shadow-sm hover:shadow-md transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-extrabold text-[#2563EB] uppercase tracking-wider bg-blue-50 px-2.5 py-1 rounded-lg">Step {step.step}</span>
                <span className="text-3xl">{step.icon}</span>
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">{step.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Advanced Features Grid */}
      <section className="bg-slate-50/50 border-t border-b border-slate-100 py-16 lg:py-24 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">Advanced System Features</h2>
            <p className="text-gray-500 mt-3 max-w-2xl mx-auto">
              Everything needed to keep campus transits safe, prompt, and convenient.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { title: "Live GPS Tracking", desc: "Real-time bus location with smooth animated marker movement on map.", icon: "📍", type: "blue" },
              { title: "Traffic-Aware ETA", desc: "Dynamic arrival predictions using real-time traffic conditions.", icon: "⏱️", type: "orange" },
              { title: "Smart Route Search", desc: "Search buses by stop/village name. Find all buses passing through any location.", icon: "🔍", type: "blue" },
              { title: "QR Code Activation", desc: "Each bus has a unique QR code. Scan to instantly start tracking.", icon: "📷", type: "orange" },
              { title: "Emergency Alerts", desc: "One-tap emergency alert from driver dashboard with instant notification.", icon: "🚨", type: "blue" },
              { title: "Trip History", desc: "Complete trip logs with routes, duration, and distance covered.", icon: "📊", type: "orange" },
            ].map((feature, i) => (
              <div key={i} className={`bg-white border border-gray-100 p-6 rounded-2xl transition-all duration-300 flex gap-4 ${feature.type === 'blue' ? 'card-glow-blue' : 'card-glow-orange'}`}>
                <div className="text-3xl flex-shrink-0 bg-slate-50 w-12 h-12 rounded-xl flex items-center justify-center border border-gray-100 shadow-sm">{feature.icon}</div>
                <div>
                  <h3 className="font-bold text-slate-800 mb-1">{feature.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Login Modal */}
      {showLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-fade-in">
          <div className="glass-solid rounded-3xl p-8 w-full max-w-md shadow-2xl animate-slide-up relative border border-white/60">
            {/* Close */}
            <button onClick={() => { setShowLogin(false); setLockedLoginRole(null); }} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>

            <div className="text-center mb-6">
              <div className="relative w-16 h-16 mx-auto mb-3.5 group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[#F27A35] to-[#2563EB] rounded-2xl blur-sm opacity-50"></div>
                <div className="relative w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center bg-white border border-slate-100 shadow-md p-1">
                  <img src="/aditya-logo.png" alt="Aditya University Logo" className="w-full h-full object-contain" />
                </div>
              </div>
              <h1 className="text-xl font-black tracking-tight flex gap-1 justify-center items-center mb-1">
                <span className="bg-gradient-to-r from-[#F27A35] to-[#E25C05] bg-clip-text text-transparent">ADITYA</span>
                <span className="bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] bg-clip-text text-transparent">UNIVERSITY</span>
              </h1>
              <h2 className="text-lg font-extrabold text-slate-700 mt-2">
                {isRegister ? "Create Account" : lockedLoginRole === "driver" ? "Driver Portal" : "Welcome Back"}
              </h2>
              <p className="text-gray-500 text-xs mt-1 leading-relaxed">
                {isRegister ? "Register as a student to track buses" : lockedLoginRole === "driver" ? "Sign in to activate driver GPS beacon" : "Sign in to access your tracking panel"}
              </p>
            </div>

            {/* Role Tabs — Register only for student */}
            {!isRegister && !lockedLoginRole && (
              <div className="flex bg-slate-50 border border-slate-100 rounded-xl p-1 mb-6">
                {["student", "driver", "admin"].map((role) => (
                  <button key={role} onClick={() => { setLoginRole(role); setError(""); }}
                    className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${loginRole === role ? "bg-white text-[#2563EB] shadow-sm border border-slate-100" : "text-gray-500 hover:text-slate-800"}`}>
                    {role === "student" ? "🎓 Student" : role === "driver" ? "🚍 Driver" : "🔐 Admin"}
                  </button>
                ))}
              </div>
            )}

            {/* Driver hint */}
            {!isRegister && loginRole === "driver" && (
              <div className="mb-4 bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 text-xs text-purple-700 leading-relaxed shadow-sm">
                <strong>Driver Authorization Required:</strong> Use your assigned <strong>Driver ID</strong> (e.g. DRV001) or authorized email address.
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-750 text-sm rounded-xl px-4 py-3 font-semibold">{error}</div>
              )}

              {/* Register form (student only) */}
              {isRegister && loginRole === "student" && (
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {/* Step 1: Basic info */}
                  <div className="bg-[#F8FAFC] rounded-2xl p-4 space-y-2.5 border border-slate-100">
                    <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest">Personal Details</p>
                    <input type="text" placeholder="Full Name *" value={regName} onChange={e => setRegName(e.target.value)} className="input-field" required/>
                    <input type="email" placeholder="Email address *" value={regEmail} onChange={e => setRegEmail(e.target.value)} className="input-field" required/>
                    <input type="password" placeholder="Password *" value={regPassword} onChange={e => setRegPassword(e.target.value)} className="input-field" required/>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="tel" placeholder="Phone" value={regPhone} onChange={e => setRegPhone(e.target.value)} className="input-field"/>
                      <input type="text" placeholder="Roll No / ID *" value={regStudentId} onChange={e => setRegStudentId(e.target.value)} className="input-field" required/>
                    </div>
                    <input type="tel" placeholder="Parent Contact" value={regParentContact} onChange={e => setRegParentContact(e.target.value)} className="input-field"/>
                  </div>

                  {/* Step 2: Bus assignment */}
                  <div className="bg-[#EFF6FF] border border-[#DBEAFE] rounded-2xl p-4 space-y-2.5">
                    <p className="text-[10px] font-extrabold text-[#2563EB] uppercase tracking-widest">🚍 Bus Route Settings</p>
                    <input type="text" placeholder="Boarding Stop Village / Area *" value={regVillage} onChange={e => setRegVillage(e.target.value)} className="input-field" required/>
                    <select className="input-field bg-white" value={regBusId} onChange={e => { setRegBusId(e.target.value); setRegBoardingStop(""); }}>
                      <option value="">— Select your bus (optional) —</option>
                      {buses.map(b => (
                        <option key={b.busId} value={b.busId}>
                          {b.busId} · {b.route?.stops?.join(" → ") ?? ""}
                        </option>
                      ))}
                    </select>
                    {regBusId && availableStops.length > 0 && (
                      <select className="input-field bg-white" value={regBoardingStop} onChange={e => setRegBoardingStop(e.target.value)}>
                        <option value="">— Select your boarding stop —</option>
                        {availableStops.map((s, i) => <option key={i} value={s}>{s}</option>)}
                      </select>
                    )}
                    <p className="text-[10px] text-[#2563EB]/70 leading-relaxed font-semibold">You can update these details anytime from your dashboard</p>
                  </div>
                </div>
              )}

              {/* Login form */}
              {!isRegister && (
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder={loginRole === "driver" ? "Driver ID (e.g. DRV001) or Email" : "Email address"}
                    value={email} onChange={e => setEmail(e.target.value)}
                    className="input-field" required
                  />
                  <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="input-field" required/>
                  {loginRole === "driver" && (
                    <button type="button" onClick={handleFingerprintLogin} disabled={loading}
                      className="w-full rounded-xl border border-purple-200 bg-purple-50 text-purple-700 py-3 font-bold hover:bg-purple-100 disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
                      🔐 Login with Fingerprint
                    </button>
                  )}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full text-base py-3 disabled:opacity-50 shadow-md shadow-blue-200 mt-2 hover:scale-[1.01]">
                {loading
                  ? <span className="flex items-center justify-center gap-2"><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Authorizing...</span>
                  : isRegister ? "Create Account" : "Sign In"
                }
              </button>
            </form>

            {/* Only students can self-register */}
            {loginRole === "student" && !lockedLoginRole && (
              <div className="mt-5 text-center border-t border-slate-100 pt-4">
                <button onClick={() => { setIsRegister(!isRegister); setError(""); }}
                  className="text-sm text-[#2563EB] font-bold hover:underline">
                  {isRegister ? "Already have an account? Sign In" : "New student? Create an account"}
                </button>
              </div>
            )}
            {!isRegister && loginRole !== "student" && (
              <p className="mt-4 text-center text-xs text-gray-400">
                {loginRole === "driver" ? "Drivers are registered by the administration." : "Admin accounts are pre-configured."}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Development Team Section */}
      <section className="bg-white border-t border-slate-100 py-20 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-12 gap-12 items-center">
            
            {/* Left Column: Team Graphic */}
            <div className="lg:col-span-4 flex justify-center">
              <div className="max-w-xs sm:max-w-sm rounded-3xl overflow-hidden shadow-2xl border border-gray-150 p-2.5 bg-gradient-to-br from-blue-50/50 to-indigo-50/50">
                <img src="/dev-team.png" alt="Development Team Illustration" className="w-full rounded-2xl object-cover shadow-sm" />
              </div>
            </div>

            {/* Right Column: Development Team details */}
            <div className="lg:col-span-8">
              <div>
                <h2 className="text-3xl font-extrabold text-slate-800 mb-8 tracking-tight">
                  Development <span className="text-[#2563EB]">Team</span>
                </h2>
                
                <div className="grid sm:grid-cols-3 gap-6">
                  {/* Member 1: Prakash */}
                  <div className="p-8 rounded-2xl shadow-sm flex flex-col items-center text-center group team-card team-card-blue border border-blue-100/50">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white text-xl font-bold shadow-md shadow-blue-200 mb-3.5 group-hover:scale-105 transition-transform">
                      SP
                    </div>
                    <h3 className="font-extrabold text-slate-800 text-base">S Kumar Sai Prakash</h3>
                    <p className="text-xs font-bold text-blue-600 tracking-wider mt-1.5 uppercase bg-blue-50 px-2 py-0.5 rounded">24B11DS189</p>
                    <div className="flex gap-2 mt-5 w-full">
                      <a href="#" className="flex-1 text-center py-1.5 px-3 rounded-lg bg-gray-50 border border-gray-150 hover:bg-gray-100 text-[11px] font-bold text-gray-600 transition-all">GitHub</a>
                      <a href="#" className="flex-1 text-center py-1.5 px-3 rounded-lg bg-blue-50 border border-blue-150 hover:bg-blue-100 text-[11px] font-bold text-blue-600 transition-all">LinkedIn</a>
                    </div>
                  </div>

                  {/* Member 2: Jyothika */}
                  <div className="p-8 rounded-2xl shadow-sm flex flex-col items-center text-center group team-card team-card-purple border border-purple-100/50">
                    <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-600 rounded-full flex items-center justify-center text-white text-xl font-bold shadow-md shadow-purple-200 mb-3.5 group-hover:scale-105 transition-transform">
                      JR
                    </div>
                    <h3 className="font-extrabold text-slate-800 text-base">O Jyothika Reddy</h3>
                    <p className="text-xs font-bold text-purple-600 tracking-wider mt-1.5 uppercase bg-purple-50 px-2 py-0.5 rounded">24B11DS153</p>
                    <div className="flex gap-2 mt-5 w-full">
                      <a href="#" className="flex-1 text-center py-1.5 px-3 rounded-lg bg-gray-50 border border-gray-150 hover:bg-gray-100 text-[11px] font-bold text-gray-600 transition-all">GitHub</a>
                      <a href="#" className="flex-1 text-center py-1.5 px-3 rounded-lg bg-purple-50 border border-purple-150 hover:bg-purple-100 text-[11px] font-bold text-purple-600 transition-all">LinkedIn</a>
                    </div>
                  </div>

                  {/* Member 3: Madhumitha */}
                  <div className="p-8 rounded-2xl shadow-sm flex flex-col items-center text-center group team-card team-card-pink border border-pink-100/50">
                    <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-rose-600 rounded-full flex items-center justify-center text-white text-xl font-bold shadow-md shadow-pink-200 mb-3.5 group-hover:scale-105 transition-transform">
                      MM
                    </div>
                    <h3 className="font-extrabold text-slate-800 text-base">M Madhumitha</h3>
                    <p className="text-xs font-bold text-pink-600 tracking-wider mt-1.5 uppercase bg-pink-50 px-2 py-0.5 rounded">25B21DS024</p>
                    <div className="flex gap-2 mt-5 w-full">
                      <a href="#" className="flex-1 text-center py-1.5 px-3 rounded-lg bg-gray-50 border border-gray-150 hover:bg-gray-100 text-[11px] font-bold text-gray-600 transition-all">GitHub</a>
                      <a href="#" className="flex-1 text-center py-1.5 px-3 rounded-lg bg-pink-50 border border-pink-150 hover:bg-pink-100 text-[11px] font-bold text-pink-600 transition-all">LinkedIn</a>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-50 border-t border-slate-100 py-10 relative z-10">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500">
          <p className="font-semibold">&copy; 2026 Aditya University BusTrack. All rights reserved.</p>
          <p className="text-xs text-gray-400 mt-1.5">Powered by Real-Time GPS Tracking & Broadcast Beacon.</p>
        </div>
      </footer>
    </div>
  );
}
