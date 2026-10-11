// Tests de la lógica de plata de las campañas de Historias (lib/story-ads).
// Sin red ni base: Graph API mockeado.
//   npx tsx --test tests/story-ads.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirPresupuesto, gastoACent, minimoDesdeError, formatColones } from "@/lib/story-ads/budget";
import {
  TOPE_DURO_CRC,
  disparaCampana,
  metaAdsCredenciales,
  nombresMeta,
  storyAdsMaxPorDia,
  storyAdsMode,
  topeCampanaCrc,
  type MetaAdsCredenciales,
} from "@/lib/story-ads/config";
import { avanzarCampana, type CampanaCtx, type CampanaRow } from "@/lib/story-ads/campaign";
import { GraphError, type GraphClient, type GraphParams } from "@/lib/story-ads/graph";
import { storyCopy } from "@/lib/story-ads/copy";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

// ── Config / topes ─────────────────────────────────────────────────────────
test("modo: default dry, inválido = off (fail-closed)", () => {
  assert.equal(storyAdsMode(env({})), "dry");
  assert.equal(storyAdsMode(env({ STORY_ADS_MODE: "ON" })), "on");
  assert.equal(storyAdsMode(env({ STORY_ADS_MODE: "si" })), "off");
});

test("tope diario: default 1, inválido = 0", () => {
  assert.equal(storyAdsMaxPorDia(env({})), 1);
  assert.equal(storyAdsMaxPorDia(env({ STORY_ADS_MAX_PER_DAY: "3" })), 3);
  assert.equal(storyAdsMaxPorDia(env({ STORY_ADS_MAX_PER_DAY: "tres" })), 0);
  assert.equal(storyAdsMaxPorDia(env({ STORY_ADS_MAX_PER_DAY: "-1" })), 0);
});

test("tope por campaña: el env solo puede bajarlo", () => {
  assert.equal(topeCampanaCrc(env({})), TOPE_DURO_CRC);
  assert.equal(topeCampanaCrc(env({ STORY_ADS_MAX_BUDGET_CRC: "1000" })), 1000);
  assert.equal(topeCampanaCrc(env({ STORY_ADS_MAX_BUDGET_CRC: "999999" })), TOPE_DURO_CRC);
  assert.equal(topeCampanaCrc(env({ STORY_ADS_MAX_BUDGET_CRC: "abc" })), TOPE_DURO_CRC);
});

test("credenciales: faltan → null; act_ se normaliza", () => {
  assert.equal(metaAdsCredenciales(env({ META_ADS_ACCESS_TOKEN: "x" })), null);
  const c = metaAdsCredenciales(env({ META_ADS_ACCESS_TOKEN: "x", META_AD_ACCOUNT_ID: "123", META_PAGE_ID: "456" }));
  assert.equal(c?.adAccountId, "act_123");
  assert.equal(metaAdsCredenciales(env({ META_ADS_ACCESS_TOKEN: "x", META_AD_ACCOUNT_ID: "act_x", META_PAGE_ID: "456" })), null);
});

test("disparo: solo 'publicar'; reemplazar con opt-in; off nunca", () => {
  assert.equal(disparaCampana("publicar", env({})), true);
  assert.equal(disparaCampana("reemplazar", env({})), false);
  assert.equal(disparaCampana("reemplazar", env({ STORY_ADS_INCLUIR_REEMPLAZO: "1" })), true);
  assert.equal(disparaCampana("quitar", env({})), false);
  assert.equal(disparaCampana("publicar", env({ STORY_ADS_MODE: "off" })), false);
});

// ── Presupuesto ────────────────────────────────────────────────────────────
test("presupuesto = mínimo diario de Meta, en céntimos", () => {
  const d = decidirPresupuesto({ minDiarioCrudo: 465, currency: "CRC", topeCrc: 2000 });
  assert.deepEqual(d, { ok: true, crudo: 465, cent: 46_500, minimoCent: 46_500 });
  const s = decidirPresupuesto({ minDiarioCrudo: "1860", currency: "crc", topeCrc: 2000 });
  assert.equal(s.ok && s.cent, 186_000);
});

test("presupuesto: mínimo sobre el tope → no se crea", () => {
  const d = decidirPresupuesto({ minDiarioCrudo: 2001, currency: "CRC", topeCrc: 2000 });
  assert.equal(d.ok, false);
  // Offset equivocado (Meta en céntimos) cae del lado seguro: ₡46.500 > tope.
  assert.equal(decidirPresupuesto({ minDiarioCrudo: 46_500, currency: "CRC", topeCrc: 2000 }).ok, false);
});

