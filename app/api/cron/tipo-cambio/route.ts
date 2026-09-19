// Cron del tipo de cambio: camino DETERMINISTA de actualización.
//
// POR QUÉ existe: hasta 2026-09-19 el TC solo se refrescaba de rebote, cuando
// alguien abría Panel o Ajustes, y el error se tragaba con `.catch(() => {})`.
// Resultado: la fuente murió el 13-ago y nadie se enteró en 37 días. Acá el
// refresh corre solo (netlify/functions/tipo-cambio.mjs, 12:30 UTC L-V) y
// SIEMPRE loguea `result.error` cuando falla — ese log es la mitad del arreglo.
//
// AUTH: si existe la env var CRON_SECRET, se exige el header `x-cron-secret`
// con ese valor. Si NO existe, la ruta queda abierta. Es a propósito: el
// endpoint no expone datos de negocio (devuelve el TC, que ya se muestra
// público en la app) y no acepta input; lo peor que logra un tercero es
// gastar un fetch a una API gratis. Poner CRON_SECRET en Netlify (y en la
// función programada) lo cierra sin tocar código.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshTipoCambioIfNeeded } from "@/lib/tipo-cambio-bac";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected && request.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    // `force: true` para no depender del chequeo de "ya se actualizó hoy",
    // pero respetando un valor puesto a mano hoy: si Cris fijó el TC esta
    // mañana, el cron no se lo pisa (ver lib/tipo-cambio-bac.ts).
    const result = await refreshTipoCambioIfNeeded(prisma, { force: true, respetarManualDeHoy: true });

    if (result.error) {
      console.error("[cron tipo-cambio] FALLÓ el refresh:", result.error, "— se mantiene", result.tipoCambioUsdCent);
      return NextResponse.json({ ok: false, ...result }, { status: 502 });
    }

    console.log(
      `[cron tipo-cambio] ok refreshed=${result.refreshed} valor=${result.tipoCambioUsdCent} fuente=${result.tipoCambioFuente}`
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("[cron tipo-cambio] excepción:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
