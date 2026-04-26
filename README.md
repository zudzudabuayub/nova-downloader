# Nova Video Extractor

Минималистичный dark-сервис на `Next.js` + `Tailwind CSS`, который:
- принимает ссылку на видео (`YouTube`, `TikTok`, `Instagram`);
- извлекает прямой URL видео и метаданные (`title`, `thumbnail`) через `yt-dlp`;
- показывает кастомный HTML5-плеер, выбор качества, историю последних ссылок и кнопку `Скачать`.

## Требования

- `Node.js` 20+
- установленный `yt-dlp` в `PATH`

Проверка `yt-dlp`:

```powershell
yt-dlp --version
```

## Запуск

```powershell
npm install
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

## Полезные команды

```powershell
npm run lint
npm run build
npm run start
```

## Как это работает

1. Клиент отправляет ссылку в `POST /api/extract`.
2. Сервер валидирует домен и запускает `yt-dlp` с JSON-выводом.
3. При проблемах локального `yt-dlp` (не найден, timeout, extractor fail) сервер пытается использовать внешний fallback API.
4. Сервер возвращает нормализованные данные:
   - `title`
   - `thumbnail`
   - `videoUrl` (прямая ссылка на поток)
   - `sourceUrl`
   - `qualities[]` (доступные качества)
   - `provider` (`yt-dlp` или `external-api`)
5. Клиент рендерит плеер, выбор качества, историю ссылок и кнопку скачивания.

## Настройка fallback API

По умолчанию уже подключен бесплатный fallback-провайдер: `Cobalt` (public instance `https://co.wuk.sh/api/json`).

Если хотите использовать свой fallback API вместо Cobalt, добавьте переменные окружения:

```powershell
EXTERNAL_EXTRACTOR_API_URL=https://your-extractor.example.com/extract
EXTERNAL_EXTRACTOR_API_KEY=your_optional_token
```

Ожидаемый формат ответа fallback API:

```json
{
  "title": "Video title",
  "thumbnail": "https://image.jpg",
  "videoUrl": "https://cdn.example.com/video.mp4",
  "sourceUrl": "https://youtube.com/watch?v=...",
  "qualities": [
    {
      "id": "720p",
      "label": "720p",
      "videoUrl": "https://cdn.example.com/video-720.mp4",
      "ext": "mp4",
      "height": 720
    }
  ]
}
```

## Ограничения

- Некоторые видео могут быть недоступны из-за региональных ограничений.
- DRM-защищенный или приватный контент может не извлекаться.
- Формат прямой ссылки зависит от платформы и доступных форматов в `yt-dlp`.
