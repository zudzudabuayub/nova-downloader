import { spawn } from "node:child_process";

export type VideoQualityOption = {
  id: string;
  label: string;
  videoUrl: string;
  ext: string;
  height: number | null;
  sizeMb: number | null;
};

export type ExtractedVideo = {
  title: string;
  thumbnail: string | null;
  directVideoUrl: string;
  sourceUrl: string;
  qualities: VideoQualityOption[];
  provider: "yt-dlp" | "external-api";
  audioUrl: string | null;
  audioSizeMb: number | null;
};

type YtDlpResult = {
  title?: string;
  thumbnail?: string;
  url?: string;
  webpage_url?: string;
  formats?: Array<{
    format_id?: string;
    url?: string;
    ext?: string;
    vcodec?: string;
    protocol?: string;
    acodec?: string;
    height?: number;
    filesize?: number;
    filesize_approx?: number;
    abr?: number;
  }>;
};

type ExternalApiResult = {
  title?: string;
  thumbnail?: string | null;
  videoUrl?: string;
  sourceUrl?: string;
  qualities?: Array<{
    id?: string;
    label?: string;
    videoUrl?: string;
    ext?: string;
    height?: number | null;
    sizeMb?: number | null;
  }>;
  audioUrl?: string;
  audioSizeMb?: number | null;
};

type CobaltResult = {
  url?: string;
  filename?: string;
};

const COMMAND_TIMEOUT_MS = 45_000;
const API_TIMEOUT_MS = 12_000;
const COBALT_FALLBACK_URL = "https://co.wuk.sh/api/json";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toMb(bytes?: number): number | null {
  if (!bytes || bytes <= 0) {
    return null;
  }
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function normalizeYtDlpQualities(payload: YtDlpResult): VideoQualityOption[] {
  const bestByHeight = new Map<string, VideoQualityOption>();

  for (const format of payload.formats ?? []) {
    if (
      !format.url ||
      !format.vcodec ||
      format.vcodec === "none" ||
      !format.acodec ||
      format.acodec === "none" ||
      format.protocol === "m3u8_native"
    ) {
      continue;
    }

    const height = typeof format.height === "number" ? format.height : null;
    const ext = format.ext || "mp4";
    const key = height ? String(height) : "auto";
    const current = bestByHeight.get(key);
    const candidate: VideoQualityOption = {
      id: format.format_id || `${ext}-${height ?? "auto"}`,
      label: height ? `${height}p` : "Auto",
      videoUrl: format.url,
      ext,
      height,
      sizeMb: toMb(format.filesize ?? format.filesize_approx),
    };

    if (!current || (current.ext !== "mp4" && candidate.ext === "mp4")) {
      bestByHeight.set(key, candidate);
    }
  }

  return Array.from(bestByHeight.values())
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
    .slice(0, 8);
}

function getBestAudioTrack(payload: YtDlpResult): { url: string; sizeMb: number | null } | null {
  const tracks = (payload.formats ?? []).filter(
    (format) =>
      format.url &&
      format.acodec &&
      format.acodec !== "none" &&
      (!format.vcodec || format.vcodec === "none"),
  );

  if (!tracks.length) {
    return null;
  }

  tracks.sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));
  const best = tracks[0];
  if (!best?.url) {
    return null;
  }

  return { url: best.url, sizeMb: toMb(best.filesize ?? best.filesize_approx) };
}

function normalizeExternalQualities(payload: ExternalApiResult): VideoQualityOption[] {
  const result: VideoQualityOption[] = [];
  const seen = new Set<string>();

  for (const item of payload.qualities ?? []) {
    if (!item.videoUrl) {
      continue;
    }
    const key = item.height ? String(item.height) : item.videoUrl;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    result.push({
      id: item.id || `fallback-${result.length + 1}`,
      label: item.label || (item.height ? `${item.height}p` : "Auto"),
      videoUrl: item.videoUrl,
      ext: item.ext || "mp4",
      height: item.height ?? null,
      sizeMb: item.sizeMb ?? null,
    });
  }

  return result.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
}

