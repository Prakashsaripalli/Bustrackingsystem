"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";

interface QRScannerProps {
  onScan: (data: { busId: string; routeName?: string }) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
}

type Mode = "camera" | "upload";
type CamStatus = "starting" | "scanning" | "success" | "error";
type UploadStatus = "idle" | "processing" | "success" | "error";

/* ─── Helper: parse QR text → {busId, routeName} ───
 *
 * Supported QR formats:
 *  1. JSON  → {"busId":"BUS101","route":"Jaggampeta-Surrampalem"}
 *  2. Pipe  → BUS101|Jaggampeta-Surrampalem
 *  3. Newline → BUS101\nJaggampeta-Surrampalem
 *  4. Slash → BUS101/Jaggampeta-Surrampalem
 *  5. Comma → BUS101,Jaggampeta-Surrampalem
 *  6. Space → BUS101 Jaggampeta-Surrampalem
 *  7. Plain → BUS101   (just bus number, no route)
 */
function parseQRText(raw: string): { busId: string; routeName?: string } {
  const text = raw.trim();

  // 1. Try JSON first
  try {
    const parsed = JSON.parse(text);
    if (parsed.busId) {
      return {
        busId: String(parsed.busId).trim().toUpperCase(),
        routeName: (parsed.routeName || parsed.route || parsed.routeid || "").trim(),
      };
    }
  } catch { /* not JSON */ }

  // 2. Try common two-part separators: | \n / , then space
  const separators = ["|", "\n", "/", ",", "\\n"];
  for (const sep of separators) {
    if (text.includes(sep)) {
      const parts = text.split(sep).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return {
          busId: parts[0].toUpperCase(),
          routeName: parts.slice(1).join(" ").trim(),   // join rest in case of extra parts
        };
      }
    }
  }

  // 3. Try space separator — first word is bus number, rest is route
  const spaced = text.split(/\s+/);
  if (spaced.length >= 2) {
    return {
      busId: spaced[0].toUpperCase(),
      routeName: spaced.slice(1).join(" ").trim(),
    };
  }

  // 4. Plain text — treat entire string as bus number
  return { busId: text.toUpperCase() };
}

