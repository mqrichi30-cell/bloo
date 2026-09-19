import { COMPROMISO } from "../_content";
import { Rich } from "../_ui/Rich";
import { Token } from "../_ui/Token";
import { H2, H3 } from "../_ui/typography";

const bloqueTitulo = "text-[0.9375rem] font-semibold uppercase tracking-[0.04em] text-om-brassInk";
const bloqueTexto = "mt-2 text-[1rem] leading-relaxed text-om-navy/90";

export function Compromiso() {
  return (
    <section id="compromiso" className="bg-om-cream text-om-navy">
      <div className="mx-auto max-w-[1180px] px-6 py-20 sm:px-10 sm:py-24">
        <div className="reveal mx-auto max-w-[68ch] text-center">
          <h2 className={H2}>{COMPROMISO.h2}</h2>
          <p className="mx-auto mt-5 max-w-[52ch] text-[1.0625rem] leading-relaxed text-om-navy/80">
            {COMPROMISO.bajada}
          </p>
        </div>

        {/* Panel-documento: hairline, sin sombra pesada — el compromiso tiene
            el mismo peso tipográfico que el resto de la página (no es letra
            chica de footer). */}
        <div className="reveal mx-auto mt-14 max-w-[860px] border border-om-brassInk/25 bg-om-bone px-6 py-10 sm:px-14 sm:py-14">
          <div className="grid gap-9">
            <div>
              <h3 className={bloqueTitulo}>{COMPROMISO.bloque1Titulo}</h3>
              <p className={bloqueTexto}>{COMPROMISO.bloque1}</p>
            </div>

            <div>
              <h3 className={bloqueTitulo}>{COMPROMISO.bloque2Titulo}</h3>
              {COMPROMISO.bloque2.map((parrafo, i) => (
                <p key={i} className={bloqueTexto}>
                  {parrafo}
                </p>
              ))}
            </div>

            <div>
              <h3 className={bloqueTitulo}>{COMPROMISO.bloque3Titulo}</h3>
              <p className={bloqueTexto}>
                <Rich segments={[...COMPROMISO.bloque3]} tone="light" />
              </p>
            </div>

            {/* Bloque 4 absorbe los cuatro compromisos de la extinta #piso:
                una cláusula de medición + una lista numerada de
                obligaciones. Es una secuencia real (cuatro promesas
                distintas, en el orden en que el copy las firma), no un
                truco de maquetación — por eso lleva números. */}
            <div>
              <h3 className={bloqueTitulo}>{COMPROMISO.bloque4Titulo}</h3>
              <p className={bloqueTexto}>{COMPROMISO.bloque4.parrafo1}</p>
              <p className={`${bloqueTexto} mt-4`}>{COMPROMISO.bloque4.intro}</p>
              <ol className="mt-3 space-y-2.5 pl-5 text-[1rem] leading-relaxed text-om-navy/90 list-decimal marker:font-semibold marker:text-om-brassInk">
                {COMPROMISO.bloque4.obligaciones.map((texto, i) => (
                  <li key={i} className="pl-1.5">
                    {texto}
                  </li>
                ))}
              </ol>
              <p className={`${bloqueTexto} mt-4`}>{COMPROMISO.bloque4.cierre}</p>
            </div>

            <div>
              <h3 className={bloqueTitulo}>{COMPROMISO.bloque5Titulo}</h3>
              <p className={bloqueTexto}>{COMPROMISO.bloque5}</p>
            </div>

            <div>
              <h3 className={bloqueTitulo}>{COMPROMISO.bloque6Titulo}</h3>
              <p className={bloqueTexto}>{COMPROMISO.bloque6}</p>
            </div>
          </div>

          <p className={`${H3} mt-10 border-t border-om-brassInk/20 pt-6 text-om-navy`}>
            {COMPROMISO.firmaNombre} <Token name="FECHA_CORTE" />
          </p>

          <p className="mt-6 text-[0.8125rem] leading-relaxed text-om-navy/60">{COMPROMISO.piePequeno}</p>
        </div>
      </div>
    </section>
  );
}
