// Minimal typings for the Web Speech API (not shipped in lib.dom for all TS versions).
export type SpeechRecognitionAlternativeLike = { transcript: string };
export type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};
export type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
};
export type SpeechRecognitionErrorEventLike = { error: string };

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function createRecognizer(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  const Ctor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function isRecognitionSupported(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const prefix = lang.slice(0, 2).toLowerCase();
  const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(prefix));
  // Prefer male / high-quality voices when the platform exposes them.
  const preferred = matching.find((voice) => /yuri|юрий|dmitr|male|google/i.test(voice.name));
  return preferred ?? matching[0] ?? null;
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Speaks streamed text sentence by sentence, so the assistant starts talking
 * before the whole answer has arrived.
 */
export class SpeechQueue {
  private buffer = "";
  private pending = 0;
  private generation = 0;

  constructor(
    private readonly onSpeakingChange: (speaking: boolean) => void,
    private readonly lang = "ru-RU",
  ) {}

  static isSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  push(text: string) {
    this.buffer += text;
    const boundary = /[^.!?…\n]+[.!?…\n]+["»)]?\s*/g;
    let match: RegExpExecArray | null;
    let consumed = 0;
    while ((match = boundary.exec(this.buffer)) !== null) {
      this.speak(match[0]);
      consumed = boundary.lastIndex;
    }
    this.buffer = this.buffer.slice(consumed);
  }

  flush() {
    const rest = this.buffer;
    this.buffer = "";
    this.speak(rest);
  }

  cancel() {
    this.buffer = "";
    this.generation += 1;
    if (this.pending > 0) {
      this.pending = 0;
      this.onSpeakingChange(false);
    }
    if (SpeechQueue.isSupported()) {
      window.speechSynthesis.cancel();
    }
  }

  private speak(raw: string) {
    const text = cleanForSpeech(raw);
    if (!text || !SpeechQueue.isSupported()) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.lang;
    utterance.rate = 1.05;
    utterance.pitch = 0.9;
    const voice = pickVoice(this.lang);
    if (voice) {
      utterance.voice = voice;
    }

    const generation = this.generation;
    const finish = () => {
      if (generation !== this.generation) {
        return;
      }
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0) {
        this.onSpeakingChange(false);
      }
    };
    utterance.onend = finish;
    utterance.onerror = finish;

    this.pending += 1;
    if (this.pending === 1) {
      this.onSpeakingChange(true);
    }
    window.speechSynthesis.speak(utterance);
  }
}

export function playChime(kind: "start" | "alarm" = "start") {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      return;
    }
    const ctx = new AudioCtx();
    const notes = kind === "start" ? [880, 1320] : [988, 784, 988, 784];
    notes.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startAt = ctx.currentTime + index * (kind === "start" ? 0.09 : 0.25);
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.22);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    // Audio is a nicety; ignore failures.
  }
}
