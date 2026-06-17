import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "";
const STREAMLIT_URL =
  import.meta.env.VITE_STREAMLIT_URL || "https://glass-reflection.streamlit.app";
const GLASS_API_URL = import.meta.env.VITE_GLASS_API_URL || "";
const DETAIL_SECONDS = Number(import.meta.env.VITE_DETAIL_SECONDS || "10");

const QUALITY_OPTIONS = {
  light: {
    label: "Liviano",
    detail: "480p, 12 fps",
    width: 854,
    height: 480,
    frameRate: 12,
    videoBitsPerSecond: 650_000,
  },
  balanced: {
    label: "Balanceado",
    detail: "640 x 480, 15 fps",
    width: 640,
    height: 480,
    frameRate: 15,
    videoBitsPerSecond: 900_000,
  },
  best: {
    label: "Mejor calidad",
    detail: "720p, 24 fps",
    width: 1280,
    height: 720,
    frameRate: 24,
    videoBitsPerSecond: 1_700_000,
  },
};

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const WARN_UPLOAD_BYTES = 50 * 1024 * 1024;

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
}

function formatDuration(seconds) {
  const safe = Math.max(0, seconds || 0);
  const whole = Math.floor(safe);
  const hours = String(Math.floor(whole / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
  const secs = String(whole % 60).padStart(2, "0");
  return `${hours}:${minutes}:${secs}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function createSessionId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function buildConstraints(qualityKey, facingMode) {
  const quality = QUALITY_OPTIONS[qualityKey];
  return {
    audio: false,
    video: {
      width: { ideal: quality.width },
      height: { ideal: quality.height },
      frameRate: { ideal: quality.frameRate, max: quality.frameRate },
      facingMode: { ideal: facingMode },
    },
  };
}

async function uploadToCloudinary(blob, sessionId) {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error("Faltan VITE_CLOUDINARY_CLOUD_NAME o VITE_CLOUDINARY_UPLOAD_PRESET.");
  }

  const form = new FormData();
  form.append("file", blob, `glass-${sessionId}.webm`);
  form.append("upload_preset", UPLOAD_PRESET);
  form.append("folder", `glass/vercel/${sessionId}`);
  form.append("public_id", `glass-${sessionId}`);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`,
    { method: "POST", body: form },
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || "Cloudinary rechazo la subida.");
  }
  return payload;
}

