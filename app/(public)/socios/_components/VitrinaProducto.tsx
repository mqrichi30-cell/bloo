"use client";

import Image from "next/image";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./VitrinaProducto.module.css";

/**
 * Un modelo mostrado en el carrusel. `file` es el nombre dentro de
 * /public/socios/ (sin slash inicial: "lente-01.jpg"), no una ruta.
 * `width`/`height` son las dimensiones reales del archivo — el componente
 * las usa para next/image y no las inventa.
 */
export interface VitrinaProductoModelo {
  file: string;
  /** Alt completo y descriptivo, mismo criterio que GALERIA_PRODUCTO en _content.ts. */
  alt: string;
  /** Nombre corto del modelo/colada, ej. "Champán sobre teca". */
  nombre: string;
  /** Una línea, ej. "Colada transparente, lente ámbar." */
  descripcion: string;
  width: number;
  height: number;
}

export interface VitrinaProductoProps {
  /** 2–6 modelos. Con 1 el carrusel se muestra sin controles de navegación útiles. */
  modelos: VitrinaProductoModelo[];
  /** aria-label del grupo de carrusel. Default: "Modelos bloo". */
  etiquetaGrupo?: string;
  /** Clase opcional para el panel raíz (margen/posición desde el llamador). */
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

/** Offset normalizado de i respecto a active, en el rango [-count/2, count/2]. */
function getOffset(i: number, active: number, count: number) {
  let offset = i - active;
  if (offset > count / 2) offset -= count;
  if (offset < -count / 2) offset += count;
  return offset;
}

const PREV_ICON_PATH = "M10 3 5 8l5 5";
const NEXT_ICON_PATH = "M6 3l5 5-5 5";

export function VitrinaProducto({ modelos, etiquetaGrupo = "Modelos bloo", className }: VitrinaProductoProps) {
  const count = modelos.length;
  const [active, setActive] = useState(0);
  const [pointer, setPointer] = useState({ x: 50, y: 42 });
  const reducedMotion = usePrefersReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef<number | null>(null);
  const captionId = useId();
  // Nadie tocaba el carrusel porque nada en pantalla decía "esto se mueve".
  // En vez de un cartel, se lo mostramos una vez: al entrar en viewport, el
  // propio carrusel avanza y vuelve solo (mismo mecanismo que un swipe real,
  // no un efecto CSS aparte). Se cancela si la persona ya interactuó antes
  // de que corra, y no se repite nunca en la misma carga de página.
  const autoPreview = useRef({ done: false, interacted: false });

  function markInteracted() {
    autoPreview.current.interacted = true;
  }

  // Si el llamador cambia la cantidad de modelos, no dejar `active` apuntando
  // fuera de rango.
  useEffect(() => {
    setActive((a) => (a >= count ? 0 : a));
  }, [count]);

  function goTo(i: number) {
    if (count === 0) return;
    setActive(((i % count) + count) % count);
  }

  function handleStageKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") {
      markInteracted();
      goTo(active - 1);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      markInteracted();
      goTo(active + 1);
      e.preventDefault();
    }
  }

  function handleStagePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    markInteracted();
    dragStartX.current = e.clientX;
  }

  // Arrastre/swipe: pointerup se escucha en window porque el puntero puede
  // salir del stage antes de soltarse (igual que el prototipo).
  useEffect(() => {
    function handlePointerUp(e: PointerEvent) {
      if (dragStartX.current === null) return;
      const dx = e.clientX - dragStartX.current;
      if (Math.abs(dx) > 40) goTo(active + (dx < 0 ? 1 : -1));
      dragStartX.current = null;
    }
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, count]);

  // Nadie descubría que el carrusel se mueve: no hay affordance de arrastre
  // visible hasta que se prueba. En vez de un cartel ("arrástrame"), se lo
  // demostramos una sola vez, con el propio movimiento real del carrusel —
  // avanza y vuelve apenas entra en pantalla. Se cancela si la persona ya
  // interactuó, no corre bajo prefers-reduced-motion, y no se repite.
  useEffect(() => {
    if (reducedMotion || count < 2) return;
    const node = panelRef.current;
    if (!node) return;
    let advanceId: number | undefined;
    let returnId: number | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || autoPreview.current.done) continue;
          autoPreview.current.done = true;
          advanceId = window.setTimeout(() => {
            if (autoPreview.current.interacted) return;
            setActive((a) => (a + 1) % count);
          }, 700);
          returnId = window.setTimeout(() => {
            if (autoPreview.current.interacted) return;
            setActive(0);
          }, 1550);
          io.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    io.observe(node);
    return () => {
      io.disconnect();
      window.clearTimeout(advanceId);
      window.clearTimeout(returnId);
    };
  }, [reducedMotion, count]);

  // Brillo especular + glow ambiental siguiendo el puntero: solo con motion
  // completo y solo si el dispositivo puede hacer hover (nada de esto en
  // touch, y nada bajo prefers-reduced-motion).
  useEffect(() => {
    if (reducedMotion) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (!window.matchMedia("(hover: hover)").matches) return;
    function handleMouseMove(e: MouseEvent) {
      const rect = panel!.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * 100;
      const py = ((e.clientY - rect.top) / rect.height) * 100;
      setPointer({ x: px, y: py });
    }
    panel.addEventListener("mousemove", handleMouseMove);
    return () => panel.removeEventListener("mousemove", handleMouseMove);
  }, [reducedMotion]);

  if (count === 0) return null;

  const activo = modelos[active];

  return (
    <div
      ref={panelRef}
      className={[styles.panel, className].filter(Boolean).join(" ")}
      style={{ "--gx": `${pointer.x}%`, "--gy": `${pointer.y}%` } as CSSProperties}
    >
      <div className={styles.glow} aria-hidden="true" />

      <div
        className={styles.stage}
        role="group"
        aria-roledescription="carrusel"
        aria-label={etiquetaGrupo}
        tabIndex={0}
        onKeyDown={handleStageKeyDown}
        onPointerDown={handleStagePointerDown}
      >
        <div className={styles.track}>
          {modelos.map((m, i) => {
            const offset = getOffset(i, active, count);
            const isActive = offset === 0;
            const posClass =
              offset === 0
                ? styles.posActive
                : offset === -1
                  ? styles.posLeft
                  : offset === 1
                    ? styles.posRight
                    : styles.posHidden;

            return (
              <div
                key={m.file}
                className={`${styles.card} ${posClass}`}
                role="img"
                aria-label={`${m.nombre}. ${m.descripcion}`}
                onClick={() => {
                  if (i !== active) {
                    markInteracted();
                    goTo(i);
                  }
                }}
                style={isActive ? ({ "--sx": `${pointer.x}%`, "--sy": `${pointer.y}%` } as CSSProperties) : undefined}
              >
                <div className={styles.face}>
                  <Image
                    src={`/socios/${m.file}`}
                    alt=""
                    width={m.width}
                    height={m.height}
                    sizes="(min-width: 960px) 210px, 44vw"
                    className={styles.photo}
                    priority={i === 0}
                    loading={i === 0 ? "eager" : "lazy"}
                  />
                  <div className={styles.sheen} aria-hidden="true" />
                </div>
                <div className={styles.edge} aria-hidden="true" />
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.stageBtn}
          aria-label="Modelo anterior"
          onClick={() => {
            markInteracted();
            goTo(active - 1);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d={PREV_ICON_PATH} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className={styles.midGroup}>
          <div className={styles.dots} role="group" aria-label="Ir a un modelo">
            {modelos.map((m, i) => (
              <button
                key={m.file}
                type="button"
                className={styles.dot}
                aria-label={`Ir a ${m.nombre}`}
                aria-current={i === active}
                onClick={() => {
                  markInteracted();
                  goTo(i);
                }}
              />
            ))}
          </div>

          {/* Cuenta los modelos sin dar una instrucción — "hay 3, esta es
              la 2" se lee de un vistazo y ya dice que hay más que ver. */}
          <p className={styles.counter} aria-hidden="true">
            <span className="tabular-nums">{String(active + 1).padStart(2, "0")}</span>
            <span className={styles.counterSep}>/</span>
            <span className="tabular-nums">{String(count).padStart(2, "0")}</span>
          </p>
        </div>

        <button
          type="button"
          className={styles.stageBtn}
          aria-label="Siguiente modelo"
          onClick={() => {
            markInteracted();
            goTo(active + 1);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d={NEXT_ICON_PATH} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className={styles.caption} id={captionId} aria-live="polite">
        <p className={styles.name}>{activo.nombre}</p>
        <p className={styles.desc}>{activo.descripcion}</p>
      </div>
    </div>
  );
}
