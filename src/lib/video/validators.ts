const SUPPORTED_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "instagram.com",
  "www.instagram.com",
] as const;

export function normalizeAndValidateVideoUrl(rawUrl: string): URL {
  if (!rawUrl?.trim()) {
    throw new Error("Please provide a video URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Invalid URL format.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP(S) URLs are supported.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isSupported = SUPPORTED_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );

  if (!isSupported) {
    throw new Error(
      "Unsupported domain. Use YouTube, TikTok, or Instagram links.",
    );
  }

  return parsed;
}
