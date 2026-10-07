// Disparo inmediato del worker de fotos (workflow imagegen.yml, GitHub
// Actions) cuando se encola un hero nuevo. Decisión del dueño 2026-10-06: la
// foto IA ya no espera el cron de 6 h (GPT es pagado); el único ritmo que se
// mantiene es el del robot de Facebook (110 min entre tareas, tasks.ts).
//
// Mismo mecanismo que netlify/functions/dispatch-actions.mjs (commit 1728bb1):
// POST /actions/workflows/imagegen.yml/dispatches con GH_DISPATCH_TOKEN
// (fine-grained, solo repo bloo, Actions: write). Ese disparador horario
// sigue existiendo como red de seguridad.
//
// Dedupe ENTRE instancias (las funciones de Netlify no comparten memoria):
// AppConfig.imagegenDispatchAt con un UPSERT condicional atómico — a lo sumo
// un disparo por minuto aunque el sync, el panel y el script encolen a la vez.
// Si el disparo HTTP falla, el minuto queda "gastado": lo levanta el próximo
// encolado o el disparador horario. Nunca tira: encolar no puede fallar por
// esto.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const REPO = process.env.GH_REPO?.trim() || "mqrichi30-cell/bloo";
const REF = process.env.GH_DISPATCH_REF?.trim() || "master";
const DEDUPE_SEGUNDOS = 60;

export type DisparoImagegen =
  | { disparado: true; status: number }
  | { disparado: false; motivo: "sin_token" | "dedupe" | "error"; detalle?: string };

export async function dispararImagegen(origen: string): Promise<DisparoImagegen> {
  const token = process.env.GH_DISPATCH_TOKEN?.trim();
  if (!token) {
    console.warn(`[imagegen dispatch] sin GH_DISPATCH_TOKEN (${origen}): queda para el disparador horario`);
    return { disparado: false, motivo: "sin_token" };
  }
  try {
    const filas = await prisma.$queryRaw<{ id: number }[]>`
      INSERT INTO "bloo"."AppConfig" ("id", "imagegenDispatchAt", "updatedAt")
      VALUES (1, timezone('utc', now()), timezone('utc', now()))
      ON CONFLICT ("id") DO UPDATE SET "imagegenDispatchAt" = EXCLUDED."imagegenDispatchAt"
       WHERE "AppConfig"."imagegenDispatchAt" IS NULL
          OR "AppConfig"."imagegenDispatchAt" < timezone('utc', now()) - ${Prisma.raw(`interval '${DEDUPE_SEGUNDOS} seconds'`)}
      RETURNING "id"`;
    if (filas.length === 0) return { disparado: false, motivo: "dedupe" };

    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/imagegen.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: REF, inputs: {} }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (r.status !== 204) {
      const detalle = `HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`;
      console.warn(`[imagegen dispatch] ${origen}: ${detalle}`);
      return { disparado: false, motivo: "error", detalle };
    }
    return { disparado: true, status: r.status };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.warn(`[imagegen dispatch] ${origen}: ${detalle}`);
    return { disparado: false, motivo: "error", detalle };
  }
}
