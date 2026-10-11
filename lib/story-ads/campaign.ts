// Motor de pasos de UNA campaña de Historias contra Meta Marketing API. Sin
// Prisma: recibe el cliente Graph y una función `guardar` (la persistencia la
// pone lib/story-ads/process.ts), así se testea con mocks.
//
// Pasos (cada id se guarda apenas existe; una corrida cortada sigue en la
// próxima desde donde quedó):
//   1. presupuesto: min_daily_budget de la cuenta → lifetime_budget (1 día),
//      acotado por el tope. Supera el tope → 'fallida', nada creado.
//   2. campaña   (OUTCOME_ENGAGEMENT, PAUSED)
//   3. conjunto  (WHATSAPP / CONVERSATIONS, lifetime_budget, 24 h, solo
//                 historias de IG y FB, CR, edad configurable)
//   4. imagen    (sube los bytes de la variante 'story' 1080x1920)
//   5. creativo  (click-to-WhatsApp, CTA WHATSAPP_MESSAGE)
//   6. anuncio
//   7. activación: SOLO modo 'on' y con cupo diario; 'dry' termina aquí con
//      la campaña PAUSED (no gasta).
//
// IDEMPOTENCIA: campaña, conjunto y anuncio tienen nombre determinístico y se
// BUSCAN por nombre antes de crearlos — siempre, no solo tras un error: un
// POST que cortó por timeout pudo haberse aplicado. Imagen y creativo no se
// buscan: un duplicado huérfano no gasta. La activación consulta el estado en
// Meta antes de (re)intentar. El presupuesto vive en el conjunto (lifetime):
// activar dos veces la misma campaña no duplica gasto.
import type { GraphClient } from "./graph";
import { GraphError } from "./graph";
import { centACrudo, decidirPresupuesto, formatColones, minimoDesdeError, offsetMoneda, validarContraTope } from "./budget";
import { ARRANQUE_MARGEN_MS, DURACION_MS, nombresMeta, type MetaAdsCredenciales, type Segmentacion, type StoryEstado } from "./config";
import type { StoryCopy } from "./copy";

/** Destino de click-to-WhatsApp que documenta Meta para link_data. */
export const WHATSAPP_LINK = "https://api.whatsapp.com/send";
export const INSTAGRAM_LINK = "https://www.instagram.com/bloo_cr/";

export interface CampanaRow {
  id: string;
  listingId: string;
  modo: "dry" | "on";
  presupuestoCent: number | null;
  minimoDiarioCent: number | null;
  moneda: string | null;
  metaCampaignId: string | null;
  metaAdSetId: string | null;
  metaImageHash: string | null;
  metaCreativeId: string | null;
  metaAdId: string | null;
  inicioAt: Date | null;
  finAt: Date | null;
  activadaAt: Date | null;
}

export type CampanaPatch = Partial<Omit<CampanaRow, "id" | "listingId" | "modo">> & { metaStatus?: string | null };

export interface CampanaCtx {
  row: CampanaRow;
  client: GraphClient;
  cred: MetaAdsCredenciales;
  /** Modo del env AHORA (puede haber cambiado desde que se congeló row.modo). */
  modoActual: "off" | "dry" | "on";
  topeCrc: number;
  seg: Segmentacion;
  copy: StoryCopy;
  /** Bytes de la imagen story (JPEG/PNG ya validados). Se llama solo si falta el hash. */
  imagen: () => Promise<Buffer>;
  /** ¿Queda cupo de activaciones hoy (sin contar esta fila)? */
  hayCupoHoy: () => Promise<boolean>;
  guardar: (patch: CampanaPatch) => Promise<void>;
  ahora?: () => Date;
  /** Epoch ms: no se empieza un paso nuevo si queda menos de MARGEN_PASO_MS. */
  deadline: number;
}

export type ResultadoCampana =
  | { estado: Extract<StoryEstado, "dry" | "activa" | "fallida">; detalle: string }
  /** Seguir en otra corrida (sin tiempo, o sin cupo hoy). No gasta intento. */
  | { estado: "pendiente"; detalle: string; reintentarEnMs: number };

const MARGEN_PASO_MS = 2_500;

interface Lista<T> {
  data?: T[];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;
}

function idDe(res: unknown): string {
  const id = str((res as { id?: unknown } | null)?.id);
  if (!id) throw new GraphError("Meta no devolvió id", { status: null, incierto: true });
  return id;
}

