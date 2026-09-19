import { EscaleraObjetivos } from "../_components/EscaleraObjetivos";
import { ESCALERA, ESCALERA_OBJETIVOS } from "../_content";
import { H2 } from "../_ui/typography";

export function Escalera() {
  return (
    <section id="escalera" className="bg-om-bone text-om-navy">
      <div className="mx-auto max-w-[1180px] px-6 py-20 sm:px-10 sm:py-24">
        <div className="reveal mx-auto max-w-[68ch] text-center">
          <h2 className={H2}>{ESCALERA.h2}</h2>
          <p className="mx-auto mt-5 max-w-[58ch] text-[1.0625rem] leading-relaxed text-om-navy/80">
            {ESCALERA.bajada}
          </p>
          <p className="mx-auto mt-3 max-w-[58ch] text-[1.0625rem] leading-relaxed text-om-navy/80">
            {ESCALERA.bajada2}
          </p>
        </div>

        <div className="reveal mt-12">
          <EscaleraObjetivos objetivos={ESCALERA_OBJETIVOS} />
        </div>

        <div className="reveal mx-auto mt-12 max-w-[52ch] text-center text-[0.9375rem] leading-relaxed text-om-navy/75">
          <p>{ESCALERA.cierre1}</p>
          <a
            href="#compromiso"
            className="mt-3 inline-block border-b border-om-brassInk/50 font-medium text-om-brassInk transition-colors hover:border-om-brassInk hover:text-om-navy"
          >
            {ESCALERA.cierreLinkTexto} →
          </a>
        </div>
      </div>
    </section>
  );
}
