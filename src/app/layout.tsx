import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import PWAController from "@/components/PWAController";

export const metadata: Metadata = {
  title: "Aditya Bus Connect",
  description: "Aditya Bus Connect - Live college bus tracking system with live GPS, traffic-aware ETA, and smart route search",
  manifest: "/manifest.json",
  applicationName: "Aditya Bus Connect",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Aditya Bus Connect",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png", type: "image/png", sizes: "32x32" },
      { url: "/icons/bus-track-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/bus-track-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/bus-track-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#2563EB",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <AuthProvider>
          {children}
          <PWAController />
        </AuthProvider>
      </body>
    </html>
  );
}