export async function avanzarCampana(ctx: CampanaCtx): Promise<ResultadoCampana> {
  const r = ctx.row;
  const now = () => (ctx.ahora ? ctx.ahora() : new Date());
  const names = nombresMeta(r.listingId);
  const sinTiempo = () => ctx.deadline - Date.now() < MARGEN_PASO_MS;
  const seguir = (paso: string): ResultadoCampana => ({ estado: "pendiente", detalle: `sigue en la próxima corrida (${paso})`, reintentarEnMs: 0 });
  const set = async (patch: CampanaPatch) => {
    Object.assign(r, patch);
    await ctx.guardar(patch);
  };

  // ── 1. Presupuesto ──────────────────────────────────────────────────────
  if (r.presupuestoCent === null || !r.moneda) {
    const cuenta = (await ctx.client.get(ctx.cred.adAccountId, { fields: "currency,min_daily_budget,account_status" })) as {
      currency?: unknown;
      min_daily_budget?: unknown;
      account_status?: unknown;
    };
    if (Number(cuenta.account_status) !== 1) {
      // No es terminal: Cris puede reactivar la cuenta (saldo, método de pago).
      throw new GraphError(`la cuenta publicitaria no está activa (account_status=${String(cuenta.account_status)})`, {
        status: null,
        incierto: false,
        transient: true,
      });
    }
    const d = decidirPresupuesto({ minDiarioCrudo: cuenta.min_daily_budget, currency: cuenta.currency, topeCrc: ctx.topeCrc });
    if (!d.ok) return { estado: "fallida", detalle: d.detalle };
    await set({ presupuestoCent: d.cent, minimoDiarioCent: d.minimoCent, moneda: String(cuenta.currency).toUpperCase() });
  }
  const offset = offsetMoneda(r.moneda);
  if (offset === null || r.presupuestoCent === null) return { estado: "fallida", detalle: `moneda ${r.moneda ?? "?"} sin offset conocido` };
  // Re-chequeo del tope en cada corrida: si alguien bajó STORY_ADS_MAX_BUDGET_CRC
  // a mitad, una campaña aún no activada no sigue con el monto viejo.
  const tope = validarContraTope(0, r.presupuestoCent, ctx.topeCrc);
  if (!tope.ok) return { estado: "fallida", detalle: tope.detalle };

  // Modo 'on': no se crea nada en Meta si hoy ya no hay cupo (las fechas del
  // conjunto se fijan al crearlo; crearlo para activarlo mañana lo dejaría vencido).
  if (r.modo === "on" && !r.activadaAt && !r.metaAdSetId && !(await ctx.hayCupoHoy())) {
    return { estado: "pendiente", detalle: "tope diario de campañas alcanzado; sigue mañana", reintentarEnMs: 3600_000 };
  }

  // ── 2. Campaña ──────────────────────────────────────────────────────────
  if (!r.metaCampaignId) {
    if (sinTiempo()) return seguir("campaña");
    const found = (await ctx.client.get(`${ctx.cred.adAccountId}/campaigns`, {
      fields: "id,name,effective_status",
      filtering: [{ field: "name", operator: "EQUAL", value: names.campaign }],
      limit: 5,
    })) as Lista<{ id?: string; name?: string }>;
    const ya = (found.data ?? []).find((c) => c.name === names.campaign && c.id);
    const id = ya?.id
      ? ya.id
      : idDe(
          await ctx.client.post(`${ctx.cred.adAccountId}/campaigns`, {
            name: names.campaign,
            objective: "OUTCOME_ENGAGEMENT",
            status: "PAUSED",
            buying_type: "AUCTION",
            special_ad_categories: [],
            // Sin presupuesto de campaña: el presupuesto vive en el conjunto.
            is_adset_budget_sharing_enabled: false,
          })
        );
    await set({ metaCampaignId: id });
  }

  // ── 3. Conjunto de anuncios ─────────────────────────────────────────────
  if (!r.metaAdSetId) {
    if (sinTiempo()) return seguir("conjunto");
    const found = (await ctx.client.get(`${r.metaCampaignId}/adsets`, {
      fields: "id,name,lifetime_budget,start_time,end_time",
      limit: 10,
    })) as Lista<{ id?: string; name?: string; lifetime_budget?: unknown; start_time?: string; end_time?: string }>;
    const ya = (found.data ?? []).find((a) => a.name === names.adset && a.id);
    if (ya?.id) {
      await set({
        metaAdSetId: ya.id,
        inicioAt: ya.start_time ? new Date(ya.start_time) : r.inicioAt,
        finAt: ya.end_time ? new Date(ya.end_time) : r.finAt,
      });
    } else {
      const inicio = new Date(now().getTime() + ARRANQUE_MARGEN_MS);
      const fin = new Date(inicio.getTime() + DURACION_MS);
      const crear = (crudo: number) =>
        ctx.client.post(`${ctx.cred.adAccountId}/adsets`, {
          name: names.adset,
          campaign_id: r.metaCampaignId,
          lifetime_budget: crudo,
          start_time: inicio.toISOString(),
          end_time: fin.toISOString(),
          billing_event: "IMPRESSIONS",
          optimization_goal: "CONVERSATIONS",
          destination_type: ctx.seg.destino === "whatsapp" ? "WHATSAPP" : "INSTAGRAM_DIRECT",
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          promoted_object: { page_id: ctx.cred.pageId },
          targeting: {
            geo_locations: { countries: ctx.seg.countries },
            age_min: ctx.seg.ageMin,
            age_max: ctx.seg.ageMax,
            publisher_platforms: ["facebook", "instagram"],
            facebook_positions: ["story"],
            instagram_positions: ["story"],
            device_platforms: ["mobile"],
            // Sin Advantage+ audience: respeta la edad tal cual.
            targeting_automation: { advantage_audience: 0 },
          },
          // ACTIVE: no entrega mientras la campaña siga PAUSED (dry).
          status: "ACTIVE",
        });
      const crudo = centACrudo(r.presupuestoCent, offset);
      if (crudo === null) return { estado: "fallida", detalle: "presupuesto no convertible a unidades de Meta" };
      let res: unknown;
      try {
        res = await crear(crudo);
      } catch (e) {
        // "Presupuesto demasiado bajo": Meta dice el mínimo real para este
        // objetivo. Se reintenta UNA vez con ese monto si cabe en el tope.
        // (Un 400 de validación es certero: no se creó nada.)
        if (!(e instanceof GraphError) || e.info.incierto) throw e;
        const minCent = minimoDesdeError([e.info.userMsg, e.info.userTitle, e.message]);
        if (minCent === null || minCent <= r.presupuestoCent) throw e;
        const d = validarContraTope(centACrudo(minCent, offset) ?? -1, minCent, ctx.topeCrc);
        if (!d.ok || d.crudo < 0) return { estado: "fallida", detalle: d.ok ? "mínimo de Meta no convertible" : d.detalle };
        await set({ presupuestoCent: minCent, minimoDiarioCent: minCent });
        res = await crear(d.crudo);
      }
      await set({ metaAdSetId: idDe(res), inicioAt: inicio, finAt: fin });
    }
  }

  // ── 4. Imagen ───────────────────────────────────────────────────────────
  if (!r.metaImageHash) {
    if (sinTiempo()) return seguir("imagen");
    const bytes = await ctx.imagen();
    const res = (await ctx.client.post(
      `${ctx.cred.adAccountId}/adimages`,
      { bytes: bytes.toString("base64") },
      { timeoutMs: 15_000 }
    )) as { images?: Record<string, { hash?: string }> };
    const hash = Object.values(res.images ?? {})[0]?.hash;
    if (!hash) throw new GraphError("Meta no devolvió el hash de la imagen", { status: null, incierto: false, transient: true });
    await set({ metaImageHash: hash });
  }

  // ── 5. Creativo ─────────────────────────────────────────────────────────
  if (!r.metaCreativeId) {
    if (sinTiempo()) return seguir("creativo");
    let ig = ctx.cred.igUserId;
    if (!ig) {
      const page = (await ctx.client.get(ctx.cred.pageId, { fields: "instagram_business_account" })) as {
        instagram_business_account?: { id?: string };
      };
      ig = page.instagram_business_account?.id ?? null;
    }
    if (!ig) return { estado: "fallida", detalle: "la Página no tiene Instagram vinculado (o el token no lo ve); configurar META_IG_USER_ID" };
    const res = await ctx.client.post(`${ctx.cred.adAccountId}/adcreatives`, {
      name: names.creative,
      object_story_spec: {
        page_id: ctx.cred.pageId,
        instagram_user_id: ig,
        link_data: {
          image_hash: r.metaImageHash,
          link: ctx.seg.destino === "whatsapp" ? WHATSAPP_LINK : INSTAGRAM_LINK,
          message: ctx.copy.message,
          name: ctx.copy.headline,
          call_to_action:
            ctx.seg.destino === "whatsapp"
              ? { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } }
              : { type: "INSTAGRAM_MESSAGE", value: { app_destination: "INSTAGRAM_DIRECT" } },
        },
      },
    });
    await set({ metaCreativeId: idDe(res) });
  }

  // ── 6. Anuncio ──────────────────────────────────────────────────────────
  if (!r.metaAdId) {
    if (sinTiempo()) return seguir("anuncio");
    const found = (await ctx.client.get(`${r.metaAdSetId}/ads`, { fields: "id,name", limit: 10 })) as Lista<{ id?: string; name?: string }>;
    const ya = (found.data ?? []).find((a) => a.name === names.ad && a.id);
    const id = ya?.id
      ? ya.id
      : idDe(
          await ctx.client.post(`${ctx.cred.adAccountId}/ads`, {
            name: names.ad,
            adset_id: r.metaAdSetId,
            creative: { creative_id: r.metaCreativeId },
            status: "ACTIVE",
          })
        );
    await set({ metaAdId: id });
  }

  const resumen = `${formatColones(r.presupuestoCent)} total, 1 día (+IVA lo cobra Meta aparte)`;

  // ── 7. Activación ───────────────────────────────────────────────────────
  if (r.modo === "dry") {
    return { estado: "dry", detalle: `dry: campaña creada en PAUSED (${resumen}); no gasta` };
  }
  if (ctx.modoActual !== "on") {
    return { estado: "dry", detalle: `STORY_ADS_MODE pasó a '${ctx.modoActual}' antes de activar: queda PAUSED (${resumen}); no gasta` };
  }
  if (sinTiempo()) return seguir("activación");

  // Estado real en Meta primero: una activación anterior pudo cortar por timeout.
  const camp = (await ctx.client.get(r.metaCampaignId!, { fields: "status,effective_status" })) as { status?: string; effective_status?: string };
  if (camp.status === "ACTIVE") {
    await set({ metaStatus: camp.effective_status ?? camp.status, ...(r.activadaAt ? {} : { activadaAt: now() }) });
    return { estado: "activa", detalle: `activa en Meta (${resumen})` };
  }
  if (r.finAt && now().getTime() >= r.finAt.getTime()) {
    return { estado: "fallida", detalle: "el conjunto venció antes de activarse; quedó PAUSED, no gastó" };
  }

  // Verificación final justo antes de pagar (como boost.mjs): el presupuesto
  // que Meta tiene guardado es el nuestro y cabe en el tope.
  const adset = (await ctx.client.get(r.metaAdSetId!, { fields: "lifetime_budget,daily_budget" })) as {
    lifetime_budget?: unknown;
    daily_budget?: unknown;
  };
  const esperado = centACrudo(r.presupuestoCent, offset);
  const enMeta = Number(adset.lifetime_budget);
  if (esperado === null || enMeta !== esperado || (adset.daily_budget !== undefined && Number(adset.daily_budget) > 0)) {
    return {
      estado: "fallida",
      detalle: `en Meta el conjunto tiene lifetime_budget=${String(adset.lifetime_budget)} (esperado ${esperado}); no se activó`,
    };
  }

  if (!r.activadaAt) {
    if (!(await ctx.hayCupoHoy())) return { estado: "pendiente", detalle: "tope diario alcanzado antes de activar", reintentarEnMs: 3600_000 };
    // Se marca ANTES del POST: cuenta para el tope aunque la respuesta se pierda.
    await set({ activadaAt: now() });
  }
  try {
    await ctx.client.post(r.metaCampaignId!, { status: "ACTIVE" });
  } catch (e) {
    if (!(e instanceof GraphError) || !e.info.incierto) throw e;
    const otra = (await ctx.client.get(r.metaCampaignId!, { fields: "status,effective_status" })) as { status?: string; effective_status?: string };
    if (otra.status !== "ACTIVE") throw e; // la próxima corrida vuelve a consultar antes de intentar
    await set({ metaStatus: otra.effective_status ?? otra.status });
    return { estado: "activa", detalle: `activa en Meta tras verificar (${resumen})` };
  }
  await set({ metaStatus: "ACTIVE" });
  return { estado: "activa", detalle: `activada (${resumen})` };
}

export interface Refresco {
  gastoCent: number | null;
  metaStatus: string | null;
  rechazado: boolean;
}

/** Gasto (Insights) y estado efectivo del anuncio, para campañas activas. */
export async function refrescarCampana(
  client: GraphClient,
  ids: { metaCampaignId: string; metaAdId: string | null },
  gastoACent: (s: unknown) => number | null
): Promise<Refresco> {
  const ins = (await client.get(`${ids.metaCampaignId}/insights`, { fields: "spend", date_preset: "maximum" })) as Lista<{ spend?: unknown }>;
  const filas = ins.data ?? [];
  // Sin filas = sin impresiones todavía = gasto 0.
  const gastoCent = filas.length === 0 ? 0 : gastoACent(filas[0]?.spend);
  let metaStatus: string | null = null;
  if (ids.metaAdId) {
    const ad = (await client.get(ids.metaAdId, { fields: "effective_status" })) as { effective_status?: string };
    metaStatus = ad.effective_status ?? null;
  }
  return { gastoCent, metaStatus, rechazado: metaStatus === "DISAPPROVED" };
}
