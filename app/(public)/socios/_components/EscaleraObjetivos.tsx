"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./EscaleraObjetivos.module.css";

/**
 * `umbral` arrives in three possible shapes ahead of accounting validation:
 * - a resolved number
 * - an unresolved template token (e.g. "{{META1_UMBRAL}}"), still a string
 * - null, when there is no confirmed figure yet — shown as "Por confirmar",
 *   never as 0 or an invented number.
 */
type UmbralValue = number | string | null;

interface Objetivo {
  nivel: number;
  nombre: string;
  umbral: UmbralValue;
  plazo: string;
  promesa: string;
  comprobacion: string;
  estado: "en-progreso" | "futuro";
}

interface EscaleraObjetivosProps {
  objetivos: Objetivo[];
}

function resolveUmbral(umbral: UmbralValue): {
  text: string;
  variant: "number" | "token" | "pending";
} {
  if (typeof umbral === "number" && Number.isFinite(umbral)) {
    return { text: umbral.toLocaleString("es-CR"), variant: "number" };
  }
  if (typeof umbral === "string" && umbral.trim() !== "") {
    return { text: umbral.trim(), variant: "token" };
  }
  return { text: "Por confirmar", variant: "pending" };
}

/* ---------------------------------------------------------------------- *
 * Geometry: the staircase is drawn, not simulated with boxes at different
 * heights. No piso anymore — a level that's already true today isn't a
 * step, per the owner. There's still a short, unlabeled flat run at the
 * very bottom (BASE_RUN) so the staircase visibly sits on a floor instead
 * of floating; it carries no content and isn't one of the objetivos.
 *
 * N peldaños are laid out on one shared canvas so the front profile
 * (floor -> riser -> tread -> riser -> tread ...) is a single continuous
 * polyline, computed from objetivos.length so it stays correct however
 * many steps there are (tuned to read best at the current real shape: 3).
 * ---------------------------------------------------------------------- */

const CANVAS_W = 900;
const CANVAS_H = 340;
const BASE_RUN = 70; // flat floor run before the first riser — staging, not a zone
const FLOOR_H = 8;
const RISE_STEP = 90;
const LINE_DURATION = 1.5; // seconds, the full climb line draw

interface ZoneGeo {
  x0: number;
  x1: number;
  topY: number;
  estado: "en-progreso" | "futuro";
}

interface ZoneTiming {
  delay: number;
  duration: number;
}

