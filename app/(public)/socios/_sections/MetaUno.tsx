import { AvanceMeta1 } from "./AvanceMeta1";
import { META_UNO } from "../_content";
import { H2, KICKER } from "../_ui/typography";

export function MetaUno() {
  return (
    <section id="meta-1" className="bg-om-cream text-om-navy">
      <div className="mx-auto max-w-[1180px] px-6 py-20 sm:px-10 sm:py-24">
        <div className="reveal mx-auto max-w-[68ch]">
          <p className={`${KICKER} mb-4 text-om-brassInk`}>{META_UNO.badge}</p>

          <h2 className={H2}>{META_UNO.h2}</h2>

          <div className="mt-6 space-y-4 text-[1.0625rem] leading-relaxed text-om-navy/90">
            <p>{META_UNO.parrafo1}</p>
            <p>{META_UNO.parrafo2}</p>
            <p>{META_UNO.parrafo3}</p>
          </div>

          {/* Nota de alcance sobre la mica — visible, mismo peso que el resto,
              no es letra chica (docs/COPY_SOCIOS.md). */}
          <p className="mt-6 border-l-0 border-t border-om-navy/15 pt-6 text-[1.0625rem] leading-relaxed text-om-navy/90">
            {META_UNO.notaAlcance}
          </p>
        </div>

        {/* El contador real vive en un client component aparte: resuelve
            `actual` desde /api/socios/avance sin volver dinámica toda la
            página. Nunca renderiza un MetaPrincipal roto — ver
            AvanceMeta1.tsx para los tres estados (cargando/ok/sin datos). */}
        <div className="reveal mt-14">
          <AvanceMeta1 />
        </div>

        <p className="reveal mx-auto mt-6 max-w-[68ch] text-center text-[0.9375rem] leading-relaxed text-om-navy/70">
          {META_UNO.microcopyContador}
        </p>
      </div>
    </section>
  );
}