test("presupuesto: moneda distinta o mínimo inválido → no se crea", () => {
  assert.equal(decidirPresupuesto({ minDiarioCrudo: 100, currency: "USD", topeCrc: 2000 }).ok, false);
  assert.equal(decidirPresupuesto({ minDiarioCrudo: 0, currency: "CRC", topeCrc: 2000 }).ok, false);
  assert.equal(decidirPresupuesto({ minDiarioCrudo: 1.5, currency: "CRC", topeCrc: 2000 }).ok, false);
  assert.equal(decidirPresupuesto({ minDiarioCrudo: undefined, currency: "CRC", topeCrc: 2000 }).ok, false);
});

test("mínimo desde el error de Meta", () => {
  assert.equal(minimoDesdeError(["Your budget is too low. The minimum budget is ₡930."]), 110_000); // +10 % → ₡1.100
  assert.equal(minimoDesdeError(["El presupuesto mínimo es CRC 1.860"]), 210_000);
  assert.equal(minimoDesdeError(["Invalid parameter"]), null);
  assert.equal(minimoDesdeError(["minimum is 930"]), null); // sin moneda: no se adivina
});

test("gasto de Insights a céntimos sin float", () => {
  assert.equal(gastoACent("465"), 46_500);
  assert.equal(gastoACent("465.37"), 46_537);
  assert.equal(gastoACent("0.1"), 10);
  assert.equal(gastoACent("abc"), null);
  assert.equal(formatColones(186_000), "₡1.860");
});

test("copy: sin 'importados', acetato solo si está confirmado", () => {
  const sin = storyCopy({ nombre: "Osa", color: "Carey", material: null });
  assert.doesNotMatch(sin.message, /importad|acetato|pl[aá]stico/i);
  assert.match(sin.message, /₡17\.500/);
  const con = storyCopy({ nombre: "Osa", color: "Carey", material: "acetato" });
  assert.match(con.message, /Marco de acetato/);
});

// ── Motor de campaña con Graph mockeado ────────────────────────────────────
const CRED: MetaAdsCredenciales = { accessToken: "t", adAccountId: "act_1", pageId: "61594704154063", igUserId: "17841" };
const LISTING = "lst-1";
const N = nombresMeta(LISTING);

interface Llamada {
  m: "GET" | "POST";
  path: string;
  params: GraphParams;
}

type Handler = (params: GraphParams) => unknown;

class MockGraph implements GraphClient {
  llamadas: Llamada[] = [];
  campaignStatus = "PAUSED";
  adsetBudget: number | null = null;
  existentes: { campaign?: string; adset?: string; ad?: string } = {};
  overrides: Record<string, Handler> = {};
  minDaily: unknown = 465;

  async get(path: string, params: GraphParams = {}) {
    this.llamadas.push({ m: "GET", path, params });
    const o = this.overrides[`GET ${path}`];
    if (o) return o(params);
    if (path === "act_1") return { currency: "CRC", min_daily_budget: this.minDaily, account_status: 1 };
    if (path === "act_1/campaigns") return { data: this.existentes.campaign ? [{ id: this.existentes.campaign, name: N.campaign }] : [] };
    if (path.endsWith("/adsets"))
      return { data: this.existentes.adset ? [{ id: this.existentes.adset, name: N.adset, start_time: "2026-10-10T12:00:00Z", end_time: "2026-10-11T12:00:00Z" }] : [] };
    if (path.endsWith("/ads")) return { data: this.existentes.ad ? [{ id: this.existentes.ad, name: N.ad }] : [] };
    if (path === "camp-1") return { status: this.campaignStatus, effective_status: this.campaignStatus };
    if (path === "adset-1") return { lifetime_budget: String(this.adsetBudget) };
    throw new Error(`GET inesperado ${path}`);
  }

  async post(path: string, params: GraphParams) {
    this.llamadas.push({ m: "POST", path, params });
    const o = this.overrides[`POST ${path}`];
    if (o) return o(params);
    if (path === "act_1/campaigns") return { id: "camp-1" };
    if (path === "act_1/adsets") {
      this.adsetBudget = Number(params.lifetime_budget);
      return { id: "adset-1" };
    }
    if (path === "act_1/adimages") return { images: { bytes: { hash: "hash-1" } } };
    if (path === "act_1/adcreatives") return { id: "cr-1" };
    if (path === "act_1/ads") return { id: "ad-1" };
    if (path === "camp-1") {
      this.campaignStatus = String(params.status);
      return { success: true };
    }
    throw new Error(`POST inesperado ${path}`);
  }

  posts(path?: string) {
    return this.llamadas.filter((l) => l.m === "POST" && (path === undefined || l.path === path));
  }
}

function filaNueva(modo: "dry" | "on"): CampanaRow {
  return {
    id: "c1",
    listingId: LISTING,
    modo,
    presupuestoCent: null,
    minimoDiarioCent: null,
    moneda: null,
    metaCampaignId: null,
    metaAdSetId: null,
    metaImageHash: null,
    metaCreativeId: null,
    metaAdId: null,
    inicioAt: null,
    finAt: null,
    activadaAt: null,
  };
}

