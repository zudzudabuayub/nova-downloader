"use client";

import dynamic from "next/dynamic";

// The assistant relies on browser-only APIs (speech, storage), so skip SSR.
const JarvisAssistant = dynamic(
  () => import("@/components/jarvis/JarvisAssistant").then((mod) => mod.JarvisAssistant),
  {
    ssr: false,
    loading: () => <div className="h-[100dvh] bg-[#020a12]" />,
  },
);

export function JarvisLoader() {
  return <JarvisAssistant />;
}
