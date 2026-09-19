import { HERO, HERO_IMAGEN } from "../_content";
import { ProductImage } from "../_ui/ProductImage";
import { Logo } from "../_ui/Logo";
import { H1, KICKER } from "../_ui/typography";

export function Hero() {
  return (
    <section id="hero" className="bg-om-navy text-om-cream">
      <div className="mx-auto max-w-[1180px] px-6 pb-20 pt-10 sm:px-10 sm:pb-28 sm:pt-14 lg:pb-32">
        <div className="reveal mb-12 sm:mb-16">
          <Logo className="h-9 text-om-bone sm:h-10" />
        </div>

        <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <div className="reveal max-w-[46ch]">
            <p className={`${KICKER} mb-5 text-om-brassSoft`}>{HERO.kicker}</p>

            <h1 className={`${H1} text-om-bone`}>{HERO.h1}</h1>

            <p className="mt-6 max-w-[42ch] text-[1.1875rem] leading-relaxed text-om-cream/90">
              {HERO.subtitle}
            </p>

            {/* Ola de marca — un guiño por pantalla, ver components/Logo.tsx */}
            <svg
              className="mt-7 h-3 w-16 text-om-brassSoft motion-safe:animate-wave-draw"
              viewBox="0 0 64 12"
              fill="none"
              aria-hidden="true"
              strokeDasharray="48"
            >
              <path
                d="M2 6q6-8 12 0t12 0 12 0 12 0 12 0"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>

            <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
              <a
                href="#contacto"
                className="inline-flex min-h-[48px] items-center justify-center rounded-[8px] bg-om-bone px-6 text-[0.9375rem] font-semibold text-om-navy transition-colors hover:bg-om-brassSoft"
              >
                {HERO.ctaPrimary}
              </a>
              <a
                href="#escalera"
                className="inline-flex min-h-[48px] items-center justify-center border-b border-om-brassSoft/70 text-[0.9375rem] font-medium text-om-cream transition-colors hover:border-om-bone hover:text-om-bone"
              >
                {HERO.ctaSecondary}
              </a>
            </div>

            <p className="mt-6 text-[0.875rem] text-om-cream/65">{HERO.support}</p>
          </div>

          {/* Retrato de producto: foto real vertical con fondo styling (lino,
              madera), no un recorte flotante. Se enmarca con un margen navy +
              hairline color marca en vez de dejar el fondo propio de la foto
              tocar directo el navy de la sección — el fondo azul lino de las
              otras dos fotos (lente-01/03) sí choca con este navy; esta
              (lente-02) tiene fondo de madera cálida y no lo necesita para no
              chocar, pero el marco se deja igual por consistencia con el
              resto del sistema y para que el retrato alto se lea como una
              pieza compuesta, no una foto suelta. */}
          <div className="reveal mx-auto w-full max-w-[360px]">
            <div className="rounded-[12px] border border-om-brassSoft/25 bg-om-navy p-3 shadow-[0_20px_50px_rgba(0,0,0,0.35)] sm:p-4">
              <ProductImage
                file={HERO_IMAGEN.file}
                alt={HERO_IMAGEN.alt}
                width={768}
                height={1365}
                sizes="(min-width: 1024px) 32vw, 80vw"
                className="w-full rounded-[6px]"
                priority
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