function ctxDe(g: MockGraph, row: CampanaRow, o: Partial<CampanaCtx> = {}) {
  const guardados: Array<Record<string, unknown>> = [];
  const ctx: CampanaCtx = {
    row,
    client: g,
    cred: CRED,
    modoActual: row.modo,
    topeCrc: 2000,
    seg: { ageMin: 18, ageMax: 45, countries: ["CR"], destino: "whatsapp" },
    copy: { message: "m", headline: "h" },
    imagen: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]),
    hayCupoHoy: async () => true,
    guardar: async (p) => {
      guardados.push({ ...p });
    },
    ahora: () => new Date("2026-10-10T12:00:00Z"),
    deadline: Date.now() + 60_000,
    ...o,
  };
  return { ctx, guardados };
}

test("dry: crea todo PAUSED con lifetime_budget = mínimo y NUNCA activa", async () => {
  const g = new MockGraph();
  const { ctx } = ctxDe(g, filaNueva("dry"));
  const r = await avanzarCampana(ctx);
  assert.equal(r.estado, "dry");
  const camp = g.posts("act_1/campaigns")[0];
  assert.equal(camp.params.status, "PAUSED");
  const adset = g.posts("act_1/adsets")[0].params;
  assert.equal(adset.lifetime_budget, 465);
  assert.equal(adset.destination_type, "WHATSAPP");
  const t = adset.targeting as { facebook_positions: string[]; instagram_positions: string[]; publisher_platforms: string[] };
  assert.deepEqual(t.facebook_positions, ["story"]);
  assert.deepEqual(t.instagram_positions, ["story"]);
  assert.equal(new Date(String(adset.end_time)).getTime() - new Date(String(adset.start_time)).getTime(), 24 * 3600_000);
  const cr = g.posts("act_1/adcreatives")[0].params as { object_story_spec: { link_data: { call_to_action: { type: string } } } };
  assert.equal(cr.object_story_spec.link_data.call_to_action.type, "WHATSAPP_MESSAGE");
  assert.equal(g.posts("camp-1").length, 0, "dry no toca el estado de la campaña");
  assert.equal(g.campaignStatus, "PAUSED");
});

test("mínimo de Meta sobre el tope → fallida sin crear NADA", async () => {
  const g = new MockGraph();
  g.minDaily = 5000;
  const { ctx } = ctxDe(g, filaNueva("on"));
  const r = await avanzarCampana(ctx);
  assert.equal(r.estado, "fallida");
  assert.match(r.detalle, /supera el tope/);
  assert.equal(g.posts().length, 0);
});

test("idempotencia: si la campaña/conjunto/anuncio ya existen en Meta (por nombre), no se recrean", async () => {
  const g = new MockGraph();
  g.existentes = { campaign: "camp-1", adset: "adset-1", ad: "ad-1" };
  g.adsetBudget = 465;
  const { ctx } = ctxDe(g, filaNueva("dry"));
  const r = await avanzarCampana(ctx);
  assert.equal(r.estado, "dry");
  assert.equal(g.posts("act_1/campaigns").length, 0);
  assert.equal(g.posts("act_1/adsets").length, 0);
  assert.equal(g.posts("act_1/ads").length, 0);
});

test("siempre consulta por nombre ANTES de crear campaña, conjunto y anuncio", async () => {
  const g = new MockGraph();
  const { ctx } = ctxDe(g, filaNueva("dry"));
  await avanzarCampana(ctx);
  const idx = (m: string, p: string) => g.llamadas.findIndex((l) => l.m === m && l.path === p);
  assert.ok(idx("GET", "act_1/campaigns") < idx("POST", "act_1/campaigns"));
  assert.ok(idx("GET", "camp-1/adsets") < idx("POST", "act_1/adsets"));
  assert.ok(idx("GET", "adset-1/ads") < idx("POST", "act_1/ads"));
});

test("on: activa UNA vez, marca activadaAt antes del POST", async () => {
  const g = new MockGraph();
  const orden: string[] = [];
  const { ctx } = ctxDe(g, filaNueva("on"), {
    guardar: async (p) => {
      if ("activadaAt" in p) orden.push("activadaAt");
    },
  });
  const post = g.post.bind(g);
  g.post = async (path, params) => {
    if (path === "camp-1") orden.push("POST activar");
    return post(path, params);
  };
  const r = await avanzarCampana(ctx);
  assert.equal(r.estado, "activa");
  assert.deepEqual(orden, ["activadaAt", "POST activar"]);
  assert.equal(g.posts("camp-1").length, 1);
});

