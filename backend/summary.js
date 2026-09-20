// Génération du résumé post-appel via un appel classique (generateContent) à l'API Gemini.

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-3.6-flash";
const RETRYABLE_STATUS = new Set([429, 503]);
const MAX_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateSummary(objet, transcript) {
  if (!transcript || transcript.length === 0) {
    return "Aucune conversation n'a pu être transcrite pour cet appel.";
  }

  const conversationText = transcript
    .map((turn) => `${turn.role === "assistant" ? "Agent" : "Interlocuteur"}: ${turn.text}`)
    .join("\n");

  const prompt = `Voici la transcription d'un appel téléphonique sortant mené par un agent vocal IA.

Objet initial de l'appel : "${objet}"

Transcription :
${conversationText}

Génère un résumé structuré en exactement 3 points, en français, au format suivant :
1. Objectif de l'appel : ...
2. Ce qui a été dit / convenu : ...
3. Prochaine action recommandée : ...

Reste concis et factuel.`;

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (res.ok) {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Résumé indisponible.";
    }

    const errText = await res.text();
    lastError = new Error(`Erreur API Gemini (${res.status}): ${errText}`);

    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) {
      throw lastError;
    }

    // Backoff avant nouvelle tentative (surcharge temporaire du modèle, ex: 503)
    await sleep(1500 * attempt);
  }

  throw lastError;
}

module.exports = { generateSummary };