async function requestGlassAnalysis({ sessionId, publicId, videoUrl }) {
  if (!GLASS_API_URL) {
    throw new Error("Falta VITE_GLASS_API_URL.");
  }

  const response = await fetch(`${GLASS_API_URL.replace(/\/$/, "")}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      public_id: publicId,
      video_url: videoUrl,
      detail_seconds: DETAIL_SECONDS,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.detail || payload.error || "Glass API no pudo generar el reflejo.");
  }
  return payload;
}

function App() {
  const videoRef = useRef(null);
  const playbackRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const tickRef = useRef(null);
  const startedAtRef = useRef(null);

  const [status, setStatus] = useState("idle");
  const [quality, setQuality] = useState("balanced");
  const [facingMode, setFacingMode] = useState("environment");
  const [stream, setStream] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState("");

  const currentQuality = QUALITY_OPTIONS[quality];
  const size = blob?.size || 0;
  const uploadBlocked = size > MAX_UPLOAD_BYTES;
  const uploadWarn = size > WARN_UPLOAD_BYTES;

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    return () => {
      stopStream();
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mimeType = useMemo(() => {
    if (typeof MediaRecorder === "undefined") return "";
    return pickMimeType();
  }, []);

  function stopStream() {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
  }

  async function requestCamera() {
    setError("");
    setStatus("permission");
    try {
      stopStream();
      const media = await navigator.mediaDevices.getUserMedia(
        buildConstraints(quality, facingMode),
      );
      setStream(media);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err.message || "No pude abrir la camara.");
    }
  }

  function startRecording() {
    if (!stream) return;
    setError("");
    chunksRef.current = [];
    const options = {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: currentQuality.videoBitsPerSecond,
    };
    const recorder = new MediaRecorder(stream, options);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const recorded = new Blob(chunksRef.current, {
        type: recorder.mimeType || "video/webm",
      });
      const url = URL.createObjectURL(recorded);
      setBlob(recorded);
      setVideoUrl(url);
      setDuration((Date.now() - startedAtRef.current) / 1000);
      setStatus("stopped");
    };
    const now = Date.now();
    startedAtRef.current = now;
    setElapsed(0);
    tickRef.current = window.setInterval(() => {
      setElapsed((Date.now() - now) / 1000);
    }, 250);
    recorder.start(1000);
    setStatus("recording");
  }

  function stopRecording() {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  function generateThumbnail() {
    const video = playbackRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((imageBlob) => {
      if (!imageBlob) return;
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
      setThumbnailUrl(URL.createObjectURL(imageBlob));
    }, "image/jpeg", 0.82);
  }

  async function uploadAndRedirect() {
    if (!blob || uploadBlocked) return;
    setStatus("uploading");
    setError("");
    try {
      const sessionId = createSessionId();
      const result = await uploadToCloudinary(blob, sessionId);
      setUploadResult(result);
      setStatus("uploaded");
      setStatus("analyzing");
      await requestGlassAnalysis({
        sessionId,
        publicId: result.public_id || "",
        videoUrl: result.secure_url || "",
      });
      const params = new URLSearchParams({
        session_id: sessionId,
      });
      setStatus("redirecting");
      window.location.href = `${STREAMLIT_URL}/?${params.toString()}`;
    } catch (err) {
      setStatus("error");
      setError(err.message || "No pude subir el video.");
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="brand">Glass</div>
        <h1>Glass Recorder</h1>
        <p>Graba un bloque real de tiempo desde el navegador y envialo a Glass Reflection.</p>
      </section>

      <section className="panel">
        <div className="status-row">
          <span className={`status-dot ${status}`} />
          <span>{status}</span>
        </div>

        {(status === "idle" || status === "permission" || status === "ready") && (
          <>
            <div className="controls-grid">
              <label>
                Calidad
                <select value={quality} onChange={(event) => setQuality(event.target.value)}>
                  {Object.entries(QUALITY_OPTIONS).map(([key, option]) => (
                    <option key={key} value={key}>
                      {option.label} - {option.detail}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Camara
                <select value={facingMode} onChange={(event) => setFacingMode(event.target.value)}>
                  <option value="user">Frontal</option>
                  <option value="environment">Trasera</option>
                </select>
              </label>
            </div>

            {!stream && (
              <button className="primary" onClick={requestCamera}>
                Pedir permiso de camara
              </button>
            )}
          </>
        )}

        {stream && (status === "ready" || status === "recording") && (
          <div className="preview-wrap">
            <video ref={videoRef} autoPlay playsInline muted className="preview" />
          </div>
        )}

        {status === "ready" && (
          <button className="primary" onClick={startRecording}>
            Iniciar grabacion
          </button>
        )}

        {status === "recording" && (
          <div className="recording-card">
            <div className="rec">REC</div>
            <div className="timer">{formatDuration(elapsed)}</div>
            <button className="danger" onClick={stopRecording}>
              Detener
            </button>
          </div>
        )}

        {status === "stopped" && blob && (
          <div className="review">
            <div className="metrics">
              <div>
                <span>Duracion</span>
                <b>{formatDuration(duration)}</b>
              </div>
              <div>
                <span>Tamano</span>
                <b>{formatBytes(size)}</b>
              </div>
              <div>
                <span>Formato</span>
                <b>{blob.type || "video/webm"}</b>
              </div>
            </div>

            {uploadWarn && !uploadBlocked && (
              <p className="warning">El video supera 50 MB. Puedes subirlo, pero tardara mas.</p>
            )}
            {uploadBlocked && (
              <p className="error">El video supera 100 MB. En V1 la subida queda bloqueada.</p>
            )}

            <video
              ref={playbackRef}
              src={videoUrl}
              controls
              playsInline
              className="playback"
              onLoadedData={generateThumbnail}
            />
            {thumbnailUrl && <img className="thumb" src={thumbnailUrl} alt="Miniatura del video" />}

            <div className="button-row">
              <button className="ghost" onClick={requestCamera}>
                Grabar de nuevo
              </button>
              <button className="primary" onClick={uploadAndRedirect} disabled={uploadBlocked}>
                Subir a Glass
              </button>
            </div>
          </div>
        )}

        {status === "uploading" && <p className="notice">Subiendo a Cloudinary...</p>}
        {status === "uploaded" && uploadResult && <p className="notice">Subido: {uploadResult.public_id}</p>}
        {status === "analyzing" && <p className="notice">Generando reflejo...</p>}
        {status === "redirecting" && <p className="notice">Redirigiendo a Glass Reflection...</p>}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
