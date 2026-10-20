import type { Metadata, Viewport } from "next";
import { JarvisLoader } from "./JarvisLoader";

export const metadata: Metadata = {
  title: "J.A.R.V.I.S.",
  description: "Голосовой ИИ-ассистент для телефона.",
  manifest: "/jarvis.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Jarvis",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/jarvis/icon-192.png",
    apple: "/jarvis/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#020a12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function JarvisPage() {
  return <JarvisLoader />;
}
