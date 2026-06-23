"use client";

export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-[#EFF6FF] via-white to-[#DBEAFE] flex items-center justify-center p-6">
      <section className="max-w-md w-full bg-white rounded-3xl border border-blue-100 shadow-xl p-8 text-center">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] text-white flex items-center justify-center text-4xl mx-auto mb-5">🚍</div>
        <h1 className="text-2xl font-extrabold text-[#1E293B]">BusTrackLive is offline</h1>
        <p className="text-sm text-gray-500 mt-3 leading-relaxed">
          Your installed app shell is available, but live bus locations, ETA, QR trip start, and alerts need an internet connection.
        </p>
        <button onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-[#2563EB] text-white font-bold px-5 py-3">
          Reconnect and reopen the app
        </button>
      </section>
    </main>
  );
}
