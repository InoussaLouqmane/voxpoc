import { useEffect, useRef, useState } from "react";
import { MicCapture, AudioPlayer } from "../audioClient";
import { useLanguage } from "../i18n";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

export default function Home() {
  const { t } = useLanguage();
  const [mode, setMode] = useState("telephone"); // "telephone" | "navigateur"

  return (
    <div className="page">
      <section className="hero">
        <h1>{t("hero.title")}</h1>
        <p className="heroSubtitle">{t("hero.subtitle")}</p>
        <p className="heroLead">{t("hero.lead")}</p>
      </section>

      <div className="card">
        <div className="tabs">
          <button
            className={mode === "telephone" ? "tab tabActive" : "tab"}
            onClick={() => setMode("telephone")}
          >
            {t("tabs.phone")}
          </button>
          <button
            className={mode === "navigateur" ? "tab tabActive" : "tab"}
            onClick={() => setMode("navigateur")}
          >
            {t("tabs.browser")}
          </button>
        </div>

        {mode === "telephone" ? <PhoneCallPanel /> : <BrowserDemoPanel />}
      </div>
    </div>
  );
}

// --- Mode 1 : vrai appel téléphonique via Twilio ---
// "idle" | "loading" | "en_cours" | "termine" | "erreur"
function PhoneCallPanel() {
  const { t } = useLanguage();
  const [numero, setNumero] = useState("");
  const [objet, setObjet] = useState("");
  const [phase, setPhase] = useState("idle");
  const [callId, setCallId] = useState(null);
  const [resume, setResume] = useState(null);
  const [erreur, setErreur] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setErreur(null);
    setResume(null);
    setPhase("loading");

    if (!BACKEND_URL) {
      setErreur(t("phone.missingBackendUrl"));
      setPhase("erreur");
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero, objet }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || t("phone.genericCallError"));
      }

      setCallId(data.callId);
      setPhase("en_cours");
      startPolling(data.callId);
    } catch (err) {
      setErreur(err.message);
      setPhase("erreur");
    }
  }

  function startPolling(id) {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/call/${id}/status`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || t("phone.statusError"));
        }

        if (data.status === "termine") {
          clearInterval(pollRef.current);
          setResume(data.resume);
          setPhase("termine");
        }
      } catch (err) {
        clearInterval(pollRef.current);
        setErreur(err.message);
        setPhase("erreur");
      }
    }, 3000);
  }

  function handleReset() {
    setNumero("");
    setObjet("");
    setPhase("idle");
    setCallId(null);
    setResume(null);
    setErreur(null);
  }

  return (
    <>
      {(phase === "idle" || phase === "loading" || phase === "erreur") && (
        <form onSubmit={handleSubmit} className="form">
          <label>
            {t("phone.numberLabel")}
            <input
              type="tel"
              placeholder={t("phone.numberPlaceholder")}
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              required
              disabled={phase === "loading"}
            />
          </label>

          <label>
            {t("phone.objetLabel")}
            <textarea
              placeholder={t("phone.objetPlaceholder")}
              value={objet}
              onChange={(e) => setObjet(e.target.value)}
              rows={4}
              required
              disabled={phase === "loading"}
            />
          </label>

          <button type="submit" disabled={phase === "loading"}>
            {phase === "loading" ? t("phone.submitting") : t("phone.submit")}
          </button>

          {erreur && <p className="error">{erreur}</p>}
        </form>
      )}

      {phase === "en_cours" && (
        <div className="status">
          <div className="spinner" aria-label={t("phone.inProgress")} />
          <p>{t("phone.inProgress")}</p>
          <p className="callId">
            {t("phone.callIdLabel")} {callId}
          </p>
        </div>
      )}

      {phase === "termine" && (
        <div className="summary">
          <h2>{t("phone.summaryTitle")}</h2>
          <pre className="summaryText">{resume}</pre>
          <button onClick={handleReset}>{t("phone.reset")}</button>
        </div>
      )}
    </>
  );
}

// --- Mode 2 : démo navigateur (micro/haut-parleurs, sans téléphone) ---
// "idle" | "connexion" | "actif" | "termine" | "erreur"
function BrowserDemoPanel() {
  const { t } = useLanguage();
  const [objet, setObjet] = useState("");
  const [phase, setPhase] = useState("idle");
  const [transcript, setTranscript] = useState([]);
  const [resume, setResume] = useState(null);
  const [erreur, setErreur] = useState(null);

  const wsRef = useRef(null);
  const micRef = useRef(null);
  const playerRef = useRef(null);

  useEffect(() => {
    return () => cleanup();
  }, []);

  function cleanup() {
    if (micRef.current) {
      micRef.current.stop();
      micRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.close();
      playerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }

  async function handleStart(e) {
    e.preventDefault();
    setErreur(null);
    setResume(null);
    setTranscript([]);
    setPhase("connexion");

    if (!BACKEND_URL) {
      setErreur(t("browser.missingBackendUrl"));
      setPhase("erreur");
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/browser-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objet }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || t("browser.sessionError"));
      }

      const wsUrl = `${BACKEND_URL.replace(/^http/, "ws")}/browser-stream?callId=${data.callId}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      playerRef.current = new AudioPlayer();

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "ready": {
            micRef.current = new MicCapture((base64Chunk) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "audio", data: base64Chunk }));
              }
            });
            await micRef.current.start();
            setPhase("actif");
            break;
          }
          case "audio":
            playerRef.current?.enqueue(msg.data);
            break;
          case "clear":
            playerRef.current?.clear();
            break;
          case "transcript":
            setTranscript((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === msg.role) {
                const updated = [...prev];
                updated[updated.length - 1] = { role: last.role, text: last.text + msg.text };
                return updated;
              }
              return [...prev, { role: msg.role, text: msg.text }];
            });
            break;
          case "ended":
            setResume(msg.resume);
            setPhase("termine");
            if (micRef.current) {
              micRef.current.stop();
              micRef.current = null;
            }
            break;
          case "error":
            setErreur(msg.message);
            setPhase("erreur");
            cleanup();
            break;
          default:
            break;
        }
      };

      ws.onerror = () => {
        setErreur(t("browser.wsError"));
        setPhase("erreur");
      };
    } catch (err) {
      setErreur(err.message);
      setPhase("erreur");
    }
  }

  function handleStop() {
    if (micRef.current) {
      micRef.current.stop();
      micRef.current = null;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
    }
  }

  function handleReset() {
    cleanup();
    setObjet("");
    setPhase("idle");
    setTranscript([]);
    setResume(null);
    setErreur(null);
  }

  return (
    <>
      <p className="hint">{t("browser.hint")}</p>

      {(phase === "idle" || phase === "erreur") && (
        <form onSubmit={handleStart} className="form">
          <label>
            {t("browser.objetLabel")}
            <textarea
              placeholder={t("browser.objetPlaceholder")}
              value={objet}
              onChange={(e) => setObjet(e.target.value)}
              rows={4}
              required
            />
          </label>

          <button type="submit">{t("browser.submit")}</button>

          {erreur && <p className="error">{erreur}</p>}
        </form>
      )}

      {phase === "connexion" && (
        <div className="status">
          <div className="spinner" aria-label={t("browser.connecting")} />
          <p>{t("browser.connecting")}</p>
        </div>
      )}

      {phase === "actif" && (
        <div className="status">
          <div className="spinner" aria-label={t("browser.active")} />
          <p>{t("browser.active")}</p>
          <TranscriptView transcript={transcript} />
          <button onClick={handleStop}>{t("browser.stop")}</button>
        </div>
      )}

      {phase === "termine" && (
        <div className="summary">
          <h2>{t("browser.summaryTitle")}</h2>
          <TranscriptView transcript={transcript} />
          <pre className="summaryText">{resume}</pre>
          <button onClick={handleReset}>{t("browser.reset")}</button>
        </div>
      )}
    </>
  );
}

function TranscriptView({ transcript }) {
  const { t } = useLanguage();
  if (transcript.length === 0) return null;
  return (
    <div className="transcript">
      {transcript.map((turn, i) => (
        <p key={i} className={turn.role === "assistant" ? "turnAgent" : "turnUser"}>
          <strong>{turn.role === "assistant" ? t("browser.agentLabel") : t("browser.youLabel")} :</strong>{" "}
          {turn.text}
        </p>
      ))}
    </div>
  );
}