export default function QRScanner({ onScan, onError, onClose }: QRScannerProps) {
  const [mode, setMode] = useState<Mode>("camera");

  const switchMode = (m: Mode) => setMode(m);

  return (
    <div className="flex flex-col gap-4 select-none">
      {/* Mode tab switcher */}
      <div className="flex bg-[#F1F5F9] rounded-xl p-1 gap-1">
        <button
          onClick={() => switchMode("camera")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all ${
            mode === "camera"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14m0 0V9a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h8a2 2 0 002-2v-1z" />
          </svg>
          Live Camera
        </button>
        <button
          onClick={() => switchMode("upload")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all ${
            mode === "upload"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Upload Image
        </button>
      </div>

      {/* Panels */}
      {mode === "camera" && (
        <CameraPanel onScan={onScan} onError={onError} onClose={onClose} />
      )}
      {mode === "upload" && (
        <UploadPanel onScan={onScan} onError={onError} onClose={onClose} />
      )}
    </div>
  );
}

/* ════════════════════════════════════════
   CAMERA PANEL
════════════════════════════════════════ */
function CameraPanel({
  onScan, onError, onClose,
}: { onScan: QRScannerProps["onScan"]; onError?: QRScannerProps["onError"]; onClose?: QRScannerProps["onClose"] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<CamStatus>("starting");
  const [errorMsg, setErrorMsg] = useState("");
  const [scannedData, setScannedData] = useState("");

  const stopStream = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const scanFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !mountedRef.current) return;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    try {
      const jsQR = (await import("jsqr")).default;
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });
      if (code?.data && mountedRef.current) {
        setStatus("success");
        setScannedData(code.data);
        stopStream();
        onScan(parseQRText(code.data));
        return;
      }
    } catch { /* no QR yet */ }
    rafRef.current = requestAnimationFrame(scanFrame);
  }, [onScan, stopStream]);

  const startCamera = useCallback(async () => {
    if (!mountedRef.current) return;
    setStatus("starting");
    setErrorMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        await videoRef.current.play();
        if (mountedRef.current) { setStatus("scanning"); rafRef.current = requestAnimationFrame(scanFrame); }
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      // Retry without facing-mode constraint
      if (err.name === "OverconstrainedError") {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.setAttribute("playsinline", "true");
            await videoRef.current.play();
            if (mountedRef.current) { setStatus("scanning"); rafRef.current = requestAnimationFrame(scanFrame); }
          }
          return;
        } catch { /* fall through */ }
      }
      let msg = "Camera error: " + (err.message || err.name || "Unknown");
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
        msg = "Camera permission denied. Please allow camera access and try again.";
      else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError")
        msg = "No camera found on this device. Try the Upload option instead.";
      else if (err.name === "NotReadableError")
        msg = "Camera is already in use by another application.";
      setStatus("error"); setErrorMsg(msg);
      if (onError) onError(msg);
    }
  }, [scanFrame, onError]);

  useEffect(() => {
    mountedRef.current = true;
    startCamera();
    return () => { mountedRef.current = false; stopStream(); };
  }, []);

  const retry = () => { setScannedData(""); startCamera(); };

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Viewfinder */}
      <div
        className="relative w-full max-w-sm mx-auto rounded-2xl overflow-hidden bg-gray-900 shadow-xl"
        style={{ aspectRatio: "1/1" }}
      >
        <video
          ref={videoRef} playsInline muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ display: status === "scanning" ? "block" : "none" }}
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Starting */}
        {status === "starting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="w-14 h-14 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
            <p className="text-white text-sm font-medium">Starting camera…</p>
            <p className="text-gray-400 text-xs">Allow camera access when prompted</p>
          </div>
        )}

        {/* Success */}
        {status === "success" && (
          <div className="absolute inset-0 bg-green-900/90 flex flex-col items-center justify-center gap-3 p-4">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
              <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-white font-bold text-lg">QR Scanned!</p>
            <p className="text-green-300 text-xs font-mono break-all text-center max-w-[220px]">{scannedData}</p>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="absolute inset-0 bg-gray-900 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="w-14 h-14 bg-red-500/20 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <p className="text-red-300 text-sm leading-snug">{errorMsg}</p>
            <div className="flex gap-2 flex-wrap justify-center">
              <button onClick={retry}
                className="px-4 py-2 bg-[#2563EB] text-white text-sm rounded-xl hover:bg-blue-700 transition-colors font-medium">
                Retry Camera
              </button>
              {onClose && (
                <button onClick={onClose}
                  className="px-4 py-2 bg-gray-700 text-white text-sm rounded-xl hover:bg-gray-600 transition-colors font-medium">
                  Manual Entry
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scanning overlay */}
        {status === "scanning" && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="relative w-56 h-56">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#2563EB] rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-[#2563EB] rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-[#2563EB] rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#2563EB] rounded-br-lg" />
              <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-[#3B82F6] to-transparent rounded-full cam-scan-line" />
            </div>
          </div>
        )}
      </div>

      {status === "scanning" && (
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <p className="text-sm text-gray-600 font-medium">Camera active — align QR code in frame</p>
        </div>
      )}

      {(status === "scanning" || status === "starting") && onClose && (
        <button onClick={() => { stopStream(); onClose(); }}
          className="text-sm text-[#2563EB] font-medium hover:underline">
          ← Use Manual Entry instead
        </button>
      )}

      <style>{`
        @keyframes cam-scan {
          0%   { top: 8px; opacity:.8 }
          50%  { top: calc(100% - 8px); opacity:1 }
          100% { top: 8px; opacity:.8 }
        }
        .cam-scan-line { animation: cam-scan 2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

/* ════════════════════════════════════════
   UPLOAD PANEL
════════════════════════════════════════ */
function UploadPanel({
  onScan, onError, onClose,
}: { onScan: QRScannerProps["onScan"]; onError?: QRScannerProps["onError"]; onClose?: QRScannerProps["onClose"] }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [preview, setPreview] = useState<string>("");
  const [scannedData, setScannedData] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setErrorMsg("Please upload an image file (PNG, JPG, GIF, WebP).");
      setUploadStatus("error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg("File is too large. Please upload an image under 10 MB.");
      setUploadStatus("error");
      return;
    }

    setUploadStatus("processing");
    setErrorMsg("");

    // Create an object URL for preview
    const url = URL.createObjectURL(file);
    setPreview(url);

    try {
      // Load image into an HTMLImageElement
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = url;
      });

      // Draw onto canvas
      const canvas = canvasRef.current!;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Try multiple inversion strategies to maximise detection rate
      const jsQR = (await import("jsqr")).default;
      let code =
        jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" }) ||
        jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "onlyInvert" }) ||
        jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });

      // If still not found try a downscaled version (sometimes helps with very large images)
      if (!code && (img.naturalWidth > 1000 || img.naturalHeight > 1000)) {
        const scale = 600 / Math.max(img.naturalWidth, img.naturalHeight);
        const w2 = Math.round(img.naturalWidth * scale);
        const h2 = Math.round(img.naturalHeight * scale);
        canvas.width = w2; canvas.height = h2;
        ctx.drawImage(img, 0, 0, w2, h2);
        const id2 = ctx.getImageData(0, 0, w2, h2);
        code =
          jsQR(id2.data, w2, h2, { inversionAttempts: "dontInvert" }) ||
          jsQR(id2.data, w2, h2, { inversionAttempts: "onlyInvert" });
      }

      URL.revokeObjectURL(url);

      if (code?.data) {
        setScannedData(code.data);
        setUploadStatus("success");
        onScan(parseQRText(code.data));
      } else {
        setUploadStatus("error");
        setErrorMsg("No QR code detected in the image. Make sure the QR code is clearly visible and try again.");
        if (onError) onError("No QR code detected");
      }
    } catch (err: any) {
      URL.revokeObjectURL(url);
      setUploadStatus("error");
      setErrorMsg("Failed to process image: " + (err.message || "Unknown error"));
      if (onError) onError(err.message);
    }
  }, [onScan, onError]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const reset = () => {
    setUploadStatus("idle");
    setPreview("");
    setScannedData("");
    setErrorMsg("");
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Hidden canvas for image processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Drop Zone */}
      {uploadStatus === "idle" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center gap-4 p-8 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${
            isDragging
              ? "border-[#2563EB] bg-[#DBEAFE] scale-[1.01]"
              : "border-gray-300 bg-[#F8FAFC] hover:border-[#2563EB] hover:bg-[#EFF6FF]"
          }`}
          style={{ minHeight: "260px" }}
        >
          {/* Upload icon */}
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center transition-all ${
            isDragging ? "bg-[#2563EB]" : "bg-white border-2 border-gray-200 shadow-sm"
          }`}>
            <svg className={`w-10 h-10 transition-colors ${isDragging ? "text-white" : "text-[#2563EB]"}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>

          <div className="text-center">
            <p className={`text-base font-semibold transition-colors ${isDragging ? "text-[#2563EB]" : "text-[#1E293B]"}`}>
              {isDragging ? "Drop your QR image here" : "Upload a QR Code Image"}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Drag & drop or <span className="text-[#2563EB] font-medium">browse files</span>
            </p>
            <p className="text-xs text-gray-400 mt-2">PNG, JPG, WebP, GIF · Max 10 MB</p>
          </div>

          {/* Animated dashed border hint */}
          <div className={`absolute inset-0 rounded-2xl pointer-events-none transition-opacity ${
            isDragging ? "opacity-100" : "opacity-0"
          }`}>
            <div className="absolute inset-2 border-2 border-[#2563EB] rounded-xl border-dashed" />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}

      {/* Processing */}
      {uploadStatus === "processing" && (
        <div className="flex flex-col items-center gap-4 py-10 bg-[#F8FAFC] rounded-2xl border border-gray-200">
          {preview && (
            <div className="relative w-40 h-40 rounded-xl overflow-hidden border border-gray-200 shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="QR preview" className="w-full h-full object-contain bg-white" />
              {/* Scan overlay */}
              <div className="absolute inset-0 bg-[#2563EB]/10 flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
          )}
          <div className="text-center">
            <p className="text-sm font-semibold text-[#1E293B]">Scanning QR code…</p>
            <p className="text-xs text-gray-400 mt-1">Analysing image pixels</p>
          </div>
        </div>
      )}

      {/* Success */}
      {uploadStatus === "success" && (
        <div className="flex flex-col items-center gap-4 py-8 bg-green-50 border border-green-200 rounded-2xl">
          {preview && (
            <div className="relative w-40 h-40 rounded-xl overflow-hidden border-2 border-green-400 shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="QR preview" className="w-full h-full object-contain bg-white" />
              {/* Green success tick overlay */}
              <div className="absolute top-2 right-2 w-7 h-7 bg-green-500 rounded-full flex items-center justify-center shadow">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          )}
          <div className="text-center px-4">
            <p className="text-base font-bold text-green-700">QR Code Detected!</p>
            <div className="mt-2 bg-white border border-green-200 rounded-xl px-4 py-2 max-w-xs mx-auto">
              <p className="text-xs text-gray-500 mb-1">Scanned data</p>
              <p className="text-sm font-mono font-semibold text-[#1E293B] break-all">{scannedData}</p>
            </div>
          </div>
          <button onClick={reset}
            className="text-sm text-[#2563EB] font-medium hover:underline">
            Scan another image
          </button>
        </div>
      )}

      {/* Error */}
      {uploadStatus === "error" && (
        <div className="flex flex-col items-center gap-4 py-8 bg-red-50 border border-red-200 rounded-2xl px-4">
          {preview && (
            <div className="w-32 h-32 rounded-xl overflow-hidden border-2 border-red-300 shadow-md opacity-80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="QR preview" className="w-full h-full object-contain bg-white" />
            </div>
          )}
          <div className="text-center">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-2">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-red-700">Detection Failed</p>
            <p className="text-xs text-red-500 mt-1 max-w-xs">{errorMsg}</p>
          </div>

          {/* Tips */}
          <div className="bg-white border border-red-100 rounded-xl px-4 py-3 text-xs text-gray-600 text-left max-w-xs w-full">
            <p className="font-semibold text-gray-700 mb-2">💡 Tips for better results:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Ensure the QR code is fully visible and not cropped</li>
              <li>Use a well-lit, high-contrast image</li>
              <li>Avoid blurry or heavily compressed images</li>
              <li>Try a screenshot directly from the bus QR display</li>
            </ul>
          </div>

          <div className="flex gap-2 flex-wrap justify-center">
            <button onClick={reset}
              className="px-4 py-2 bg-[#2563EB] text-white text-sm rounded-xl hover:bg-blue-700 transition-colors font-medium">
              Try Another Image
            </button>
            {onClose && (
              <button onClick={onClose}
                className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-300 transition-colors font-medium">
                Manual Entry
              </button>
            )}
          </div>
        </div>
      )}

      {/* Footer info */}
      {uploadStatus === "idle" && (
        <div className="flex items-start gap-2 bg-[#DBEAFE] rounded-xl px-4 py-3 text-xs text-[#1E40AF]">
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>
            Upload a photo of the bus QR code. You can take a photo with your camera and upload it here.
            The scanner will automatically extract the bus ID and route.
          </p>
        </div>
      )}
    </div>
  );
}
