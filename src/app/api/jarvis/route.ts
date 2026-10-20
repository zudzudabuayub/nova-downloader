import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  type JarvisStreamEvent,
  parseChatRequest,
  streamJarvisReply,
} from "@/lib/jarvis/assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Не настроен ключ API. Добавьте ANTHROPIC_API_KEY на сервере.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Слишком много запросов. Попробуйте через минуту.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Нет связи с сервером ИИ. Проверьте подключение.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Ошибка сервиса ИИ (${error.status ?? "?"}).`;
  }
  if (error instanceof Error && error.message.includes("credentials")) {
    return "Не настроен ключ API. Добавьте ANTHROPIC_API_KEY на сервере.";
  }
  return "Что-то пошло не так. Попробуйте ещё раз.";
}

export async function POST(request: Request) {
  let parsed: ReturnType<typeof parseChatRequest>;

  try {
    parsed = parseChatRequest(await request.json());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid request body.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: JarvisStreamEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        for await (const event of streamJarvisReply(parsed.history, parsed)) {
          send(event);
        }
      } catch (error) {
        console.error("[jarvis]", error);
        send({ type: "error", text: describeError(error) });
      }

      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
