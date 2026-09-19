import { TOKEN_NOTES } from "./tokenNotes";

/**
 * Marca visible de una variable pendiente (docs/COPY_SOCIOS.md §2 — "el
 * frontend las deja como tokens"). Nunca un número inventado: un placeholder
 * legible, con el nombre real del token en el `title` para quien haga QA.
 *
 * `tone` deriva el color de la sección donde vive: "dark" para texto sobre
 * fondo navy (om-brassSoft, ya verificado AA ahí), "light" para fondo
 * bone/cream/white (om-brassInk, el derivado oscuro — brass crudo no pasa
 * AA de cuerpo sobre claro).
 */
export function Token({ name, tone = "light" }: { name: string; tone?: "light" | "dark" }) {
  const note = TOKEN_NOTES[name] ?? "Pendiente";
  const colorClass = tone === "dark" ? "text-om-brassSoft" : "text-om-brassInk";
  return (
    <span
      className={`whitespace-nowrap border-b border-dashed border-current/60 ${colorClass}`}
      data-token={name}
      title={`{{${name}}} — ${note}`}
    >
      por confirmar
    </span>
  );
}
