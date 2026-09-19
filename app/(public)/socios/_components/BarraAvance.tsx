"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./BarraAvance.module.css";

/**
 * BarraAvance — una varilla de acetato renderizada en SVG (resolución
 * independiente: nítida en cualquier pantalla y cualquier zoom), llena de
 * material desde abajo conforme sube el promedio.
 *
 * Tercer rediseño, 2026-08-16. Historial de rechazos, no se repiten:
 * 1ª vuelta — cápsula plana con etiquetas ancladas por altura que se
 * encimaban. Fix permanente: ningún texto se posiciona por altura sobre la
 * varilla. Cero `bottom: X%` en etiquetas — esa es la causa raíz del bug,
 * no un detalle de spacing. Todo el texto vive en `.stats`, una pila
 * vertical simple que no puede colisionar sin importar los valores. La
 * varilla solo lleva UNA marca visual sin texto adjunto (el mes en curso).
 * 2ª vuelta — caras de CSS 3D giradas (`preserve-3d`/`rotateY`): el canto
 * leía como una franja plana pegada al costado, un segundo objeto en vez
 * del espesor del primero, y el resultado se veía facetado/blocado, no
 * nítido. Fix: se abandonó la geometría rotada. El volumen ahora es
 * enteramente renderizado — un degradado horizontal continuo (sombra →
 * brillo especular → sombra) simula la curvatura de un cilindro, con la
 * MISMA estructura de paradas de color en el canal (navy) y el llenado
 * (latón) para que se lean como una sola pieza bajo una sola luz, nunca
 * como dos piezas pegadas. Solo CSS anima transform/opacity sobre esta
 * geometría; el objeto en sí es material renderizado, no caras giradas.
 *
 * Reusable y sin conocimiento de negocio: todas las etiquetas y los meses
 * incluidos llegan por props ya formateados.
 */

const VB_W = 64;
const VB_H = 240;
const ROD_X = 8;
const ROD_Y = 6;
const ROD_W = 48;
const ROD_H = 228;
const ROD_RX = 24;

export interface BarraAvanceMesEnCurso {
  /** Ya formateado, ej. "agosto 2026". */
  etiqueta: string;
  unidades: number;
}

export interface BarraAvanceProps {
  /** Nivel de llenado. `null` = sin dato confiable (falla de consulta o cero meses cerrados). */
  promedio: number | null;
  /** Tope de referencia, mostrado como "de {meta}" junto al número protagonista. */
  meta: number;
  /**
   * `promedio / meta` ya acotado [0,1] por el backend — úsalo tal cual
   * llega, no lo recalcules salvo que falte (entonces se deriva aquí como
   * respaldo, con el mismo acotado).
   */
  fraccionAvance?: number | null;
  /** Marca secundaria, distinta del promedio, siempre etiquetada como parcial. */
  mesEnCurso?: BarraAvanceMesEnCurso | null;
  /** Etiquetas ya formateadas de los meses que componen `promedio`, ej. ["julio 2026"]. */
  mesesIncluidos?: string[];
  etiquetaPromedio: string;
  etiquetaMeta: string;
  etiquetaMesEnCurso: string;
  /** Canal navy (fondo oscuro) o hueso (fondo claro). Default: navy. */
  tone?: "navy" | "bone";
  className?: string;
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

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), 1);
}

function formatUnits(value: number): string {
  return Math.round(value).toLocaleString("es-CR");
}

function formatMesesIncluidos(mesesIncluidos: string[] | undefined): string | null {
  if (!mesesIncluidos || mesesIncluidos.length === 0) return null;
  const n = mesesIncluidos.length;
  const noun = n === 1 ? "mes" : "meses";
  const range = n === 1 ? mesesIncluidos[0] : `${mesesIncluidos[0]} – ${mesesIncluidos[n - 1]}`;
  return `${n} ${noun} cerrado${n === 1 ? "" : "s"} · ${range}`;
}

