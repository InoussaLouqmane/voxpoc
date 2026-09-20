// Conversion audio entre le format Twilio (G.711 mu-law, 8kHz) et le format
// attendu par la Gemini Live API (PCM16 linéaire, 16kHz en entrée / 24kHz en sortie).
// Gemini Live n'accepte pas le mu-law directement : un transcodage est nécessaire.

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

const MULAW_EXP_LUT = [
  0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
];

function linearToMuLawSample(sampleIn) {
  let sample = sampleIn;
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample += MULAW_BIAS;
  const exponent = MULAW_EXP_LUT[(sample >> 7) & 0xff];
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function muLawToLinearSample(muByteIn) {
  const muByte = ~muByteIn & 0xff;
  const sign = muByte & 0x80;
  const exponent = (muByte >> 4) & 0x07;
  const mantissa = muByte & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign !== 0 ? -sample : sample;
}

function upsample2x(int16Samples) {
  const out = new Int16Array(int16Samples.length * 2);
  for (let i = 0; i < int16Samples.length; i++) {
    const cur = int16Samples[i];
    const next = i + 1 < int16Samples.length ? int16Samples[i + 1] : cur;
    out[2 * i] = cur;
    out[2 * i + 1] = (cur + next) >> 1;
  }
  return out;
}

function downsample3x(int16Samples) {
  const outLen = Math.floor(int16Samples.length / 3);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const a = int16Samples[3 * i];
    const b = int16Samples[3 * i + 1];
    const c = int16Samples[3 * i + 2];
    out[i] = (a + b + c) / 3 | 0;
  }
  return out;
}

// Base64 mu-law 8kHz (Twilio) -> Base64 PCM16 LE 16kHz (Gemini realtimeInput)
function twilioMuLawToGeminiPCM16(base64Mulaw) {
  const muBuf = Buffer.from(base64Mulaw, "base64");
  const linear8k = new Int16Array(muBuf.length);
  for (let i = 0; i < muBuf.length; i++) {
    linear8k[i] = muLawToLinearSample(muBuf[i]);
  }
  const linear16k = upsample2x(linear8k);
  const outBuf = Buffer.alloc(linear16k.length * 2);
  for (let i = 0; i < linear16k.length; i++) {
    outBuf.writeInt16LE(linear16k[i], i * 2);
  }
  return outBuf.toString("base64");
}

// Base64 PCM16 LE 24kHz (Gemini modelTurn audio) -> Base64 mu-law 8kHz (Twilio media)
function geminiPCM24kToTwilioMuLaw(base64Pcm24k) {
  const pcmBuf = Buffer.from(base64Pcm24k, "base64");
  const sampleCount = Math.floor(pcmBuf.length / 2);
  const linear24k = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    linear24k[i] = pcmBuf.readInt16LE(i * 2);
  }
  const linear8k = downsample3x(linear24k);
  const muBuf = Buffer.alloc(linear8k.length);
  for (let i = 0; i < linear8k.length; i++) {
    muBuf[i] = linearToMuLawSample(linear8k[i]);
  }
  return muBuf.toString("base64");
}

module.exports = { twilioMuLawToGeminiPCM16, geminiPCM24kToTwilioMuLaw };
