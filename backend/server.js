require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const twilio = require("twilio");

const callStore = require("./callStore");
const { handleTwilioConnection } = require("./mediaStream");
const { handleBrowserConnection } = require("./browserStream");

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL;
const PUBLIC_BACKEND_URL = process.env.PUBLIC_BACKEND_URL;

const requiredEnv = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "GEMINI_API_KEY",
  "PUBLIC_BACKEND_URL",
];
const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.warn(`[Config] Variables d'environnement manquantes : ${missing.join(", ")}`);
}

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const app = express();

app.use(
  cors({
    origin: FRONTEND_URL || false,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// --- POST /api/call ---
app.post("/api/call", async (req, res) => {
  const { numero, objet } = req.body || {};

  if (!numero || !objet) {
    return res.status(400).json({ error: "Les champs 'numero' et 'objet' sont requis." });
  }
  if (!E164_REGEX.test(numero)) {
    return res.status(400).json({
      error: "Le numéro doit être au format E.164 (ex: +33612345678).",
    });
  }
  if (!PUBLIC_BACKEND_URL) {
    return res.status(500).json({ error: "PUBLIC_BACKEND_URL n'est pas configurée côté serveur." });
  }

  const callId = crypto.randomUUID();
  callStore.createCall(callId, objet);

  try {
    const twilioCall = await twilioClient.calls.create({
      to: numero,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${PUBLIC_BACKEND_URL}/twiml/${callId}`,
    });

    res.json({ callId, status: "en_cours", twilioSid: twilioCall.sid });
  } catch (err) {
    console.error("[Twilio] échec de la création de l'appel:", err.message);
    res.status(502).json({ error: `Échec du déclenchement de l'appel Twilio : ${err.message}` });
  }
});

// --- POST /twiml/:callId ---
app.post("/twiml/:callId", (req, res) => {
  const { callId } = req.params;
  const call = callStore.getCall(callId);
  const objet = call ? call.objet : "objet non précisé";

  const wsUrl = `${PUBLIC_BACKEND_URL.replace(/^http/, "ws")}/media-stream`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wsUrl)}">
      <Parameter name="callId" value="${escapeXml(callId)}" />
      <Parameter name="objet" value="${escapeXml(objet)}" />
    </Stream>
  </Connect>
</Response>`;

  res.type("text/xml").send(twiml);
});

// --- GET /api/call/:callId/status ---
app.get("/api/call/:callId/status", (req, res) => {
  const call = callStore.getCall(req.params.callId);
  if (!call) {
    return res.status(404).json({ error: "Appel introuvable." });
  }
  res.json({
    status: call.status,
    ...(call.status === "termine" ? { resume: call.resume } : {}),
  });
});

// --- POST /api/browser-session ---
// Crée une session pour la démo navigateur (sans appel téléphonique réel) : le micro/
// haut-parleurs du navigateur remplacent Twilio comme source/destination audio.
app.post("/api/browser-session", (req, res) => {
  const { objet } = req.body || {};

  if (!objet) {
    return res.status(400).json({ error: "Le champ 'objet' est requis." });
  }

  const callId = crypto.randomUUID();
  callStore.createCall(callId, objet);

  res.json({ callId });
});

app.get("/health", (req, res) => res.json({ ok: true }));

const server = http.createServer(app);

// Deux WebSocketServer distincts (Twilio Media Streams / démo navigateur) partagent le
// même serveur HTTP. `ws` ne route correctement qu'un seul {server, path} à la fois : on
// utilise donc `noServer: true` + un routage manuel sur l'event "upgrade" pour les deux.
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (ws) => {
  handleTwilioConnection(ws);
});

const browserWss = new WebSocketServer({ noServer: true });
browserWss.on("connection", (ws, req) => {
  handleBrowserConnection(ws, req);
});

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");

  if (pathname === "/media-stream") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else if (pathname === "/browser-stream") {
    browserWss.handleUpgrade(req, socket, head, (ws) => {
      browserWss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`VoxPOC backend démarré sur le port ${PORT}`);
  console.log(`Webhook TwiML attendu sur : ${PUBLIC_BACKEND_URL || "(PUBLIC_BACKEND_URL non définie)"}/twiml/:callId`);
});
