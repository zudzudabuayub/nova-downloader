type VideoPlayerCardProps = {
  title: string;
  thumbnail: string | null;
  videoUrl: string;
  sourceUrl: string;
  qualityOptions: Array<{
    id: string;
    label: string;
    videoUrl: string;
    ext: string;
    height: number | null;
    sizeMb: number | null;
  }>;
  selectedQualityId: string;
  onQualityChange: (qualityId: string) => void;
  audioUrl: string | null;
  audioSizeMb: number | null;
};

export function VideoPlayerCard({
  title,
  thumbnail,
  videoUrl,
  sourceUrl,
  qualityOptions,
  selectedQualityId,
  onQualityChange,
  audioUrl,
  audioSizeMb,
}: VideoPlayerCardProps) {
  return (
    <section className="w-full rounded-2xl border border-white/10 bg-zinc-900/60 p-4 shadow-2xl shadow-black/40 backdrop-blur sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="line-clamp-2 text-base font-semibold text-zinc-100 sm:text-lg">
          {title}
        </h2>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
        >
          Original
        </a>
      </div>

      <div className="relative mb-5 overflow-hidden rounded-xl border border-white/10 bg-black">
        <video
          className="h-full w-full max-h-[60vh] bg-black"
          controls
          preload="metadata"
          poster={thumbnail ?? undefined}
          src={videoUrl}
        />
      </div>

      <div className="mb-4 rounded-xl border border-white/10 bg-zinc-950/60 p-3">
        <p className="mb-2 text-xs text-zinc-400">Выбор качества</p>
        <div className="flex flex-wrap gap-2">
          {qualityOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onQualityChange(option.id)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                selectedQualityId === option.id
                  ? "border-zinc-200 bg-zinc-200 text-zinc-950"
                  : "border-white/15 bg-zinc-900 text-zinc-200 hover:border-white/40"
              }`}
            >
              {option.label}
              {option.sizeMb ? ` • ${option.sizeMb} MB` : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={videoUrl}
          download
          className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-100 px-5 text-sm font-medium text-zinc-950 transition-all hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
        >
          Скачать видео
        </a>
        {audioUrl && (
          <a
            href={audioUrl}
            download
            className="inline-flex h-11 items-center justify-center rounded-lg border border-white/15 bg-zinc-950 px-5 text-sm font-medium text-zinc-100 transition-all hover:border-white/40"
          >
            Скачать аудио{audioSizeMb ? ` (${audioSizeMb} MB)` : ""}
          </a>
        )}
      </div>
    </section>
  );
}
