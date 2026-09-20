// Pont WebSocket Navigateur (micro/haut-parleurs) <-> Google Gemini Live API.
// Alternative à mediaStream.js quand aucun appel téléphonique réel n'est disponible :
// même logique de conversation, mais la source/destination audio est le navigateur
// (PCM16 natif, 16kHz en entrée / 24kHz en sortie) au lieu de Twilio (mu-law 8kHz) —
// donc pas besoin du transcodage de audioUtils.js ici.

const WebSocket = require("ws");
const callStore = require("./callStore");
const { generateSummary } = require("./summary");

const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";
const GEMINI_VOICE = process.env.GEMINI_VOICE || "Aoede";

const END_CALL_TOOL = {
  functionDeclarations: [
    {
      name: "end_call",
      description:
        "Termine immédiatement la conversation en cours. Tu DOIS appeler cette fonction dès que l'échange est terminé (objectif atteint, ou l'interlocuteur souhaite arrêter) — juste après ta dernière phrase, sans attendre de réponse ni ajouter quoi que ce soit d'autre.",
      parameters: { type: "OBJECT", properties: {} },
    },
  ],
};

function geminiWsUrl() {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
}

function buildInstructions(objet) {
  // Si l'objet fourni est déjà un prompt système complet et structuré (cas d'usage
  // avancé), on l'utilise tel quel plutôt que de l'envelopper dans le gabarit générique
  // ci-dessous, pour éviter d'envoyer des consignes contradictoires à Gemini.
  if (objet.trim().length > 400) {
    return objet;
  }

  return `Tu es un agent vocal IA qui simule un appel téléphonique sortant en français, dans le
cadre d'une démonstration (l'utilisateur en face de toi joue le rôle de l'interlocuteur appelé).
Objet de l'appel : ${objet}

Consignes :
- Présente-toi brièvement comme un assistant virtuel qui appelle au nom de l'utilisateur.
- Explique clairement l'objet de l'appel dès le début.
- Sois naturel, concis, poli et à l'écoute de l'interlocuteur.
- Adapte-toi à ses réponses pour atteindre l'objectif de l'appel.
- Termine l'appel proprement une fois l'objectif atteint ou si l'interlocuteur le souhaite, en le remerciant.
- À n'importe quel moment de l'appel, si l'interlocuteur demande à raccrocher ou exprime clairement vouloir arrêter la conversation, obéis immédiatement : une phrase de clôture brève, puis appelle end_call sans délai. Ne termine pas ce que tu étais en train de dire, ne négocie pas. Cette règle prime sur le reste.
- Dès que tu as dit au revoir, tu DOIS appeler la fonction end_call immédiatement, sans attendre de réponse ni ajouter un mot de plus — dire au revoir ne clôture pas la session, seul l'appel de cette fonction le fait réellement.
- Ne mentionne jamais que tu es un modèle de langage ou une IA générative : dis simplement que tu es un assistant virtuel.`;
}

function handleBrowserConnection(browserWs, req) {
  const url = new URL(req.url, "http://localhost");
  const callId = url.searchParams.get("callId");
  const call = callStore.getCall(callId);

  if (!call) {
    browserWs.send(JSON.stringify({ type: "error", message: "Session introuvable." }));
    browserWs.close();
    return;
  }

  let geminiReady = false;
  let ended = false;
  const pendingAudio = [];

  const geminiWs = new WebSocket(geminiWsUrl());

  function sendAudioToGemini(pcm16Base64) {
    geminiWs.send(
      JSON.stringify({
        realtimeInput: {
          audio: { data: pcm16Base64, mimeType: "audio/pcm;rate=16000" },
        },
      })
    );
  }

  geminiWs.on("open", () => {
    geminiWs.send(
      JSON.stringify({
        setup: {
          model: GEMINI_LIVE_MODEL,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              languageCode: "fr-FR",
              voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } },
            },
          },
          systemInstruction: { parts: [{ text: buildInstructions(call.objet) }] },
          tools: [END_CALL_TOOL],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      })
    );
  });

  geminiWs.on("message", (data) => {
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch (err) {
      return;
    }

    if (event.setupComplete) {
      geminiReady = true;
      for (const payload of pendingAudio) sendAudioToGemini(payload);
      pendingAudio.length = 0;

      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(JSON.stringify({ type: "ready" }));
      }

      // L'agent démarre la conversation, comme pour un appel sortant réel.
      geminiWs.send(
        JSON.stringify({
          clientContent: {
            turns: [
              {
                role: "user",
                parts: [
                  {
                    text: "[Début de l'appel — présente-toi et explique l'objet de l'appel dès maintenant.]",
                  },
                ],
              },
            ],
            turnComplete: true,
          },
        })
      );
      return;
    }

    if (event.error) {
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(JSON.stringify({ type: "error", message: JSON.stringify(event.error) }));
      }
      return;
    }

    if (event.toolCall) {
      const calls = event.toolCall.functionCalls || [];
      const responses = calls.map((call) => ({
        id: call.id,
        name: call.name,
        response: { result: "ok" },
      }));
      if (responses.length > 0) {
        geminiWs.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
      }

      if (calls.some((call) => call.name === "end_call")) {
        endSession();
      }
      return;
    }

    const serverContent = event.serverContent;
    if (!serverContent) return;

    if (serverContent.interrupted && browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: "clear" }));
    }

    const parts = serverContent.modelTurn?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data && browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(JSON.stringify({ type: "audio", data: part.inlineData.data }));
      }
    }

    if (serverContent.inputTranscription?.text) {
      callStore.appendTranscript(callId, "user", serverContent.inputTranscription.text);
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(
          JSON.stringify({ type: "transcript", role: "user", text: serverContent.inputTranscription.text })
        );
      }
    }
    if (serverContent.outputTranscription?.text) {
      callStore.appendTranscript(callId, "assistant", serverContent.outputTranscription.text);
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(
          JSON.stringify({ type: "transcript", role: "assistant", text: serverContent.outputTranscription.text })
        );
      }
    }
  });

  geminiWs.on("error", (err) => {
    console.error("[Gemini Live] erreur WebSocket (démo navigateur):", err.message);
  });

  geminiWs.on("close", () => {
    geminiReady = false;
  });

  async function endSession() {
    if (ended) return;
    ended = true;

    if (geminiWs.readyState === WebSocket.OPEN) {
      try {
        geminiWs.close();
      } catch (err) {
        // ignore
      }
    }

    const freshCall = callStore.getCall(callId);
    if (freshCall && freshCall.status !== "termine") {
      try {
        const resume = await generateSummary(freshCall.objet, freshCall.transcript);
        callStore.finishCall(callId, resume);
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(JSON.stringify({ type: "ended", resume }));
        }
      } catch (err) {
        console.error("[Résumé] échec de la génération:", err.message);
        callStore.finishCall(callId, "Le résumé n'a pas pu être généré automatiquement.");
      }
    }

    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.close();
    }
  }

  browserWs.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      return;
    }

    switch (msg.type) {
      case "audio": {
        if (!geminiReady) {
          pendingAudio.push(msg.data);
        } else if (geminiWs.readyState === WebSocket.OPEN) {
          sendAudioToGemini(msg.data);
        }
        break;
      }
      case "stop": {
        endSession();
        break;
      }
      default:
        break;
    }
  });

  browserWs.on("close", () => {
    endSession();
  });
}

module.exports = { handleBrowserConnection };
