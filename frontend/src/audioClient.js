// Capture micro (PCM16 16kHz) et lecture audio agent (PCM16 24kHz) pour la démo navigateur.
// Le backend attend/renvoie du PCM16 brut en base64 (mêmes taux que la Gemini Live API),
// donc aucune conversion mu-law n'est nécessaire ici (contrairement au pont Twilio).

function base64ToInt16Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function float32ToBase64PCM16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export class MicCapture {
  constructor(onChunk) {
    this.onChunk = onChunk;
    this.context = null;
    this.processor = null;
    this.source = null;
    this.silentGain = null;
    this.stream = null;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.context = new AudioContext({ sampleRate: 16000 });
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      this.onChunk(float32ToBase64PCM16(input));
    };

    // Le ScriptProcessorNode ne "tourne" que s'il est connecté à une destination ;
    // on route vers un gain à 0 pour éviter le retour du micro dans les haut-parleurs.
    this.silentGain = this.context.createGain();
    this.silentGain.gain.value = 0;

    this.source.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.context.destination);
  }

  stop() {
    if (this.processor) this.processor.disconnect();
    if (this.source) this.source.disconnect();
    if (this.silentGain) this.silentGain.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.context) this.context.close();
  }
}

export class AudioPlayer {
  constructor() {
    this.context = new AudioContext({ sampleRate: 24000 });
    this.nextStartTime = 0;
  }

  enqueue(base64Pcm) {
    const int16 = base64ToInt16Array(base64Pcm);
    if (int16.length === 0) return;

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;

    const buffer = this.context.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    const now = this.context.currentTime;
    const startAt = Math.max(now, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
  }

  clear() {
    this.nextStartTime = this.context.currentTime;
  }

  close() {
    this.context.close();
  }
}
