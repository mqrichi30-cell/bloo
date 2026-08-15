import type { Metadata, Viewport } from "next";
import { Inter, Dancing_Script } from "next/font/google";
import { ToastProvider } from "@/components/ToastProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const dancingScript = Dancing_Script({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-script",
  display: "swap",
});

export const metadata: Metadata = {
  title: "bloo",
  description: "Panel interno de ventas e inventario — bloo sunglasses",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0B0E30",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${dancingScript.variable}`}>
      <body className="font-sans">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
