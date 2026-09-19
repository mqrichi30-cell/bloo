import { Fragment } from "react";
import { Token } from "./Token";

export type Segment = string | { token: string };

/** Renderiza texto con <Token/> intercalado, para pasajes con variables pendientes. */
export function Rich({ segments, tone }: { segments: Segment[]; tone?: "light" | "dark" }) {
  return (
    <>
      {segments.map((seg, i) =>
        typeof seg === "string" ? (
          <Fragment key={i}>{seg}</Fragment>
        ) : (
          <Token key={i} name={seg.token} tone={tone} />
        )
      )}
    </>
  );
}
