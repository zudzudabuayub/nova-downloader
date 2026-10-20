export type LocalAction =
  | { type: "open"; url: string }
  | { type: "timer"; seconds: number }
  | { type: "clear" }
  | { type: "stop" };

export type LocalCommandResult = {
  reply: string;
  action?: LocalAction;
};

const SITES: Array<{ keys: string[]; name: string; url: string }> = [
  { keys: ["youtube", "ютуб", "ютюб"], name: "YouTube", url: "https://www.youtube.com" },
  { keys: ["google", "гугл"], name: "Google", url: "https://www.google.com" },
  { keys: ["telegram", "телеграм", "телегу", "телега"], name: "Telegram", url: "https://web.telegram.org" },
  { keys: ["whatsapp", "ватсап", "вотсап", "воцап"], name: "WhatsApp", url: "https://web.whatsapp.com" },
  { keys: ["instagram", "инстаграм", "инсту", "инста"], name: "Instagram", url: "https://www.instagram.com" },
  { keys: ["tiktok", "тикток", "тик ток"], name: "TikTok", url: "https://www.tiktok.com" },
  { keys: ["вконтакте", "вк", "vk"], name: "ВКонтакте", url: "https://vk.com" },
  { keys: ["карты", "карту", "maps"], name: "карты", url: "https://maps.google.com" },
  { keys: ["почту", "почта", "gmail", "джимейл"], name: "почту", url: "https://mail.google.com" },
  { keys: ["википедию", "википедия", "wikipedia"], name: "Википедию", url: "https://ru.wikipedia.org" },
  { keys: ["переводчик", "translate"], name: "переводчик", url: "https://translate.google.com" },
  { keys: ["погоду", "погода"], name: "погоду", url: "https://www.google.com/search?q=погода" },
  { keys: ["загрузчик", "nova", "нова", "скачивалку"], name: "Nova Downloader", url: "/" },
];

const NUMBER_WORDS: Record<string, number> = {
  одну: 1, одна: 1, один: 1, полторы: 1.5, две: 2, два: 2, три: 3, четыре: 4,
  пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50,
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[,!?;:«»"]/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/^\s*(джарвис|jarvis)\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw: string | undefined): number {
  if (!raw) {
    return 1;
  }
  const numeric = Number(raw.replace(",", "."));
  if (!Number.isNaN(numeric)) {
    return numeric;
  }
  return NUMBER_WORDS[raw] ?? NaN;
}

function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0) {
    return `${seconds / 3600} ч`;
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60} мин`;
  }
  if (seconds > 60) {
    return `${Math.floor(seconds / 60)} мин ${seconds % 60} сек`;
  }
  return `${seconds} сек`;
}

export function matchLocalCommand(input: string, now = new Date()): LocalCommandResult | null {
  const text = normalize(input);
  if (!text) {
    return null;
  }

  if (/^(стоп|замолчи|хватит|тихо|остановись)$/.test(text)) {
    return { reply: "", action: { type: "stop" } };
  }

  if (/^(очисти|сотри|удали) (историю|чат|переписку)|^забудь вс[её]/.test(text)) {
    return { reply: "История очищена, сэр. Начнём с чистого листа.", action: { type: "clear" } };
  }

  if (/(который час|сколько (сейчас )?времени|сколько время|текущее время)/.test(text)) {
    const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return { reply: `Сейчас ${time}, сэр.` };
  }

  if (/(какое (сегодня )?число|какая (сегодня )?дата|какой сегодня день|какой день недели)/.test(text)) {
    const date = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    return { reply: `Сегодня ${date}.` };
  }

  const timer = text.match(
    /(?:таймер|засеки|напомни)(?: мне)?(?: через| на)? ?([\d.,]+|[а-я]+)? ?(секунд[уы]?|сек|минут[уы]?|мин|час(?:а|ов)?)/,
  );
  if (timer) {
    const amount = parseAmount(timer[1]);
    const unit = timer[2];
    const multiplier = unit.startsWith("сек") ? 1 : unit.startsWith("мин") ? 60 : 3600;
    const seconds = Math.round(amount * multiplier);
    if (Number.isFinite(seconds) && seconds > 0 && seconds <= 24 * 3600) {
      return {
        reply: `Таймер на ${formatDuration(seconds)} запущен.`,
        action: { type: "timer", seconds },
      };
    }
  }

  const call = text.match(/^(?:позвони|набери|вызови)(?: на номер| номер)? ([+\d][\d\s()-]{4,})$/);
  if (call) {
    const number = call[1].replace(/[^\d+]/g, "");
    return { reply: `Набираю ${number}.`, action: { type: "open", url: `tel:${number}` } };
  }

  const sms = text.match(/^(?:напиши|отправь) (?:смс|сообщение)(?: на номер| на)? ([+\d][\d\s()-]{4,})$/);
  if (sms) {
    const number = sms[1].replace(/[^\d+]/g, "");
    return { reply: `Открываю сообщения для ${number}.`, action: { type: "open", url: `sms:${number}` } };
  }

  const open = text.match(/^(?:открой|запусти|включи|покажи) (.+)$/);
  if (open) {
    const target = open[1].trim();
    const site = SITES.find((item) => item.keys.some((key) => target === key || target.startsWith(`${key} `)));
    if (site) {
      return { reply: `Открываю ${site.name}.`, action: { type: "open", url: site.url } };
    }
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(target)) {
      return { reply: `Открываю ${target}.`, action: { type: "open", url: `https://${target}` } };
    }
  }

  const search = text.match(/^(?:найди в интернете|загугли|поищи в гугле|найди в гугле) (.+)$/);
  if (search) {
    return {
      reply: `Ищу «${search[1]}».`,
      action: { type: "open", url: `https://www.google.com/search?q=${encodeURIComponent(search[1])}` },
    };
  }

  return null;
}