test("on sin cupo diario: no crea nada en Meta", async () => {
  const g = new MockGraph();
  const { ctx } = ctxDe(g, filaNueva("on"), { hayCupoHoy: async () => false });
  const r = await avanzarCampana(ctx);
  assert.equal(r.estado, "pendiente");
  assert.equal(g.posts().length, 0);
});

test("activación incierta: consulta Meta y NO repite el POST", async () => {
  const g = new MockGraph();
  let n = 0;
  g.overrides["POST camp-1"] = () => {
    n++;
    throw new GraphError("timeout", { status: null, incierto: true });
  };
  const { ctx } = ctxDe(g, filaNueva("on"));
  await assert.rejects(() => avanzarCampana(ctx), GraphError);
  assert.equal(n, 1, "un solo POST de activación");
  // Próxima corrida: Meta dice que en realidad quedó ACTIVE → 'activa' sin otro POST.
  g.campaignStatus = "ACTIVE";
  const r = await avanzarCampana(ctx);
  assert.equal(r.estado, "activa");
  assert.equal(n, 1);
  assert.equal(g.posts("act_1/campaigns").length, 1, "la campaña no se recreó");
});

test("corrida reanudada con ids guardados: cero creaciones", async () => {
  const g = new MockGraph();
  g.adsetBudget = 465;
  const row: CampanaRow = {
    ...filaNueva("dry"),
    presupuestoCent: 46_500,
    minimoDiarioCent: 46_500,
    moneda: "CRC",
    metaCampaignId: "camp-1",
    metaAdSetId: "adset-1",
    metaImageHash: "hash-1",
    metaCreativeId: "cr-1",
    metaAdId: "ad-1",
  };
  const { ctx } = ctxDe(g, row);
  assert.equal((await avanzarCampana(ctx)).estado, "dry");
  assert.equal(g.posts().length, 0);
});

test("Meta rechaza por presupuesto bajo: reintenta UNA vez con su mínimo si cabe en el tope", async () => {
  const g = new MockGraph();
  let n = 0;
  g.overrides["POST act_1/adsets"] = (p) => {
    n++;
    if (Number(p.lifetime_budget) < 930) {
      throw new GraphError("HTTP 400", { status: 400, incierto: false, userMsg: "Your budget is too low. The minimum budget is ₡930." });
    }
    g.adsetBudget = Number(p.lifetime_budget);
    return { id: "adset-1" };
  };
  const { ctx, guardados } = ctxDe(g, filaNueva("dry"));
  const r = await avanzarCampana(ctx);
  assert.equal(r.estado, "dry");
  assert.equal(n, 2);
  assert.ok(guardados.some((p) => p.presupuestoCent === 110_000));
});

test("Meta exige un mínimo sobre el tope en el error → fallida, sin activar", async () => {
  const g = new MockGraph();
  g.overrides["POST act_1/adsets"] = () => {
    throw new GraphError("HTTP 400", { status: 400, incierto: false, userMsg: "The minimum budget is ₡5.000" });
  };
  const { ctx } = ctxDe(g, filaNueva("on"));
  const r = await avanzarCampana(ctx);
  assert.equal(r.estado, "fallida");
  assert.equal(g.posts("camp-1").length, 0);
});

test("on: si STORY_ADS_MODE cambió antes de activar, queda PAUSED", async () => {
  const g = new MockGraph();
  const { ctx } = ctxDe(g, filaNueva("on"), { modoActual: "dry" });
  const r = await avanzarCampana(ctx);
  assert.equal(r.estado, "dry");
  assert.equal(g.posts("camp-1").length, 0);
});

test("on: presupuesto en Meta distinto al nuestro → no activa", async () => {
  const g = new MockGraph();
  g.overrides["GET adset-1"] = () => ({ lifetime_budget: "9999" });
  const { ctx } = ctxDe(g, filaNueva("on"));
  const r = await avanzarCampana(ctx);
  assert.equal(r.estado, "fallida");
  assert.equal(g.posts("camp-1").length, 0);
});

test("sin tiempo en la corrida: corta antes de crear, sin gastar intento", async () => {
  const g = new MockGraph();
  const { ctx } = ctxDe(g, filaNueva("dry"), { deadline: Date.now() });
  const r = await avanzarCampana(ctx);
  assert.equal(r.estado, "pendiente");
  assert.equal(g.posts().length, 0);
});

test("minimoDesdeError: título y monto separados, 'más de' estricto", async () => {
  const { minimoDesdeError } = await import("../lib/story-ads/budget");
  assert.equal(
    minimoDesdeError([
      "El presupuesto del conjunto de anuncios debe ser de más de ₡900. En caso contrario, es posible que los anuncios no se entreguen.",
      "Presupuesto demasiado bajo",
      "Invalid parameter",
    ]),
    100000 // ₡901 + 10 % → ₡1.000
  );
});