async function extractWithYtDlp(videoUrl: string): Promise<ExtractedVideo> {
  return new Promise((resolve, reject) => {
    const args = [
      "--dump-single-json",
      "--no-warnings",
      "--skip-download",
      "--no-playlist",
      "--format",
      "best[acodec!=none][vcodec!=none]/best",
      videoUrl,
    ];

    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let didTimeout = false;

    const timeout = setTimeout(() => {
      didTimeout = true;
      child.kill();
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Cannot start yt-dlp. Make sure it is installed and available in PATH. ${error.message}`,
        ),
      );
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (didTimeout) {
        reject(new Error("yt-dlp request timed out. Try another link."));
        return;
      }
      if (exitCode !== 0) {
        reject(new Error(`yt-dlp failed: ${stderr.trim() || `exit code ${exitCode}`}`));
        return;
      }

      try {
        const payload = JSON.parse(stdout) as YtDlpResult;
        const qualities = normalizeYtDlpQualities(payload);
        const directVideoUrl = payload.url || qualities[0]?.videoUrl;
        const audioTrack = getBestAudioTrack(payload);

        if (!directVideoUrl) {
          reject(new Error("No playable video URL was found for this link."));
          return;
        }

        resolve({
          title: payload.title?.trim() || "Untitled video",
          thumbnail: payload.thumbnail || null,
          directVideoUrl,
          sourceUrl: payload.webpage_url || videoUrl,
          qualities:
            qualities.length > 0
              ? qualities
              : [
                  {
                    id: "default",
                    label: "Auto",
                    videoUrl: directVideoUrl,
                    ext: "mp4",
                    height: null,
                    sizeMb: null,
                  },
                ],
          provider: "yt-dlp",
          audioUrl: audioTrack?.url || null,
          audioSizeMb: audioTrack?.sizeMb || null,
        });
      } catch {
        reject(new Error("Failed to parse yt-dlp response."));
      }
    });
  });
}

async function extractWithCobalt(videoUrl: string): Promise<ExtractedVideo> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(COBALT_FALLBACK_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: videoUrl, vCodec: "h264", aFormat: "best" }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Cobalt fallback failed with status ${response.status}`);
    }
    const payload = (await response.json()) as CobaltResult;
    if (!payload.url) {
      throw new Error("Cobalt fallback returned no direct URL.");
    }

    return {
      title: payload.filename || "Untitled video",
      thumbnail: null,
      directVideoUrl: payload.url,
      sourceUrl: videoUrl,
      qualities: [
        {
          id: "cobalt-default",
          label: "Auto",
          videoUrl: payload.url,
          ext: "mp4",
          height: null,
          sizeMb: null,
        },
      ],
      provider: "external-api",
      audioUrl: null,
      audioSizeMb: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function extractWithExternalApi(videoUrl: string): Promise<ExtractedVideo> {
  const apiUrl = process.env.EXTERNAL_EXTRACTOR_API_URL;
  if (!apiUrl) {
    return extractWithCobalt(videoUrl);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.EXTERNAL_EXTRACTOR_API_KEY
          ? { Authorization: `Bearer ${process.env.EXTERNAL_EXTRACTOR_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({ url: videoUrl }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`External API failed with status ${response.status}`);
    }
    const payload = (await response.json()) as ExternalApiResult;
    if (!payload.videoUrl) {
      throw new Error("External API response does not include videoUrl.");
    }

    const qualities = normalizeExternalQualities(payload);
    return {
      title: payload.title?.trim() || "Untitled video",
      thumbnail: payload.thumbnail || null,
      directVideoUrl: payload.videoUrl,
      sourceUrl: payload.sourceUrl || videoUrl,
      qualities:
        qualities.length > 0
          ? qualities
          : [
              {
                id: "external-default",
                label: "Auto",
                videoUrl: payload.videoUrl,
                ext: "mp4",
                height: null,
                sizeMb: null,
              },
            ],
      provider: "external-api",
      audioUrl: payload.audioUrl || null,
      audioSizeMb: payload.audioSizeMb ?? null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function shouldUseFallback(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("cannot start yt-dlp") ||
    message.includes("timed out") ||
    message.includes("yt-dlp failed")
  );
}

export async function extractVideoData(videoUrl: string): Promise<ExtractedVideo> {
  try {
    return await extractWithYtDlp(videoUrl);
  } catch (error) {
    if (!shouldUseFallback(error)) {
      throw error;
    }
    try {
      return await extractWithExternalApi(videoUrl);
    } catch (fallbackError) {
      throw new Error(
        `Primary extractor failed (${getErrorMessage(error)}). Fallback extractor failed (${getErrorMessage(fallbackError)}).`,
      );
    }
  }
}
