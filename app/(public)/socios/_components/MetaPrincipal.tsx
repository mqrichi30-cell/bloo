"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./MetaPrincipal.module.css";
import { BarraAvance, type BarraAvanceMesEnCurso } from "./BarraAvance";

interface MetaPrincipalProps {
  /** Umbral mensual de venta que dispara el cambio de material. */
  meta: number;
  /**
   * Promedio mensual actual de lentes vendidos: `promedioDisponible` del
   * endpoint, sobre los meses cerrados que existen de verdad (nunca diluido
   * con meses previos a la primera venta). `null` solo cuando la consulta
   * falla o no hay ningún mes cerrado — nunca 0 por error. Nunca se trata
   * como 0.
   */
  actual: number | null;
  /** Describe la métrica (ej. "Promedio de lentes vendidos por mes"). Usada como encabezado. */
  etiqueta: string;
  /** Frase de la promesa de marca (ej. "Cuando lleguemos ahí, migramos a acetato biodegradable."). */
  promesa: string;
  /** `promedio / meta` ya acotado [0,1] por el backend. Pasa directo a BarraAvance. */
  fraccionAvance?: number | null;
  /** Marca secundaria del mes en curso, siempre parcial. */
  mesEnCurso?: BarraAvanceMesEnCurso | null;
  /** Meses ya formateados que componen `actual`, ej. ["julio 2026"]. */
  mesesIncluidos?: string[];
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);
  return reduced;
}

/** Safe formatter: never call toLocaleString on a value that might not exist. */
function formatUnits(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-CR");
}

/**
 * Bloque protagonista de #meta-1. Historial:
 * 1ª vuelta — envolvía una ilustración SVG de lentes que a ese tamaño leía
 * como placeholder; se sacó.
 * 2ª vuelta — el dueño rechazó el panel navy que envolvía todo el bloque:
 * "quiero que este cuadro azul deje de existir, lo único azul debe ser la
 * barra". Se sacó el panel por completo: sin fondo propio, sin borde, sin
 * padding de "tarjeta" — el bloque vive directo sobre el fondo claro de la
 * sección (`bg-om-cream` en MetaUno.tsx). El único elemento navy de toda
 * la sección es <BarraAvance/> misma (su canal). Todo el texto que antes
 * era claro-sobre-navy se invirtió a tinta navy sobre claro — ver
 * MetaPrincipal.module.css para el detalle de contraste de cada pieza.
 */
export function MetaPrincipal({
  meta,
  actual,
  etiqueta,
  promesa,
  fraccionAvance,
  mesEnCurso,
  mesesIncluidos,
}: MetaPrincipalProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const headingId = useId();

  // `actual` can legitimately be null (no closed month with sales yet) or,
  // if the API ever misbehaves, undefined. Both mean "no data", never "zero".
  const hasData = typeof actual === "number" && Number.isFinite(actual);
  const achieved = hasData && meta > 0 && (actual as number) >= meta;
  const restante = hasData ? Math.max(meta - (actual as number), 0) : 0;

  // Trigger once on scroll into view — drives this panel's own fade/settle.
  // <BarraAvance/> observes the viewport independently for its own reveal.
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    if (reducedMotion) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.3 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [reducedMotion]);

  const rootClassName = [styles.root, inView ? styles.inView : ""].filter(Boolean).join(" ");

  return (
    <div ref={rootRef} className={rootClassName} data-has-data={hasData} aria-labelledby={headingId}>
      <div className={styles.root__inner}>
        <h2 id={headingId} className={styles.kicker}>
          {etiqueta}
        </h2>

        {hasData ? (
          <>
            <BarraAvance
              promedio={actual}
              meta={meta}
              fraccionAvance={fraccionAvance ?? null}
              mesEnCurso={mesEnCurso ?? null}
              mesesIncluidos={mesesIncluidos}
              etiquetaPromedio="Promedio mensual"
              etiquetaMeta="Meta"
              etiquetaMesEnCurso="Mes en curso (parcial)"
              tone="bone"
              className={styles.barra}
            />

            <p className={styles.statusPill} data-estado={achieved ? "cumplido" : "camino"}>
              <span className={styles.statusDot} aria-hidden="true" />
              {achieved ? "Compromiso cumplido" : "En camino"}
            </p>

            <p className={styles.promesa}>
              {achieved ? (
                promesa
              ) : (
                <>
                  Faltan{" "}
                  <strong className="tabular-nums">{formatUnits(restante)}</strong> al mes
                  para cumplirla: {promesa}
                </>
              )}
            </p>
          </>
        ) : (
          // `actual` (= promedioDisponible del endpoint) solo llega null si
          // la consulta falla o no existe ningún mes cerrado con ventas
          // reales. Mismo peso tipográfico y mismo espacio que el contador
          // lleno; nada de ícono de advertencia ni gris apagado.
          <div className={styles.emptyState}>
            <p className={styles.emptyHeadline}>Todavía no hay ningún mes cerrado con ventas.</p>
            <p className={styles.emptyBody}>
              Publicamos el promedio disponible en cuanto exista al menos un mes cerrado con
              ventas reales, aunque sea uno solo — nunca inventamos un número mientras tanto.
            </p>
            <p className={styles.emptyClose}>
              Preferimos enseñarle un contador vacío antes que un número que todavía no
              significa nada.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
