import { NextResponse } from "next/server";
import { extractVideoData } from "@/lib/video/extractor";
import { normalizeAndValidateVideoUrl } from "@/lib/video/validators";

type ExtractRequestBody = {
  url?: string;
};

export async function POST(request: Request) {
  let body: ExtractRequestBody;

  try {
    body = (await request.json()) as ExtractRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected { url: string }." },
      { status: 400 },
    );
  }

  try {
    const normalizedUrl = normalizeAndValidateVideoUrl(body.url ?? "");
    const data = await extractVideoData(normalizedUrl.toString());

    return NextResponse.json({
      title: data.title,
      thumbnail: data.thumbnail,
      videoUrl: data.directVideoUrl,
      sourceUrl: data.sourceUrl,
      qualities: data.qualities,
      provider: data.provider,
      audioUrl: data.audioUrl,
      audioSizeMb: data.audioSizeMb,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected extraction error.";

    const status =
      message.includes("Unsupported domain") ||
      message.includes("Invalid URL") ||
      message.includes("Please provide")
        ? 400
        : message.includes("timed out")
          ? 504
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
