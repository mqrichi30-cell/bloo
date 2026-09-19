import { PRODUCTO, VITRINA_MODELOS } from "../_content";
import { VitrinaProducto } from "../_components/VitrinaProducto";
import { H2 } from "../_ui/typography";

export function Producto() {
  return (
    // Único blanco puro de la página: con el piso eliminado, #producto es
    // el único bloque que vive en presente (COPY_SOCIOS.md §0, "nota
    // estructural"). El corte de color contra el bone/cream del resto ya
    // lo separa; el padding y la bajada a tamaño LEDE le dan el peso que
    // pide el copy ("no recortar por espacio").
    <section id="producto" className="bg-white text-om-navy">
      <div className="mx-auto max-w-[1180px] px-6 py-24 sm:px-10 sm:py-32">
        <div className="reveal grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:gap-16">
          <div className="max-w-[46ch]">
            <h2 className={H2}>{PRODUCTO.h2}</h2>
            <p className="mt-5 text-[1.1875rem] leading-relaxed text-om-navy/80">{PRODUCTO.bajada}</p>

            <ul className="mt-9 space-y-7">
              {PRODUCTO.bullets.map((b) => (
                <li key={b.titulo}>
                  <h3 className="text-[1.0625rem] font-semibold text-om-navy">{b.titulo}</h3>
                  <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-om-navy/75">{b.texto}</p>
                </li>
              ))}
            </ul>
          </div>

          {/* Panel navy propio del componente (mismo lenguaje que
              MetaPrincipal) — no se envuelve en otro fondo ni se le pone
              borde encima; se dimensiona solo por consulta de contenedor. */}
          <VitrinaProducto modelos={VITRINA_MODELOS} etiquetaGrupo="Modelos bloo" />
        </div>
      </div>
    </section>
  );
}