export function BarraAvance({
  promedio,
  meta,
  fraccionAvance,
  mesEnCurso,
  mesesIncluidos,
  etiquetaPromedio,
  etiquetaMeta,
  etiquetaMesEnCurso,
  tone = "navy",
  className,
}: BarraAvanceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const headingId = useId();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const hasData = typeof promedio === "number" && Number.isFinite(promedio);
  const promedioValue = hasData ? (promedio as number) : 0;
  const safeMeta = meta > 0 ? meta : 1;
  const cursoUnits =
    mesEnCurso && Number.isFinite(mesEnCurso.unidades) ? mesEnCurso.unidades : null;

  // La varilla entera (contenedor "crudo" + material acumulado) escala con
  // margen por encima del mayor de los tres valores: así el desborde
  // (promedio > meta) tiene adónde ir sin reventar el tope, y un llenado
  // chico (6%) igual queda legible sin inflarlo.
  const topValue = Math.max(safeMeta, promedioValue, cursoUnits ?? 0) * 1.15;
  const fillFraction = hasData ? clamp01(promedioValue / topValue) : 0;
  const cursoFraction = cursoUnits !== null ? clamp01(cursoUnits / topValue) : null;

  // `fraccionAvance` (o su respaldo derivado) no se pinta directo — no hay
  // línea de meta sobre la varilla — pero decide el estado "cumplido", que
  // sí es visible (status pill + línea de desborde).
  const relativeFraction =
    typeof fraccionAvance === "number"
      ? clamp01(fraccionAvance)
      : hasData
        ? clamp01(promedioValue / safeMeta)
        : 0;
  const achieved = hasData && relativeFraction >= 1;
  const overshootPct = achieved ? Math.round((promedioValue / safeMeta - 1) * 100) : 0;

  const [displayValue, setDisplayValue] = useState(hasData ? promedioValue : 0);

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
      { threshold: 0.35 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [reducedMotion]);

  useEffect(() => {
    if (!hasData) {
      setDisplayValue(0);
      return;
    }
    if (!inView || reducedMotion) {
      setDisplayValue(promedioValue);
      return;
    }
    setDisplayValue(0);
    const duration = 1150;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4); // ease-out-quart
      setDisplayValue(promedioValue * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reducedMotion, hasData, promedioValue]);

  const captionText = formatMesesIncluidos(mesesIncluidos);

  // Geometría en coordenadas del viewBox — se calcula acá, no en CSS, para
  // que el llenado y la marca del mes en curso queden en su posición final
  // exacta en el markup. La animación de entrada solo escala/mueve esa
  // geometría ya calculada (transform/opacity), nunca recalcula layout.
  const fillPxHeight = Math.max(fillFraction * ROD_H, 0);
  const fillY = ROD_Y + ROD_H - fillPxHeight;
  const cursoCy =
    cursoFraction !== null
      ? Math.min(Math.max(ROD_Y + ROD_H - cursoFraction * ROD_H, ROD_Y + 9), ROD_Y + ROD_H - 9)
      : null;

  const shellGradId = `barra-shell-${uid}`;
  const fillGradId = `barra-fill-${uid}`;
  const capGradId = `barra-cap-${uid}`;
  const sweepGradId = `barra-sweep-${uid}`;
  const clipId = `barra-clip-${uid}`;

  const rootClassName = [styles.root, inView ? styles.inView : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      data-tone={tone}
      data-has-data={hasData}
      data-achieved={achieved}
    >
      <div className={styles.body}>
        <div className={styles.rodStage}>
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className={styles.svg}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={Math.round(safeMeta)}
            aria-valuenow={hasData ? Math.round(promedioValue) : undefined}
            aria-labelledby={headingId}
            aria-valuetext={
              hasData
                ? `${formatUnits(promedioValue)} ${etiquetaPromedio.toLowerCase()}, de ${formatUnits(meta)} (${etiquetaMeta.toLowerCase()})`
                : "Sin dato confiable todavía"
            }
          >
            <defs>
              {/* Un solo degradado horizontal por material simula la curvatura
                  del cilindro: sombra en los bordes, brillo especular donde el
                  bisel toma la luz. Canal y llenado comparten la MISMA
                  estructura de paradas para leerse como una sola pieza. */}
              <linearGradient id={shellGradId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#050716" />
                <stop offset="15%" stopColor="#121840" />
                <stop offset="30%" stopColor="#232c5e" />
                <stop offset="41%" stopColor="#4c5588" />
                <stop offset="54%" stopColor="#242c5c" />
                <stop offset="72%" stopColor="#121740" />
                <stop offset="100%" stopColor="#050716" />
              </linearGradient>
              <linearGradient id={fillGradId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#4a3a20" />
                <stop offset="15%" stopColor="#6b562f" />
                <stop offset="30%" stopColor="#93773f" />
                <stop offset="41%" stopColor="#ddc998" />
                <stop offset="54%" stopColor="#a98a52" />
                <stop offset="72%" stopColor="#6b562f" />
                <stop offset="100%" stopColor="#4a3a20" />
              </linearGradient>
              <linearGradient id={capGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f6f3ea" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#f6f3ea" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={sweepGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f6f3ea" stopOpacity="0" />
                <stop offset="50%" stopColor="#f6f3ea" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#f6f3ea" stopOpacity="0" />
              </linearGradient>
              <clipPath id={clipId}>
                <rect x={ROD_X} y={ROD_Y} width={ROD_W} height={ROD_H} rx={ROD_RX} />
              </clipPath>
            </defs>

            {/* Canal — el único elemento navy de toda la sección. */}
            <rect
              x={ROD_X}
              y={ROD_Y}
              width={ROD_W}
              height={ROD_H}
              rx={ROD_RX}
              fill={`url(#${shellGradId})`}
            />
            <rect
              x={ROD_X + 0.5}
              y={ROD_Y + 0.5}
              width={ROD_W - 1}
              height={ROD_H - 1}
              rx={ROD_RX - 0.5}
              fill="none"
              stroke="rgba(246,243,234,0.14)"
              strokeWidth="1"
            />

            <g clipPath={`url(#${clipId})`}>
              {/* Llenado — el material acumulado. Se dibuja ya en su posición
                  final; el grupo entero escala 0→1 desde la base (transform,
                  no layout), así que el "tope" que se ve en cada momento de
                  la animación coincide siempre con la geometría real. */}
              <g className={styles.fillGroup}>
                <rect x={ROD_X} y={fillY} width={ROD_W} height={fillPxHeight} fill={`url(#${fillGradId})`} />
                {fillPxHeight > 2 && (
                  <rect x={ROD_X} y={fillY} width={ROD_W} height="5" fill={`url(#${capGradId})`} />
                )}
              </g>

              {/* Barrido de luz — una sola pasada al llenar, nunca un loop. */}
              <rect
                className={styles.sweep}
                x={ROD_X}
                y={ROD_Y}
                width={ROD_W}
                height={ROD_H}
                fill={`url(#${sweepGradId})`}
              />
            </g>

            {cursoCy !== null && (
              <circle
                className={styles.cursoNotch}
                cx={VB_W / 2}
                cy={cursoCy}
                r="5"
                fill="none"
                stroke="#f6f3ea"
                strokeWidth="1.5"
                strokeDasharray="2.5 2.5"
              />
            )}
          </svg>
        </div>

        <div className={styles.stats}>
          <h4 id={headingId} className={styles.kicker}>
            {etiquetaPromedio}
          </h4>
          {hasData ? (
            <p className={styles.bigNumber}>
              <span className="tabular-nums">{formatUnits(displayValue)}</span>
              <span className={styles.bigNumberOf}>
                de <span className="tabular-nums">{formatUnits(meta)}</span>
              </span>
            </p>
          ) : (
            <p className={styles.bigNumberEmpty}>Sin dato confiable todavía</p>
          )}
          {captionText && <p className={styles.caption}>{captionText}</p>}
          {mesEnCurso && cursoFraction !== null && (
            <p className={styles.subline}>
              <span className={styles.sublineDot} aria-hidden="true" />
              {etiquetaMesEnCurso} · {mesEnCurso.etiqueta} ·{" "}
              <span className="tabular-nums">{formatUnits(mesEnCurso.unidades)}</span>
            </p>
          )}
          {achieved && (
            <p className={styles.subline}>
              <span className={styles.sublineDot} aria-hidden="true" data-warm="true" />
              +{overshootPct}% sobre la meta
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