function buildStaircase(objetivos: Objetivo[]) {
  const n = objetivos.length;

  if (n === 0) {
    // Nothing to draw but the floor. Safe, not broken.
    return {
      zones: [] as ZoneGeo[],
      timings: [] as ZoneTiming[],
      pathD: `M 0 ${CANVAS_H} L ${CANVAS_W} ${CANVAS_H}`,
      markerPoints: [] as [number, number][],
    };
  }

  const stepWidth = (CANVAS_W - BASE_RUN) / n;
  const zones: ZoneGeo[] = objetivos.map((o, i) => ({
    x0: BASE_RUN + i * stepWidth,
    x1: BASE_RUN + (i + 1) * stepWidth,
    topY: CANVAS_H - (i + 1) * RISE_STEP,
    estado: o.estado,
  }));

  // Walk the profile once: floor stub, then riser+tread per zone. Each
  // zone's length window includes the riser that climbs INTO it, so
  // corners always join exactly (this zone's riser ends exactly where
  // its own tread starts, which is exactly where the next riser begins).
  const points: [number, number][] = [
    [0, CANVAS_H],
    [BASE_RUN, CANVAS_H],
  ];
  const zoneLength: number[] = zones.map(() => 0);
  let cursor: [number, number] = points[1];

  zones.forEach((zone, i) => {
    if (i === 0) zoneLength[0] += BASE_RUN; // the floor stub belongs to zone 0's reveal window

    const riserLen = Math.abs(cursor[1] - zone.topY);
    zoneLength[i] += riserLen;
    points.push([cursor[0], zone.topY]);
    cursor = [cursor[0], zone.topY];

    const topLen = zone.x1 - cursor[0];
    zoneLength[i] += topLen;
    points.push([zone.x1, zone.topY]);
    cursor = [zone.x1, zone.topY];
  });

  const total = zoneLength.reduce((sum, l) => sum + l, 0) || 1;
  const timings: ZoneTiming[] = [];
  let acc = 0;
  zoneLength.forEach((len) => {
    const startFrac = acc / total;
    const duration = Math.max((len / total) * LINE_DURATION, 0.28);
    timings.push({ delay: startFrac * LINE_DURATION, duration });
    acc += len;
  });

  const pathD = `M ${points.map(([x, y]) => `${x} ${y}`).join(" L ")}`;

  // Marker landing points: center of each zone's own tread.
  const markerPoints: [number, number][] = zones.map((zone, i) => {
    const startX = i === 0 ? BASE_RUN : zones[i - 1].x1;
    return [(startX + zone.x1) / 2, zone.topY];
  });

  return { zones, timings, pathD, markerPoints };
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

export function EscaleraObjetivos({ objetivos }: EscaleraObjetivosProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  // Defensive: a data issue upstream should degrade gracefully (an empty
  // staircase), never crash the page.
  const safeObjetivos = objetivos ?? [];

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
      { threshold: 0.25 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [reducedMotion]);

  const { zones, timings, pathD, markerPoints } = useMemo(
    () => buildStaircase(safeObjetivos),
    [safeObjetivos]
  );

  const gridTemplateColumns =
    zones.length > 0
      ? zones.map((z) => `${((z.x1 - z.x0) / CANVAS_W).toFixed(4)}fr`).join(" ")
      : "1fr";

  const rootClassName = [styles.panel, inView ? styles.inView : ""].filter(Boolean).join(" ");

  return (
    <div ref={rootRef} className={rootClassName}>
      {/* ---------- the staircase: the drawn object, not a box ----------
          Fixed intrinsic size (aspect-ratio + min/max-height in CSS), so
          this never depends on the text column below to give it height. */}
      <div className={styles.stage}>
        <svg
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          preserveAspectRatio="none"
          className={styles.stageSvg}
          aria-hidden="true"
        >
          <rect
            x={0}
            y={CANVAS_H - FLOOR_H}
            width={CANVAS_W}
            height={FLOOR_H}
            className={styles.floor}
          />

          {zones.map((zone, i) => {
            const timing = timings[i];
            const style = {
              "--zone-delay": `${timing.delay}s`,
              "--zone-duration": `${timing.duration}s`,
            } as CSSProperties;
            return (
              <rect
                key={`step-${i}`}
                x={zone.x0}
                y={zone.topY}
                width={zone.x1 - zone.x0}
                height={CANVAS_H - zone.topY}
                className={styles.stepBlock}
                data-estado={zone.estado}
                style={style}
              />
            );
          })}

          <path
            d={pathD}
            className={styles.climbLine}
            pathLength={100}
            fill="none"
            style={{ "--line-duration": `${LINE_DURATION}s` } as CSSProperties}
          />

          {markerPoints.length >= 2 && (
            <circle
              r={7}
              className={markerPoints.length === 3 ? styles.marker3 : styles.marker2}
              style={
                {
                  "--p0x": `${markerPoints[0][0]}px`,
                  "--p0y": `${markerPoints[0][1]}px`,
                  "--p1x": `${markerPoints[1][0]}px`,
                  "--p1y": `${markerPoints[1][1]}px`,
                  "--p2x": `${markerPoints[markerPoints.length - 1][0]}px`,
                  "--p2y": `${markerPoints[markerPoints.length - 1][1]}px`,
                  "--line-duration": `${LINE_DURATION}s`,
                } as CSSProperties
              }
            />
          )}
        </svg>
      </div>

      {/* ---------- the facts: unboxed, always in the DOM, no hover ---------- */}
      <div className={styles.info} style={{ gridTemplateColumns } as CSSProperties}>
        {safeObjetivos.map((o, i) => {
          const umbralInfo = resolveUmbral(o.umbral);
          const timing = timings[i];
          return (
            <div
              key={o.nivel}
              className={styles.infoGroup}
              data-kind="peldano"
              data-estado={o.estado}
              style={{ "--zone-delay": `${timing?.delay ?? 0}s` } as CSSProperties}
            >
              <div className={styles.groupMeta}>
                <p className={styles.groupLabel}>Peldaño {o.nivel}</p>
                <span className={styles.estadoBadge} data-estado={o.estado}>
                  <span className={styles.estadoDot} data-estado={o.estado} aria-hidden="true" />
                  {o.estado === "en-progreso" ? "En progreso" : "Meta futura"}
                </span>
              </div>

              <p className={styles.umbralLabel}>Umbral</p>
              <p
                className={styles.umbralValue}
                data-estado={o.estado}
                data-variant={umbralInfo.variant}
              >
                <span className={umbralInfo.variant === "number" ? "tabular-nums" : undefined}>
                  {umbralInfo.text}
                </span>
              </p>

              <h3 className={styles.groupNombre}>{o.nombre}</h3>
              <p className={styles.groupPromesa}>{o.promesa}</p>

              <hr className={styles.groupRule} />

              <dl className={styles.groupFooter}>
                <div className={styles.footerItem}>
                  <dt className={styles.footLabel}>Plazo</dt>
                  <dd className={styles.footValue}>{o.plazo}</dd>
                </div>
                <div className={styles.footerItem}>
                  <dt className={styles.footLabel}>Comprobación</dt>
                  <dd className={styles.footValue}>{o.comprobacion}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}
