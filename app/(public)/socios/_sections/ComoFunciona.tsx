import { COMO_FUNCIONA } from "../_content";
import { H2, SERIF } from "../_ui/typography";

export function ComoFunciona() {
  return (
    <section id="como-funciona" className="bg-om-cream text-om-navy">
      <div className="mx-auto max-w-[1180px] px-6 py-20 sm:px-10 sm:py-24">
        <h2 className={`${H2} reveal max-w-[26ch]`}>{COMO_FUNCIONA.h2}</h2>

        <ol className="mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {COMO_FUNCIONA.pasos.map((paso, i) => (
            <li key={paso.titulo} className="reveal">
              <span className={`${SERIF} block text-[2.25rem] leading-none text-om-brassInk`}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-3 text-[1.0625rem] font-semibold">{paso.titulo}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-om-navy/75">{paso.texto}</p>
            </li>
          ))}
        </ol>

        <p className="reveal mt-14 max-w-[60ch] border-t border-om-navy/15 pt-6 text-[0.9375rem] leading-relaxed text-om-navy/80">
          {COMO_FUNCIONA.notaHoteles}
        </p>
      </div>
    </section>
  );
}
