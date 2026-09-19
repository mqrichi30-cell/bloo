"use client";

import { useEffect, useState } from "react";
import { MetaPrincipal } from "../_components/MetaPrincipal";
import { META_UNO } from "../_content";

/**
 * Envuelve <MetaPrincipal/> y le resuelve `actual` desde GET
 * /api/socios/avance en el cliente — la página en sí queda estática/ISR
 * (Netlify): esta es la única "isla" dinámica de la sección.
 *
 * Contrato vigente del endpoint (confirmado en vivo, 2026-08-16):
 * `promedioDisponible` es un número real siempre que exista al menos un mes
 * cerrado con ventas — no espera a los tres meses de `promedio3m`, y no
 * diluye el promedio con los meses anteriores a la primera venta. Antes
 * esta sección escondía el contador entero mientras `promedio3m` fuera
 * null, lo que hacía parecer que el sitio no estaba conectado a la base de
 * datos; ya no: si hay *cualquier* promedio disponible, aunque sea de un
 * solo mes, se muestra. Solo se cae al estado "sin datos" cuando la
 * consulta falla de verdad o no existe ningún mes cerrado con ventas
 * (`promedioDisponible === null`) — nunca 0 por error.
 */

interface MesUnidad {
  periodo: string;
  unidades: number;
}

interface MesEnCursoApi {
  periodo: string;
  unidades: number;
  parcial: true;
}

interface AvanceResponse {
  estado: "ok" | "datos_insuficientes" | "no_disponible";
  /** Métrica oficial de la meta: solo existe con 3 meses cerrados. Nunca se muestra como número principal. */
  promedio3m: number | null;
  /** El número que va en la barra: promedio sobre los meses cerrados que existen de verdad. */
  promedioDisponible: number | null;
  /** Cuántos meses componen `promedioDisponible`. */
  promedioDisponibleMeses: number;
  /** `promedioDisponible / meta`, ya acotado [0,1] por el backend. */
  fraccionAvance: number | null;
  meses: MesUnidad[];
  mesEnCurso: MesEnCursoApi | null;
}

type FetchState =
  | { kind: "loading" }
  | { kind: "data"; data: AvanceResponse }
  | { kind: "error" };

function formatPeriodo(periodo: string): string {
  const [y, m] = periodo.split("-");
  const meses = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
  ];
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${meses[idx]} ${y}` : periodo;
}

export function AvanceMeta1() {
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/socios/avance")
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json() as Promise<AvanceResponse>;
      })
      .then((data) => {
        if (!cancelled) setState({ kind: "data", data });
      })
      .catch(() => {
        // Nunca deja caer la sección: si el fetch falla, tarda o el JSON no
        // parsea, cae al mismo estado honesto que "no_disponible".
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="mx-auto max-w-[68ch] text-center" aria-live="polite" aria-busy="true">
        <p className="text-[0.9375rem] text-om-navy/60">Un momento.</p>
      </div>
    );
  }

  if (state.kind === "error" || state.data.estado === "no_disponible") {
    return (
      <div className="mx-auto max-w-[52ch] text-center">
        <p className="text-[1.0625rem] leading-relaxed text-om-navy/80">
          Todavía no publicamos el corte de este mes. Vuelva pronto.
        </p>
      </div>
    );
  }

  const { data } = state;

  // Los meses que de verdad componen `promedioDisponible` son los últimos
  // `promedioDisponibleMeses` de `data.meses` (el backend ya excluyó los
  // anteriores a la primera venta — no se recalcula acá, solo se recorta la
  // lista para mostrar exactamente lo que se promedió).
  const n = Math.max(data.promedioDisponibleMeses, 0);
  const mesesIncluidos = n > 0 ? data.meses.slice(-n).map((mes) => formatPeriodo(mes.periodo)) : [];
  const mesEnCurso = data.mesEnCurso
    ? { etiqueta: formatPeriodo(data.mesEnCurso.periodo), unidades: data.mesEnCurso.unidades }
    : null;

  return (
    <div>
      <MetaPrincipal
        meta={META_UNO.metaPrincipalStatic.meta}
        actual={data.promedioDisponible}
        etiqueta={META_UNO.etiquetaContador}
        promesa={META_UNO.metaPrincipalStatic.promesa}
        fraccionAvance={data.fraccionAvance}
        mesEnCurso={mesEnCurso}
        mesesIncluidos={mesesIncluidos}
      />

      {data.meses.length > 0 && (
        <div className="mx-auto mt-10 max-w-[52ch] text-center">
          <p className="text-[0.8125rem] font-medium uppercase tracking-[0.04em] text-om-brassInk">
            Unidades por mes cerrado
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-4 text-center">
            {data.meses.map((mes) => (
              <div key={mes.periodo}>
                <dt className="text-[0.8125rem] capitalize text-om-navy/60">{formatPeriodo(mes.periodo)}</dt>
                <dd className="mt-1 text-[1.375rem] font-semibold tabular-nums text-om-navy">
                  {mes.unidades}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
