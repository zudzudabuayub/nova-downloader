import Anthropic from "@anthropic-ai/sdk";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type JarvisStreamEvent =
  | { type: "text"; text: string }
  | { type: "status"; text: string }
  | { type: "error"; text: string }
  | { type: "done" };

const MODEL = process.env.JARVIS_MODEL || "claude-opus-5-5";
const MAX_HISTORY = 20;
const MAX_TURN_LENGTH = 4000;
const MAX_CONTINUATIONS = 3;

// Stable part of the system prompt (cached). Volatile data goes into a separate block.
const SYSTEM_PROMPT = `Ты — J.A.R.V.I.S., персональный голосовой ассистент в телефоне пользователя.

Стиль:
- Говоришь по-русски, если пользователь не перешёл на другой язык.
- Вежливый, спокойный, с лёгкой британской иронией, как Джарвис из фильмов. Иногда обращаешься "сэр", но не в каждой фразе.
- Ответы короткие: обычно 1–3 предложения. Их озвучивают голосом, поэтому без markdown, списков, таблиц, эмодзи и ссылок в тексте.
- Если вопрос требует развёрнутого ответа, дай суть кратко и предложи рассказать подробнее.

Возможности:
- Для свежих фактов (погода, новости, курсы валют, расписания, результаты матчей) используй веб-поиск.
- Приложение само умеет: открывать сайты, ставить таймеры, говорить время и дату, звонить и писать сообщения. Если пользователь просит что-то из этого, а команда до тебя дошла, коротко объясни, как сказать её проще, например "открой YouTube" или "таймер на 5 минут".
- Ты не можешь управлять настройками телефона, читать его файлы или контакты — честно говори об этом.`;

function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const turns = raw
    .filter(
      (item): item is ChatTurn =>
        !!item &&
        typeof item === "object" &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim().length > 0,
    )
    .map((item) => ({
      role: item.role,
      content: item.content.slice(0, MAX_TURN_LENGTH),
    }))
    .slice(-MAX_HISTORY);

  // The API requires the conversation to start with a user turn.
  while (turns.length > 0 && turns[0].role !== "user") {
    turns.shift();
  }

  return turns;
}

export function parseChatRequest(body: unknown): {
  history: ChatTurn[];
  clientTime: string | null;
  timezone: string | null;
} {
  const candidate = (body ?? {}) as Record<string, unknown>;
  const history = sanitizeHistory(candidate.messages);

  if (history.length === 0 || history[history.length - 1].role !== "user") {
    throw new Error("Please provide messages ending with a user turn.");
  }

  return {
    history,
    clientTime:
      typeof candidate.clientTime === "string"
        ? candidate.clientTime.slice(0, 100)
        : null,
    timezone:
      typeof candidate.timezone === "string"
        ? candidate.timezone.slice(0, 100)
        : null,
  };
}

export async function* streamJarvisReply(
  history: ChatTurn[],
  context: { clientTime: string | null; timezone: string | null },
): AsyncGenerator<JarvisStreamEvent> {
  const client = new Anthropic();

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  const contextLine = [
    context.clientTime ? `Текущее время пользователя: ${context.clientTime}.` : null,
    context.timezone ? `Часовой пояс: ${context.timezone}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];
  if (contextLine) {
    system.push({ type: "text", text: contextLine });
  }

  for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_start" &&
        event.content_block.type === "server_tool_use"
      ) {
        yield { type: "status", text: "Ищу в интернете…" };
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "text", text: event.delta.text };
      }
    }

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      yield {
        type: "error",
        text: "Боюсь, с этим запросом я помочь не могу, сэр.",
      };
      return;
    }

    if (message.stop_reason !== "pause_turn") {
      return;
    }

    // The server-side tool loop paused: send the partial turn back so it resumes.
    messages.push({ role: "assistant", content: message.content });
  }
}
