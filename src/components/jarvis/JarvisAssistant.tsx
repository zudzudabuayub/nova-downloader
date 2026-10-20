"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LocalAction, matchLocalCommand } from "@/lib/jarvis/commands";
import {
  createRecognizer,
  isRecognitionSupported,
  playChime,
  SpeechQueue,
  type SpeechRecognitionLike,
} from "@/lib/jarvis/speech";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  link?: { url: string; label: string };
  error?: boolean;
};

type Timer = { id: string; endsAt: number; seconds: number };

type Settings = { voice: boolean; wake: boolean };

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "status"; text: string }
  | { type: "error"; text: string }
  | { type: "done" };

const MESSAGES_KEY = "jarvis_messages";
const SETTINGS_KEY = "jarvis_settings";
const MAX_STORED = 50;
const WAKE_WORD = /(?:^|\s)(джарвис|jarvis|жарвис|дарвис)[,.!?]?(?:\s|$)/i;

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode); persistence is optional.
  }
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Доброй ночи, сэр.";
  if (hour < 12) return "Доброе утро, сэр.";
  if (hour < 18) return "Добрый день, сэр.";
  return "Добрый вечер, сэр.";
}

export function JarvisAssistant() {
  const [messages, setMessages] = useState<Message[]>(() => {
    const stored = readStorage<Message[]>(MESSAGES_KEY, []);
    return Array.isArray(stored) ? stored : [];
  });
  const [settings, setSettings] = useState<Settings>(() => ({
    voice: true,
    wake: false,
    ...readStorage<Partial<Settings>>(SETTINGS_KEY, {}),
  }));
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [wakeListening, setWakeListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [timers, setTimers] = useState<Timer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [showSettings, setShowSettings] = useState(false);

  const recognitionSupported = useMemo(() => isRecognitionSupported(), []);
  const speechRef = useRef<SpeechQueue | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  const busyRef = useRef(false);
  const settingsRef = useRef(settings);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const timeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  messagesRef.current = messages;
  settingsRef.current = settings;
  busyRef.current = listening || thinking || speaking;

  if (!speechRef.current && SpeechQueue.isSupported()) {
    speechRef.current = new SpeechQueue(setSpeaking);
  }

  useEffect(() => {
    writeStorage(MESSAGES_KEY, messages.slice(-MAX_STORED));
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    writeStorage(SETTINGS_KEY, settings);
  }, [settings]);

  useEffect(() => {
    if (timers.length === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timers.length]);

  useEffect(() => {
    // Voices load asynchronously on most mobile browsers.
    if (SpeechQueue.isSupported()) {
      window.speechSynthesis.getVoices();
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/jarvis-sw.js", { scope: "/jarvis" }).catch(() => {});
    }
    const timeouts = timeoutsRef.current;
    return () => {
      abortRef.current?.abort();
      recognitionRef.current?.abort();
      speechRef.current?.cancel();
      timeouts.forEach((handle) => clearTimeout(handle));
    };
  }, []);

  const say = useCallback((text: string) => {
    if (!settingsRef.current.voice || !speechRef.current) return;
    speechRef.current.push(text);
    speechRef.current.flush();
  }, []);

  const addMessage = useCallback((message: Omit<Message, "id">) => {
    const full = { ...message, id: makeId() };
    setMessages((prev) => [...prev, full]);
    return full.id;
  }, []);

  const fireTimer = useCallback(
    (timer: Timer) => {
      timeoutsRef.current.delete(timer.id);
      setTimers((prev) => prev.filter((item) => item.id !== timer.id));
      playChime("alarm");
      navigator.vibrate?.([400, 200, 400, 200, 400]);
      const text = "Сэр, время вышло. Таймер сработал.";
      addMessage({ role: "assistant", content: text });
      say(text);
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("J.A.R.V.I.S.", { body: "Таймер сработал", icon: "/jarvis/icon-192.png" });
        } catch {
          // Some mobile browsers only allow notifications from a service worker.
          navigator.serviceWorker?.ready
            .then((registration) =>
              registration.showNotification("J.A.R.V.I.S.", { body: "Таймер сработал", icon: "/jarvis/icon-192.png" }),
            )
            .catch(() => {});
        }
      }
    },
    [addMessage, say],
  );

  const runAction = useCallback(
    (action: LocalAction): Message["link"] | undefined => {
      switch (action.type) {
        case "stop":
          speechRef.current?.cancel();
          abortRef.current?.abort();
          return undefined;
        case "clear":
          setMessages([]);
          return undefined;
        case "timer": {
          const timer: Timer = { id: makeId(), endsAt: Date.now() + action.seconds * 1000, seconds: action.seconds };
          setTimers((prev) => [...prev, timer]);
          setNow(Date.now());
          timeoutsRef.current.set(timer.id, setTimeout(() => fireTimer(timer), action.seconds * 1000));
          if ("Notification" in window && Notification.permission === "default") {
            void Notification.requestPermission();
          }
          return undefined;
        }
        case "open": {
          const { url } = action;
          if (url.startsWith("tel:") || url.startsWith("sms:") || url.startsWith("/")) {
            window.location.href = url;
          } else {
            const opened = window.open(url, "_blank");
            if (opened) opened.opener = null;
          }
          return { url, label: url.replace(/^(https?:\/\/|tel:|sms:)/, "") };
        }
      }
    },
    [fireTimer],
  );

  const askAssistant = useCallback(
    async (history: Message[]) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setThinking(true);
      setStatusText(null);

      const replyId = makeId();
      let reply = "";
      let failed = false;
      setMessages((prev) => [...prev, { id: replyId, role: "assistant", content: "" }]);

      const update = (patch: Partial<Message>) =>
        setMessages((prev) => prev.map((item) => (item.id === replyId ? { ...item, ...patch } : item)));

      try {
        const response = await fetch("/api/jarvis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            messages: history
              .filter((item) => !item.error && item.content.trim())
              .map(({ role, content }) => ({ role, content })),
            clientTime: new Date().toLocaleString("ru-RU", { dateStyle: "full", timeStyle: "short" }),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? `HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as StreamEvent;
            if (event.type === "text") {
              reply += event.text;
              setStatusText(null);
              update({ content: reply });
              if (settingsRef.current.voice) speechRef.current?.push(event.text);
            } else if (event.type === "status") {
              setStatusText(event.text);
            } else if (event.type === "error") {
              failed = !reply;
              reply = reply ? `${reply}\n\n${event.text}` : event.text;
              update({ content: reply, error: failed });
              if (settingsRef.current.voice) speechRef.current?.push(` ${event.text}`);
            }
          }
        }

        if (settingsRef.current.voice) speechRef.current?.flush();
        if (!reply) update({ content: "Я не нашёл, что ответить, сэр.", error: true });
      } catch (error) {
        if (controller.signal.aborted) {
          update({ content: reply || "Отменено." });
        } else {
          const text = error instanceof Error ? error.message : "Ошибка соединения.";
          update({ content: `Не удалось связаться с сервером: ${text}`, error: true });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setThinking(false);
        setStatusText(null);
      }
    },
    [],
  );

  const submit = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;

      speechRef.current?.cancel();
      abortRef.current?.abort();
      setInput("");
      setInterim("");
      setNotice(null);

      const userMessage: Message = { id: makeId(), role: "user", content: text };
      const local = matchLocalCommand(text);

      if (local) {
        const link = local.action ? runAction(local.action) : undefined;
        if (local.action?.type === "clear") {
          setMessages([{ id: makeId(), role: "assistant", content: local.reply }]);
        } else if (local.action?.type !== "stop") {
          setMessages((prev) => [...prev, userMessage, { id: makeId(), role: "assistant", content: local.reply, link }]);
        }
        if (local.reply) say(local.reply);
        return;
      }

      const history = [...messagesRef.current, userMessage];
      setMessages(history);
      void askAssistant(history);
    },
    [askAssistant, runAction, say],
  );

  const stopRecognition = useCallback(() => {
    const current = recognitionRef.current;
    recognitionRef.current = null;
    if (current) {
      current.onend = null;
      current.onresult = null;
      current.onerror = null;
      current.abort();
    }
    setListening(false);
    setWakeListening(false);
  }, []);

  const startListening = useCallback(() => {
    stopRecognition();
    speechRef.current?.cancel();

    const recognizer = createRecognizer();
    if (!recognizer) {
      setNotice("Голосовой ввод не поддерживается этим браузером. Откройте в Chrome или Safari.");
      return;
    }

    let finalText = "";
    recognizer.lang = "ru-RU";
    recognizer.continuous = false;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;

    recognizer.onresult = (event) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      setInterim(`${finalText} ${interimText}`.trim());
    };
    recognizer.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setNotice("Нет доступа к микрофону. Разрешите его в настройках браузера.");
        setSettings((prev) => ({ ...prev, wake: false }));
      } else if (event.error === "network") {
        setNotice("Распознавание речи требует интернет-соединения.");
      }
    };
    recognizer.onend = () => {
      if (recognitionRef.current === recognizer) recognitionRef.current = null;
      setListening(false);
      setInterim("");
      if (finalText.trim()) submit(finalText);
    };

    recognitionRef.current = recognizer;
    setListening(true);
    playChime("start");
    try {
      recognizer.start();
    } catch {
      setListening(false);
    }
  }, [stopRecognition, submit]);

  const startWakeListening = useCallback(() => {
    if (recognitionRef.current) return;
    const recognizer = createRecognizer();
    if (!recognizer) return;

    recognizer.lang = "ru-RU";
    recognizer.continuous = true;
    recognizer.interimResults = false;

    let triggered = false;
    recognizer.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const transcript = result[0].transcript;
        const match = transcript.match(WAKE_WORD);
        if (!match || match.index === undefined) continue;
        triggered = true;
        const command = transcript.slice(match.index + match[0].length).trim();
        recognizer.onend = null;
        recognizer.abort();
        recognitionRef.current = null;
        setWakeListening(false);
        if (command.length > 1) submit(command);
        else startListening();
        return;
      }
    };
    recognizer.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setNotice("Нет доступа к микрофону. Разрешите его в настройках браузера.");
        setSettings((prev) => ({ ...prev, wake: false }));
      }
    };
    recognizer.onend = () => {
      if (recognitionRef.current === recognizer) recognitionRef.current = null;
      setWakeListening(false);
      // Browsers end continuous sessions periodically; restart while the mode is on.
      if (!triggered && settingsRef.current.wake && !busyRef.current) {
        setTimeout(() => {
          if (settingsRef.current.wake && !busyRef.current && !recognitionRef.current) startWakeListening();
        }, 400);
      }
    };

    recognitionRef.current = recognizer;
    setWakeListening(true);
    try {
      recognizer.start();
    } catch {
      recognitionRef.current = null;
      setWakeListening(false);
    }
  }, [startListening, submit]);

  // Background wake-word listening while idle; pause it while busy so Jarvis doesn't hear itself.
  useEffect(() => {
    if (!settings.wake || !recognitionSupported || thinking || speaking || listening) {
      // Its onend handler resets state and won't restart while busy or disabled.
      if (wakeListening) recognitionRef.current?.abort();
      return;
    }
    if (!wakeListening) {
      const handle = setTimeout(startWakeListening, 300);
      return () => clearTimeout(handle);
    }
  }, [settings.wake, thinking, speaking, listening, wakeListening, recognitionSupported, startWakeListening]);

  const onOrbPress = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    if (thinking || speaking) {
      speechRef.current?.cancel();
      abortRef.current?.abort();
      return;
    }
    startListening();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(input);
  };

  const cancelTimer = (id: string) => {
    const handle = timeoutsRef.current.get(id);
    if (handle) clearTimeout(handle);
    timeoutsRef.current.delete(id);
    setTimers((prev) => prev.filter((timer) => timer.id !== id));
  };

  const state = listening ? "listening" : thinking ? "thinking" : speaking ? "speaking" : "idle";
  const stateLabel =
    statusText ??
    (state === "listening"
      ? interim || "Слушаю…"
      : state === "thinking"
        ? "Обрабатываю…"
        : state === "speaking"
          ? "Говорю — нажмите, чтобы прервать"
          : wakeListening
            ? "Скажите «Джарвис…»"
            : recognitionSupported
              ? "Нажмите на ядро и говорите"
              : "Напишите команду ниже");

  return (
    <main className="jarvis-root relative flex h-[100dvh] flex-col overflow-hidden text-cyan-50">
      <div className="jarvis-grid pointer-events-none absolute inset-0" />

      <header className="relative z-10 flex items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top),12px)]">
        <div>
          <h1 className="font-mono text-lg font-semibold tracking-[0.35em] text-cyan-300">J.A.R.V.I.S.</h1>
          <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-500/70">
            {settings.wake ? "Режим ожидания активен" : "Персональный ассистент"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings((value) => !value)}
          className="rounded-full border border-cyan-500/30 p-2 text-cyan-300 transition hover:bg-cyan-500/10"
          aria-label="Настройки"
          aria-expanded={showSettings}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
        </button>
      </header>

      {showSettings && (
        <div className="relative z-20 mx-4 mb-2 space-y-3 rounded-2xl border border-cyan-500/20 bg-[#04121c]/95 p-4 text-sm backdrop-blur">
          <Toggle
            label="Озвучивать ответы"
            checked={settings.voice}
            onChange={(voice) => {
              if (!voice) speechRef.current?.cancel();
              setSettings((prev) => ({ ...prev, voice }));
            }}
          />
          <Toggle
            label="Активация словом «Джарвис»"
            hint="Микрофон слушает, пока приложение открыто"
            checked={settings.wake}
            disabled={!recognitionSupported}
            onChange={(wake) => setSettings((prev) => ({ ...prev, wake }))}
          />
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setShowSettings(false);
            }}
            className="w-full rounded-xl border border-rose-400/30 py-2 text-rose-300 transition hover:bg-rose-500/10"
          >
            Очистить историю
          </button>
        </div>
      )}

      <section className="relative z-10 flex shrink-0 flex-col items-center gap-3 py-3">
        <button
          type="button"
          onClick={onOrbPress}
          className={`jarvis-orb jarvis-${state} ${messages.length > 0 ? "jarvis-orb-compact" : ""}`}
          aria-label={listening ? "Остановить запись" : thinking || speaking ? "Прервать" : "Говорить"}
        >
          <span className="jarvis-ring jarvis-ring-1" />
          <span className="jarvis-ring jarvis-ring-2" />
          <span className="jarvis-ring jarvis-ring-3" />
          <span className="jarvis-core" />
        </button>
        <p className="min-h-[2.5rem] max-w-xs px-4 text-center text-sm text-cyan-200/80" aria-live="polite">
          {stateLabel}
        </p>
      </section>

      <section className="relative z-10 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {messages.length === 0 && (
          <div className="mx-auto max-w-sm space-y-3 pt-2 text-center text-sm text-cyan-200/60">
            <p className="text-base text-cyan-100">{greeting()} Чем могу помочь?</p>
            <div className="flex flex-wrap justify-center gap-2">
              {["Который час?", "Какая погода в Москве?", "Таймер на 5 минут", "Открой YouTube", "Расскажи анекдот"].map(
                (example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => submit(example)}
                    className="rounded-full border border-cyan-500/25 px-3 py-1.5 text-xs text-cyan-200 transition hover:bg-cyan-500/10"
                  >
                    {example}
                  </button>
                ),
              )}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                message.role === "user"
                  ? "rounded-br-sm bg-cyan-500/20 text-cyan-50"
                  : message.error
                    ? "rounded-bl-sm border border-rose-400/30 bg-rose-500/10 text-rose-100"
                    : "rounded-bl-sm border border-cyan-500/20 bg-[#061826]/80 text-cyan-50"
              }`}
            >
              {message.content || <span className="jarvis-dots" aria-label="Печатает" />}
              {message.link && (
                <a
                  href={message.link.url}
                  target={message.link.url.startsWith("http") ? "_blank" : undefined}
                  rel="noopener noreferrer"
                  className="mt-2 block truncate text-sm text-cyan-300 underline underline-offset-4"
                >
                  {message.link.label}
                </a>
              )}
            </div>
          </div>
        ))}
        <div ref={listEndRef} />
      </section>

      <footer className="relative z-10 border-t border-cyan-500/15 bg-[#020a12]/90 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
        {notice && (
          <p className="mb-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {notice}
          </p>
        )}
        {timers.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {timers.map((timer) => (
              <button
                key={timer.id}
                type="button"
                onClick={() => cancelTimer(timer.id)}
                className="flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 font-mono text-sm text-cyan-200"
                aria-label="Отменить таймер"
              >
                ⏱ {formatCountdown(timer.endsAt - now)}
                <span className="text-cyan-400/60">✕</span>
              </button>
            ))}
          </div>
        )}
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Спросите что-нибудь…"
            enterKeyHint="send"
            className="min-w-0 flex-1 rounded-full border border-cyan-500/25 bg-[#04121c] px-4 py-3 text-[16px] text-cyan-50 placeholder:text-cyan-200/40 focus:border-cyan-400 focus:outline-none"
          />
          {input.trim() ? (
            <button
              type="submit"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cyan-400 text-[#021018] transition active:scale-95"
              aria-label="Отправить"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87z" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOrbPress}
              disabled={!recognitionSupported}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40 ${
                listening ? "bg-rose-500 text-white" : "bg-cyan-400 text-[#021018]"
              }`}
              aria-label={listening ? "Остановить запись" : "Голосовой ввод"}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
              </svg>
            </button>
          )}
        </form>
      </footer>
    </main>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={`flex items-center justify-between gap-4 ${disabled ? "opacity-40" : ""}`}>
      <span>
        <span className="block text-cyan-100">{label}</span>
        {hint && <span className="block text-xs text-cyan-200/50">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="jarvis-switch"
      />
    </label>
  );
}
