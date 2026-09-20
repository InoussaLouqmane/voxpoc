// Pont WebSocket Twilio Media Streams <-> Google Gemini Live API (BidiGenerateContent).

const WebSocket = require("ws");
const twilio = require("twilio");
const callStore = require("./callStore");
const { generateSummary } = require("./summary");
const { twilioMuLawToGeminiPCM16, geminiPCM24kToTwilioMuLaw } = require("./audioUtils");

const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";
const GEMINI_VOICE = process.env.GEMINI_VOICE || "Aoede";

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const END_CALL_TOOL = {
  functionDeclarations: [
    {
      name: "end_call",
      description:
        "Termine immédiatement l'appel téléphonique en cours. Tu DOIS appeler cette fonction dès que la conversation est terminée (objectif atteint, ou l'interlocuteur souhaite raccrocher) — juste après ta dernière phrase, sans attendre de réponse ni ajouter quoi que ce soit d'autre.",
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

  return `Tu es un agent vocal IA qui passe un appel téléphonique sortant en français.
Objet de l'appel : ${objet}

Consignes :
- Présente-toi brièvement comme un assistant virtuel qui appelle au nom de l'utilisateur.
- Explique clairement l'objet de l'appel dès le début.
- Sois naturel, concis, poli et à l'écoute de l'interlocuteur.
- Adapte-toi à ses réponses pour atteindre l'objectif de l'appel.
- Termine l'appel proprement une fois l'objectif atteint ou si l'interlocuteur le souhaite, en le remerciant.
- À n'importe quel moment de l'appel, si l'interlocuteur demande à raccrocher ou exprime clairement vouloir arrêter la conversation, obéis immédiatement : une phrase de clôture brève, puis appelle end_call sans délai. Ne termine pas ce que tu étais en train de dire, ne négocie pas. Cette règle prime sur le reste.
- Dès que tu as dit au revoir, tu DOIS appeler la fonction end_call immédiatement, sans attendre de réponse ni ajouter un mot de plus — dire au revoir ne raccroche pas la ligne, seul l'appel de cette fonction le fait réellement.
- Ne mentionne jamais que tu es un modèle de langage ou une IA générative : dis simplement que tu es un assistant virtuel.`;
}

const HANGUP_MARK_NAME = "end_call_marker";
// Filet de sécurité déterministe, indépendant de la fiabilité du tool calling du modèle :
// si plus rien ne se passe (silence des deux côtés) pendant ce délai, on raccroche.
// Le tool calling seul n'est pas fiable à 100% (cf. retours terrain sur les agents vocaux) —
// ce timer couvre le cas où end_call n'est jamais appelée.
const SILENCE_HANGUP_MS = 15000;
const SILENCE_CHECK_INTERVAL_MS = 3000;

function handleTwilioConnection(twilioWs) {
  let streamSid = null;
  let callSid = null;
  let callId = null;
  let geminiWs = null;
  let geminiReady = false;
  let hangupTimeout = null;
  let lastActivityAt = Date.now();
  let silenceInterval = null;
  let hungUp = false;
  let finalized = false;
  // File d'attente des payloads audio (base64 mu-law) reçus avant que la session Gemini soit prête
  const pendingAudio = [];

  function markActivity() {
    lastActivityAt = Date.now();
  }

  function hangUpCall() {
    if (hungUp) return;
    hungUp = true;
    if (hangupTimeout) {
      clearTimeout(hangupTimeout);
      hangupTimeout = null;
    }
    if (silenceInterval) {
      clearInterval(silenceInterval);
      silenceInterval = null;
    }
    if (!callSid) return;
    twilioClient
      .calls(callSid)
      .update({ status: "completed" })
      .catch((err) => console.error("[Twilio] échec du raccrochage:", err.message));
  }

  function startSilenceWatch() {
    silenceInterval = setInterval(() => {
      if (Date.now() - lastActivityAt > SILENCE_HANGUP_MS) {
        console.warn("[Silence] aucune activité détectée, raccrochage de sécurité.");
        hangUpCall();
      }
    }, SILENCE_CHECK_INTERVAL_MS);
  }

  // L'audio déjà envoyé à Twilio n'a pas forcément fini d'être *joué* sur la ligne au
  // moment où Gemini appelle end_call. On place un repère (mark) juste après le dernier
  // chunk audio et on attend son écho de Twilio (= lecture terminée) avant de raccrocher
  // réellement, pour ne pas couper l'agent en pleine phrase.
  function requestHangup() {
    if (streamSid) {
      twilioWs.send(JSON.stringify({ event: "mark", streamSid, mark: { name: HANGUP_MARK_NAME } }));
      // Filet de sécurité si l'écho du mark n'arrive jamais
      hangupTimeout = setTimeout(hangUpCall, 6000);
    } else {
      hangUpCall();
    }
  }

  function sendAudioToGemini(mulawBase64) {
    const pcm16Base64 = twilioMuLawToGeminiPCM16(mulawBase64);
    geminiWs.send(
      JSON.stringify({
        realtimeInput: {
          audio: { data: pcm16Base64, mimeType: "audio/pcm;rate=16000" },
        },
      })
    );
  }

  function connectToGemini(objet) {
    geminiWs = new WebSocket(geminiWsUrl());

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
            systemInstruction: { parts: [{ text: buildInstructions(objet) }] },
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
        for (const payload of pendingAudio) {
          sendAudioToGemini(payload);
        }
        pendingAudio.length = 0;
        // L'agent démarre la conversation (appel sortant) : on injecte un tour
        // synthétique pour déclencher une première réponse audio sans attendre l'interlocuteur.
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
        console.error("[Gemini Live] erreur:", JSON.stringify(event.error));
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
          requestHangup();
        }
        return;
      }

      const serverContent = event.serverContent;
      if (!serverContent) return;

      markActivity();

      if (serverContent.interrupted && streamSid) {
        // Barge-in : l'interlocuteur parle, on coupe l'audio en cours côté Twilio
        twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
      }

      const parts = serverContent.modelTurn?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data && streamSid) {
          const mulawBase64 = geminiPCM24kToTwilioMuLaw(part.inlineData.data);
          twilioWs.send(
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: mulawBase64 },
            })
          );
        }
      }

      if (serverContent.inputTranscription?.text && callId) {
        callStore.appendTranscript(callId, "user", serverContent.inputTranscription.text);
      }
      if (serverContent.outputTranscription?.text && callId) {
        callStore.appendTranscript(callId, "assistant", serverContent.outputTranscription.text);
      }
    });

    geminiWs.on("error", (err) => {
      console.error("[Gemini Live] erreur WebSocket:", err.message);
    });

    geminiWs.on("close", () => {
      geminiReady = false;
    });
  }

  twilioWs.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      return;
    }

    switch (msg.event) {
      case "start": {
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid;
        const params = msg.start.customParameters || {};
        callId = params.callId;
        const objet = params.objet || "objet non précisé";
        markActivity();
        startSilenceWatch();
        connectToGemini(objet);
        break;
      }

      case "media": {
        const payload = msg.media.payload;
        if (!geminiWs || !geminiReady) {
          pendingAudio.push(payload);
        } else if (geminiWs.readyState === WebSocket.OPEN) {
          sendAudioToGemini(payload);
        }
        break;
      }

      case "mark": {
        if (msg.mark?.name === HANGUP_MARK_NAME) {
          // Twilio a fini de jouer tout l'audio envoyé avant le repère : on peut
          // raccrocher réellement sans couper l'agent en pleine phrase.
          hangUpCall();
        }
        break;
      }

      case "stop": {
        await finalizeCall();
        break;
      }

      default:
        break;
    }
  });

  twilioWs.on("close", () => {
    // Filet de rattrapage : Twilio n'envoie pas toujours un event "stop" propre
    // (ex: appel jamais vraiment "answered" côté opérateur, raccroché via l'API
    // pendant un état ambigu) — sans ça, l'appel resterait bloqué en "en_cours"
    // indéfiniment côté callStore. On finalise donc aussi sur la simple fermeture
    // de la connexion, si ce n'est pas déjà fait.
    finalizeCall();
  });

  async function finalizeCall() {
    if (finalized) return;
    finalized = true;

    if (hangupTimeout) {
      clearTimeout(hangupTimeout);
      hangupTimeout = null;
    }
    if (silenceInterval) {
      clearInterval(silenceInterval);
      silenceInterval = null;
    }
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      try {
        geminiWs.close();
      } catch (err) {
        // ignore
      }
    }

    if (!callId) return;
    const call = callStore.getCall(callId);
    if (!call || call.status === "termine") return;

    try {
      const resume = await generateSummary(call.objet || "", call.transcript || []);
      callStore.finishCall(callId, resume);
    } catch (err) {
      console.error("[Résumé] échec de la génération:", err.message);
      callStore.finishCall(callId, "Le résumé n'a pas pu être généré automatiquement.");
    }
  }
}

module.exports = { handleTwilioConnection };
