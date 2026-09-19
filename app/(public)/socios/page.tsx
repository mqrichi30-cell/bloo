import type { Metadata } from "next";
import { Hero } from "./_sections/Hero";
import { MetaUno } from "./_sections/MetaUno";
import { Escalera } from "./_sections/Escalera";
import { Producto } from "./_sections/Producto";
import { ComoFunciona } from "./_sections/ComoFunciona";
import { Faq } from "./_sections/Faq";
import { Contacto } from "./_sections/Contacto";
import { Compromiso } from "./_sections/Compromiso";
import { Footer } from "./_sections/Footer";

const TITLE = "Vender bloo en su tienda — bloo puntos de venta";
const DESCRIPTION =
  "bloo: lentes de sol de acetato, marca costarricense. Monturas con una meta pública con fecha: al llegar a cierto volumen, pasa a bio-acetato certificado. Sume su tienda, hotel u óptica.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3010"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/socios",
    siteName: "bloo",
    locale: "es_CR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function SociosPage() {
  return (
    <>
      <Hero />
      <MetaUno />
      <Escalera />
      <Producto />
      <ComoFunciona />
      <Faq />
      <Contacto />
      <Compromiso />
      <Footer />
    </>
  );
}
