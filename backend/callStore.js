// Stockage en mémoire de l'état des appels (Map). Pas de DB pour ce POC.
// Perdu au redémarrage du serveur — c'est attendu pour un POC.

const calls = new Map();

function createCall(callId, objet) {
  const record = {
    callId,
    objet,
    status: "en_cours", // "en_cours" | "termine"
    resume: null,
    transcript: [], // [{ role: "user" | "assistant", text: string }]
    createdAt: Date.now(),
  };
  calls.set(callId, record);
  return record;
}

function getCall(callId) {
  return calls.get(callId);
}

function appendTranscript(callId, role, text) {
  const call = calls.get(callId);
  if (!call || !text) return;
  call.transcript.push({ role, text });
}

function finishCall(callId, resume) {
  const call = calls.get(callId);
  if (!call) return;
  call.status = "termine";
  call.resume = resume;
}

module.exports = {
  createCall,
  getCall,
  appendTranscript,
  finishCall,
};
