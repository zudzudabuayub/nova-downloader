"use client";

import { FormEvent, useState } from "react";
import { VideoPlayerCard } from "@/components/VideoPlayerCard";

type QualityOption = {
  id: string;
  label: string;
  videoUrl: string;
  ext: string;
  height: number | null;
  sizeMb: number | null;
};

type ExtractSuccess = {
  title: string;
  thumbnail: string | null;
  videoUrl: string;
  sourceUrl: string;
  qualities: QualityOption[];
  provider: "yt-dlp" | "external-api";
  audioUrl: string | null;
  audioSizeMb: number | null;
};

function isExtractSuccess(payload: unknown): payload is ExtractSuccess {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.title === "string" &&
    typeof candidate.videoUrl === "string" &&
    typeof candidate.sourceUrl === "string" &&
    Array.isArray(candidate.qualities) &&
    (candidate.provider === "yt-dlp" || candidate.provider === "external-api") &&
    ("audioUrl" in candidate ? candidate.audioUrl === null || typeof candidate.audioUrl === "string" : true)
  );
}

const HISTORY_KEY = "nova_download_recent_links";
const MAX_HISTORY = 5;

export function LinkInputForm() {
  const [link, setLink] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoData, setVideoData] = useState<ExtractSuccess | null>(null);
  const [selectedQualityId, setSelectedQualityId] = useState("");
  const [recentLinks, setRecentLinks] = useState<string[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed)
        ? parsed.filter((item) => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  });

  function pushRecentLink(url: string) {
    const next = [url, ...recentLinks.filter((item) => item !== url)].slice(
      0,
      MAX_HISTORY,
    );
    setRecentLinks(next);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text?.trim()) {
        setLink(text.trim());
      }
    } catch {
      setError("Не удалось получить текст из буфера обмена.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);
    setVideoData(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link }),
      });

      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: string }).error || "")
            : "";
        throw new Error(message || "Не удалось обработать ссылку.");
      }

      if (!isExtractSuccess(payload)) {
        throw new Error("Сервер вернул неожиданный формат ответа.");
      }

      pushRecentLink(link.trim());
      setVideoData(payload);
      setSelectedQualityId(payload.qualities[0]?.id || "");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Произошла непредвиденная ошибка.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 shadow-2xl shadow-black/30 backdrop-blur sm:p-6"
      >
        <label htmlFor="video-link" className="mb-3 block text-sm text-zinc-300">
          Вставьте ссылку YouTube, TikTok или Instagram
        </label>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative w-full">
            <input
              id="video-link"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              type="url"
              required
              placeholder="https://..."
              className="h-11 w-full rounded-lg border border-white/10 bg-zinc-950 px-3 pr-9 text-sm text-zinc-100 outline-none ring-0 transition-all placeholder:text-zinc-500 focus:border-zinc-500"
            />
            {link && (
              <button
                type="button"
                onClick={() => setLink("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-100"
                aria-label="Очистить поле"
              >
                X
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={pasteFromClipboard}
            className="h-11 shrink-0 rounded-lg border border-white/15 bg-zinc-950 px-4 text-sm font-medium text-zinc-200 transition-all hover:border-white/30"
          >
            Вставить
          </button>

          <button
            type="submit"
            disabled={isLoading}
            className="h-11 shrink-0 rounded-lg bg-zinc-100 px-5 text-sm font-medium text-zinc-950 transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Обработка..." : "Получить видео"}
          </button>
        </div>
      </form>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {videoData && (
        <VideoPlayerCard
          title={videoData.title}
          thumbnail={videoData.thumbnail}
          videoUrl={
            videoData.qualities.find((item) => item.id === selectedQualityId)
              ?.videoUrl || videoData.videoUrl
          }
          sourceUrl={videoData.sourceUrl}
          qualityOptions={videoData.qualities}
          selectedQualityId={selectedQualityId}
          onQualityChange={setSelectedQualityId}
          audioUrl={videoData.audioUrl}
          audioSizeMb={videoData.audioSizeMb}
        />
      )}

      {recentLinks.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-zinc-900/40 p-3">
          <p className="mb-2 text-xs text-zinc-400">Последние ссылки</p>
          <div className="flex flex-wrap gap-2">
            {recentLinks.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setLink(item)}
                className="max-w-full truncate rounded-md border border-white/10 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:text-zinc-100"
              >
                {item}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
