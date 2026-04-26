import { LinkInputForm } from "@/components/LinkInputForm";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-14 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_transparent_40%)]" />

      <div className="relative mx-auto mb-8 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
          Nova Video Extractor
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400 sm:text-base">
          Вставьте ссылку на YouTube, TikTok или Instagram, получите прямой
          поток и скачайте видео в один клик.
        </p>
      </div>
      <LinkInputForm />
    </main>
  );
}
