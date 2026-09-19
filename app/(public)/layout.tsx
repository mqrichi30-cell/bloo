import { EB_Garamond } from "next/font/google";

// Serif "old money navy" para /socios (landing pública B2B). Cargado SOLO acá
// (no en app/layout.tsx) para no engordar la app interna con un font que esa
// no usa. Expone --font-om-serif, que _components/*.module.css consume con
// fallback a su propia cadena de sistema si por algo no está definida.
const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-om-serif",
  display: "swap",
});

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className={ebGaramond.variable}>{children}</div>;
}
