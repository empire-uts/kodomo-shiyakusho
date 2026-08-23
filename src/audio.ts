let audioContext: AudioContext | null = null;
let activeAnswer: AudioBufferSourceNode | null = null;

function context(): AudioContext {
  audioContext ??= new AudioContext();
  return audioContext;
}

export async function unlockAudio(): Promise<void> {
  const ctx = context();
  if (ctx.state === "suspended") await ctx.resume();

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.02);
}

export function startRadioNoise(): () => void {
  const ctx = context();
  const sampleCount = Math.floor(ctx.sampleRate * 1.5);
  const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < sampleCount; index += 1) {
    data[index] = (Math.random() * 2 - 1) * 0.16;
  }

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.loop = true;
  filter.type = "bandpass";
  filter.frequency.value = 1450;
  filter.Q.value = 0.7;
  gain.gain.value = 0.14;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();

  return () => {
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    source.stop(ctx.currentTime + 0.15);
  };
}

export async function playAudioBlob(blob: Blob): Promise<void> {
  const ctx = context();
  if (ctx.state === "suspended") await ctx.resume();
  activeAnswer?.stop();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  const source = ctx.createBufferSource();
  source.buffer = decoded;
  source.playbackRate.value = 1.06;
  source.connect(ctx.destination);
  source.start();
  activeAnswer = source;
  source.addEventListener("ended", () => {
    if (activeAnswer === source) activeAnswer = null;
  });
}

export async function speakWithJapaneseVoice(text: string): Promise<boolean> {
  if (!("speechSynthesis" in window)) return false;
  let voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const timeout = window.setTimeout(() => resolve(window.speechSynthesis.getVoices()), 800);
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        window.clearTimeout(timeout);
        resolve(window.speechSynthesis.getVoices());
      }, { once: true });
    });
  }
  const japanese = voices.filter((voice) => voice.lang.toLowerCase().startsWith("ja"));
  const preferred = japanese.find((voice) => /female|kyoko|nanami|haruka|siri/i.test(voice.name));
  const voice = preferred ?? japanese[0];
  if (!voice) return false;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.voice = voice;
  utterance.rate = 0.92;
  utterance.pitch = 1.18;
  return new Promise<boolean>((resolve) => {
    utterance.addEventListener("start", () => resolve(true), { once: true });
    utterance.addEventListener("error", () => resolve(false), { once: true });
    window.setTimeout(() => resolve(window.speechSynthesis.speaking), 1_500);
    window.speechSynthesis.speak(utterance);
  });
}
