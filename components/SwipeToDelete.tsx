"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";

const ACTION_WIDTH = 88; // px que se revelan al deslizar
const OPEN_THRESHOLD = ACTION_WIDTH / 2;
const AXIS_LOCK = 8; // px de movimiento antes de decidir si el gesto es horizontal

interface SwipeToDeleteProps {
  children: React.ReactNode;
  onDelete: () => void;
  /** Para lectores de pantalla: "Borrar venta de ₡15.000", etc. */
  deleteLabel: string;
  disabled?: boolean;
}

/**
 * Fila deslizable: se arrastra a la izquierda y aparece un basurero.
 *
 * Detalle que hace o rompe esto en celular: el gesto arranca SIN bloquear el
 * scroll vertical. Hasta que el dedo no se mueve `AXIS_LOCK` px, no se decide
 * el eje; si el movimiento resultó vertical, la fila no se mueve y la lista
 * scrollea normal. Solo cuando el eje queda en horizontal se hace
 * `setPointerCapture` y se toma el control del gesto.
 */
export function SwipeToDelete({ children, onDelete, deleteLabel, disabled = false }: SwipeToDeleteProps) {
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"none" | "x" | "y">("none");
  const containerRef = useRef<HTMLDivElement>(null);

  function handlePointerDown(e: React.PointerEvent) {
    if (disabled) return;
    start.current = { x: e.clientX, y: e.clientY };
    axis.current = "none";
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (disabled || !start.current) return;

    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;

    if (axis.current === "none") {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis.current === "x") {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }
    }
    if (axis.current !== "x") return;

    const base = open ? -ACTION_WIDTH : 0;
    // Solo hacia la izquierda: el tope derecho es 0 (nada que revelar de ese lado).
    setOffset(Math.max(-ACTION_WIDTH, Math.min(0, base + dx)));
  }

  function handlePointerUp() {
    start.current = null;
    if (axis.current !== "x") {
      axis.current = "none";
      return;
    }
    axis.current = "none";
    setDragging(false);
    const shouldOpen = offset <= -OPEN_THRESHOLD;
    setOpen(shouldOpen);
    setOffset(shouldOpen ? -ACTION_WIDTH : 0);
  }

  function close() {
    setOpen(false);
    setOffset(0);
  }

  return (
    <div ref={containerRef} className="relative overflow-hidden">
      {/* Capa de acción: vive detrás y solo se ve por lo que la fila destapa. */}
      <div className="absolute inset-y-0 right-0 flex items-stretch">
        <button
          type="button"
          aria-label={deleteLabel}
          tabIndex={open ? 0 : -1}
          onClick={() => {
            close();
            onDelete();
          }}
          style={{ width: ACTION_WIDTH }}
          className="flex items-center justify-center bg-error-text text-white transition-transform active:scale-[0.97]"
        >
          <Trash2 size={20} />
        </button>
      </div>

      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        // Deja pasar el scroll vertical al navegador y reserva el horizontal para el gesto.
        style={{ transform: `translateX(${offset}px)`, touchAction: "pan-y" }}
        className={`relative bg-white ${dragging ? "" : "transition-transform duration-200 ease-out"}`}
      >
        {children}
      </div>
    </div>
  );
}
