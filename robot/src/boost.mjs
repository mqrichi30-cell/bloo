// @ts-check
// Pauta pagada ("Promocionar publicación" / "Boost listing") DESPUÉS de publicar, con verificación del monto.
// Reglas de plata (fail-closed):
//   - Solo se paga si la pantalla final muestra EXACTAMENTE el monto pedido (₡500) en CRC.
//   - mode "dry": llega a la pantalla final, verifica, captura y NO pulsa pagar → "simulado".
//   - mode "on": pulsa confirmar UNA sola vez; nunca reintenta. Si ya estaba promocionada, no repite.
//   - Pantalla de agregar tarjeta/método de pago, checkpoint o 2FA → no se ingresa nada → "fallido".
//   - Esta función NUNCA lanza: siempre devuelve un BoostResult (la publicación ya quedó hecha).
import { assertNoCheckpoint } from "./checkpoint.mjs";
import { firstVisible, go, optionLocators, typeInto } from "./facebook.mjs";
import { log, pause, safeUrl, shortError } from "./util.mjs";

/** Tope duro del robot (además del tope diario del servidor). Nunca se paga más que esto. */
export const MAX_BOOST_CRC = 500;

/**
 * @typedef {import('playwright').Page} Page
 * @typedef {import('playwright').Locator} Locator
 * @typedef {import('./api.mjs').Boost} Boost
 * @typedef {import('./api.mjs').BoostResult} BoostResult
 * @typedef {{amount: number, currency: 'CRC'|'USD'|'?', raw: string}} Money
 * @typedef {(page: Page, note: string) => Promise<void>} EvidenceFn
 */

// ---------- funciones puras (testeadas en unit.test.mjs) ----------

/**
 * Valida el boost del payload. null = no pautar.
 * @param {any} raw
 * @returns {null | {ok: true, cfg: Boost} | {ok: false, amountCrc: number, detail: string}}
 */
export function parseBoostConfig(raw) {
  if (raw === null || raw === undefined) return null;
  const amountCrc = Number(raw?.amountCrc);
  const safeAmount = Number.isFinite(amountCrc) ? amountCrc : 0;
  if (raw?.mode !== "dry" && raw?.mode !== "on") return { ok: false, amountCrc: safeAmount, detail: `boost.mode inválido` };
  if (!Number.isInteger(amountCrc) || amountCrc <= 0) return { ok: false, amountCrc: safeAmount, detail: "boost.amountCrc inválido" };
  if (amountCrc > MAX_BOOST_CRC) {
    return { ok: false, amountCrc, detail: `boost.amountCrc ₡${amountCrc} supera el tope del robot (₡${MAX_BOOST_CRC}); no pago` };
  }
  return { ok: true, cfg: { mode: raw.mode, amountCrc } };
}

/**
 * Número con separadores es-CR o en-US: "1.000" → 1000, "500,00" → 500, "1,000.50" → 1000.5.
 * @param {string} raw @returns {number|null}
 */
export function parseAmount(raw) {
  const s = String(raw || "").replace(/[  ]/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let dec = -1;
  if (lastDot >= 0 && lastComma >= 0) dec = Math.max(lastDot, lastComma);
  else {
    const i = Math.max(lastDot, lastComma);
    if (i >= 0) {
      const tail = s.length - i - 1;
      const seps = s.split(s[i]).length - 1;
      // "1.000" / "1.000.000" = miles; "500,00" / "500.5" = decimales
      if (!(tail === 3 && /^\d{1,3}$/.test(s.slice(0, s.indexOf(s[i]))))) dec = i;
      if (seps > 1 && tail === 3) dec = -1;
    }
  }
  const int = (dec >= 0 ? s.slice(0, dec) : s).replace(/[.,]/g, "");
  const frac = dec >= 0 ? s.slice(dec + 1) : "";
  if (!/^\d+$/.test(int) || !/^\d*$/.test(frac)) return null;
  const n = Number(frac ? `${int}.${frac}` : int);
  return Number.isFinite(n) ? n : null;
}

const NUM = "\\d(?:[\\d.,\\u00a0\\u202f]*\\d)?";
const MONEY_RE = new RegExp(`(₡|CRC|US\\$|USD|\\$)\\s?(${NUM})|(${NUM})\\s?(CRC|USD|colones)\\b`, "gi");

/** @param {string} sym @returns {'CRC'|'USD'|'?'} */
const currencyOf = (sym) => (/₡|CRC|colones/i.test(sym) ? "CRC" : /\$|USD/i.test(sym) ? "USD" : "?");

/** Todos los montos con moneda explícita de un texto. @param {string} text @returns {Money[]} */
export function findMoney(text) {
  /** @type {Money[]} */
  const out = [];
  for (const m of String(text || "").matchAll(MONEY_RE)) {
    const sym = m[1] || m[4] || "";
    const amount = parseAmount(m[2] || m[3] || "");
    if (amount !== null) out.push({ amount, currency: currencyOf(sym), raw: m[0].trim() });
  }
  return out;
}

const TOTAL_LABELS = [
  /^\s*(Total( a pagar| del anuncio| de la promoci[oó]n)?|Monto total|Importe total|Gasto total|Total amount|Total spend|Amount due)\b/i,
  /^\s*(Presupuesto total|Total budget|Lifetime budget)\b/i,
];

/**
 * Lee el TOTAL mostrado (misma línea que la etiqueta o la siguiente). null si no hay.
 * @param {string} text @returns {Money|null}
 */
export function readBoostTotal(text) {
  const lines = String(text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const label of TOTAL_LABELS) {
    for (let i = 0; i < lines.length; i++) {
      if (!label.test(lines[i])) continue;
      const same = findMoney(lines[i])[0];
      if (same) return same;
      const next = lines[i + 1] && findMoney(lines[i + 1])[0];
      if (next) return next;
    }
  }
  return null;
}

/** Mínimo exigido por Meta si la pantalla lo dice ("El presupuesto mínimo es ₡1.000"). @param {string} text @returns {Money|null} */
export function readMinimum(text) {
  for (const line of String(text || "").split(/\n+/)) {
    if (!/m[ií]nim[oa]|minimum|al menos|at least/i.test(line)) continue;
    const m = findMoney(line.replace(/^.*?(m[ií]nim[oa]|minimum|al menos|at least)/i, ""))[0];
    if (m) return m;
  }
  return null;
}

const SAVED_METHOD_RE = /(?:[•*·]\s?){2,}\d{4}|terminad[ao] en \d{4}|ending in \d{4}|PayPal|saldo de anuncios|ad credit|prepaid funds/i;
const CARD_STRONG_RE =
  /N[uú]mero de (la )?tarjeta|Card number|\bCVV\b|\bCVC\b|C[oó]digo de seguridad|Security code|Fecha de vencimiento|Expiration date|\bMM\s?\/\s?(AA|YY)\b/i;
const ADD_METHOD_RE =
  /Agregar (una )?(tarjeta|m[eé]todo de pago|forma de pago)|A[nñ]adir (una )?(tarjeta|m[eé]todo de pago|forma de pago)|Add (a )?(card|payment method)|Set up payment|Configura(r)? (un |tu |el )?m[eé]todo de pago/i;

/**
 * ¿La pantalla pide ingresar un método de pago nuevo? Nunca se ingresa nada.
 * @param {{text?: string, hasCardInput?: boolean}} s @returns {string|null}
 */
export function detectPaymentSetup(s) {
  const text = String(s.text || "");
  if (s.hasCardInput) return "Facebook pide datos de tarjeta (campo de tarjeta en pantalla)";
  if (CARD_STRONG_RE.test(text)) return "Facebook pide datos de tarjeta";
  // "Agregar método de pago" junto a un método ya guardado (•••• 1234) es solo un enlace opcional.
  if (ADD_METHOD_RE.test(text) && !SAVED_METHOD_RE.test(text)) return "Facebook pide agregar un método de pago";
  return null;
}

const PROMOTED_RE =
  /Promoci[oó]n (activa|en revisi[oó]n|en curso|programada)|Anuncio (activo|en revisi[oó]n)|Tu (promoci[oó]n|anuncio) (est[aá] (activ[oa]|en revisi[oó]n)|se est[aá] revisando)|Ver resultados( de la promoci[oó]n)?|Publicaci[oó]n promocionada|Boost (is )?(active|in review|scheduled)|Your (boost|ad) is (active|in review|being reviewed)|View (boost )?results|Boosted listing/i;

/** ¿La publicación ya tiene una promoción (activa o en revisión)? @param {string} text */
export const isAlreadyPromoted = (text) => PROMOTED_RE.test(String(text || ""));

const SUBMITTED_RE =
  /En revisi[oó]n|se est[aá] revisando|Promoci[oó]n activa|Anuncio activo|Tu (promoci[oó]n|anuncio) (se envi[oó]|est[aá] activ[oa])|In review|being reviewed|Boost (is )?active|Your boost (was submitted|is active)/i;

// ---------- selectores (UI es-CR con fallback inglés) ----------

const OPEN_RE = /^(Promocionar( publicaci[oó]n| anuncio)?|Impulsar publicaci[oó]n|Boost( listing| post)?)$/i;
const CONFIRM_DIALOG_RE =
  /^(Promocionar ahora|Promocionar publicaci[oó]n|Promocionar|Pagar|Pagar ahora|Confirmar|Confirmar y pagar|Realizar pedido|Publicar anuncio|Boost now|Boost listing|Boost|Pay|Pay now|Confirm|Promote now|Place order)$/i;
const CONFIRM_PAGE_RE =
  /^(Promocionar ahora|Pagar|Pagar ahora|Confirmar|Confirmar y pagar|Realizar pedido|Publicar anuncio|Boost now|Pay|Pay now|Confirm|Promote now|Place order)$/i;
const NEXT_RE = /^(Siguiente|Continuar|Revisar|Next|Continue|Review)$/i;
const BUDGET_RE = /Presupuesto|Monto|Budget|Amount/i;
const TOTAL_MODE_RE = /^(Presupuesto total|Total budget|Lifetime budget)$/i;
const DURATION_RE = /Duraci[oó]n|Duration|D[ií]as|Days/i;

class BoostBlocked extends Error {}

/** @param {Page} p */
async function bodyText(p) {
  return p.evaluate(() => document.body?.innerText || "").catch(() => "");
}

/** Diálogo visible (el último abierto) o la página. @param {Page} p @returns {Promise<Locator>} */
async function scopeOf(p) {
  const dlg = p.getByRole("dialog").last();
  if (await dlg.isVisible().catch(() => false)) return dlg;
  return p.locator("body");
}

/** Checkpoint / 2FA / pedir tarjeta → corta sin ingresar nada. @param {Page} p */
async function guard(p) {
  await assertNoCheckpoint(p);
  const state = await p
    .evaluate(() => ({
      text: (document.body?.innerText || "").slice(0, 20000),
      // Solo campos VISIBLES (Facebook deja nodos ocultos en el DOM).
      hasCardInput: [
        ...document.querySelectorAll(
          'input[autocomplete^="cc-"], input[name*="cardnumber" i], input[name*="card_number" i], input[name*="cvv" i], input[name*="cvc" i], iframe[title*="tarjeta" i], iframe[title*="card" i]'
        ),
      ].some((el) => /** @type {HTMLElement} */ (el).getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"),
    }))
    .catch(() => ({ text: "", hasCardInput: false }));
  const why = detectPaymentSetup(state);
  if (why) throw new BoostBlocked(`${why}; no se ingresó nada`);
}

/** ¿Está marcado un radio/tab/botón conmutador? @param {Locator} l */
async function isSelected(l) {
  const v = await l
    .evaluate((el) => {
      if (el instanceof HTMLInputElement) return el.checked;
      return el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-pressed") === "true";
    })
    .catch(() => false);
  return v === true;
}

/** Elige la duración MÍNIMA disponible (si hay control de duración). @param {Page} p @param {Locator} scope */
async function setMinDuration(p, scope) {
  const ctl = await firstVisible(
    [scope.getByRole("combobox", { name: DURATION_RE }), scope.getByRole("slider", { name: DURATION_RE }), scope.getByLabel(DURATION_RE)],
    1500
  );
  if (!ctl) return "sin control";
  const kind = await ctl.evaluate((el) => (el.tagName === "SELECT" ? "select" : el.getAttribute("role") || el.tagName.toLowerCase())).catch(() => "");
  const days = (/** @type {string} */ t) => {
    const m = t.match(/(\d+)/);
    return m ? Number(m[1]) : Infinity;
  };
  if (kind === "select") {
    const labels = await ctl.evaluate((el) => [.../** @type {HTMLSelectElement} */ (el).options].map((o) => o.label || o.text));
    const min = labels.filter((l) => days(l) !== Infinity).sort((a, b) => days(a) - days(b))[0];
    if (min) await ctl.selectOption({ label: min });
    await pause();
    return min || "sin opciones";
  }
  if (kind === "slider") {
    await ctl.focus();
    await p.keyboard.press("Home");
    await pause();
    return "slider al mínimo";
  }
  if (kind === "combobox" || kind === "button" || kind === "div") {
    await ctl.click();
    await pause();
    const opts = optionLocators(p);
    const n = Math.min(await opts.count(), 40);
    let best = { i: -1, d: Infinity, t: "" };
    for (let i = 0; i < n; i++) {
      const o = opts.nth(i);
      if (!(await o.isVisible().catch(() => false))) continue;
      const t = ((await o.innerText().catch(() => "")) || "").trim();
      if (/d[ií]a|day/i.test(t) && days(t) < best.d) best = { i, d: days(t), t };
    }
    if (best.i >= 0) {
      await opts.nth(best.i).click();
      await pause();
      return best.t;
    }
    await p.keyboard.press("Escape");
    return "sin opciones";
  }
  // textbox / spinbutton numérico
  await typeInto(p, ctl, "1");
  return "1";
}

/**
 * Presupuesto TOTAL = amount, con la duración mínima. Devuelve false si no hay campo de presupuesto en esta pantalla.
 * @param {Page} p @param {Locator} scope @param {number} amount
 */
async function setBudget(p, scope, amount) {
  const totalMode = await firstVisible(
    [scope.getByRole("radio", { name: TOTAL_MODE_RE }), scope.getByRole("tab", { name: TOTAL_MODE_RE }), scope.getByRole("button", { name: TOTAL_MODE_RE })],
    1500
  );
  if (totalMode && !(await isSelected(totalMode))) {
    await totalMode.click();
    await pause();
  }
  const dur = await setMinDuration(p, scope);
  const field = await firstVisible(
    [scope.getByRole("spinbutton", { name: BUDGET_RE }), scope.getByRole("textbox", { name: BUDGET_RE })],
    4000
  );
  if (!field) return false;
  await typeInto(p, field, String(amount));
  await p.keyboard.press("Tab");
  await pause(1500, 3000); // el resumen se recalcula
  const v = await field.inputValue().catch(() => "");
  if (parseAmount(v.replace(/[^\d.,]/g, "")) !== amount) throw new Error(`El campo de presupuesto quedó en "${v}", no ${amount}`);
  log(`pauta: presupuesto ${amount} escrito; duración: ${dur}; modo total: ${totalMode ? "sí" : "no visto"}`);
  return true;
}

/** @param {Money} m */
const fmt = (m) => `${m.currency === "CRC" ? "₡" : m.currency === "USD" ? "US$" : ""}${m.amount} ${m.currency}`;

/** IVA de Costa Rica sobre la pauta: el dueño aprobó pagar el presupuesto + 13 % (2026-10-07). */
export const IVA_PAUTA = 0.13;
/** @param {number} amountCrc */
export const conIva = (amountCrc) => Math.round(amountCrc * (1 + IVA_PAUTA));
/** Total aceptable: CRC y exactamente el presupuesto, o el presupuesto + IVA (±₡2 por redondeo).
 *  @param {{amount: number, currency: string}} t @param {number} amountCrc */
export const totalPermitido = (t, amountCrc) =>
  t.currency === "CRC" && (t.amount === amountCrc || Math.abs(t.amount - conIva(amountCrc)) <= 2);

/**
 * Promociona una publicación ya creada. Nunca lanza.
 * @param {Page} page
 * @param {string} listingUrl
 * @param {Boost} cfg
 * @param {{onEvidence?: EvidenceFn, deadline?: number}} [opts]
 * @returns {Promise<BoostResult>}
 */
export async function promocionar(page, listingUrl, cfg, opts = {}) {
  const amountCrc = cfg.amountCrc;
  const evidence = opts.onEvidence || (async () => {});
  /** @type {Page} */
  let p = page;
  let clicked = false;
  /** @param {BoostResult['status']} status @param {string} [detail] @returns {BoostResult} */
  const res = (status, detail) => ({ status, amountCrc, ...(detail ? { detail: shortError(detail, 300) } : {}) });
  /** @param {string} detail */
  const fail = async (detail) => {
    log(`pauta fallida: ${detail}`);
    await evidence(p, `pauta fallida: ${detail}`);
    return res("fallido", detail);
  };

  if (amountCrc > MAX_BOOST_CRC) return res("fallido", `monto ₡${amountCrc} supera el tope del robot`);
  try {
    await go(p, listingUrl);
    if (isAlreadyPromoted(await bodyText(p))) {
      log("pauta: la publicación ya estaba promocionada; no se repite");
      return cfg.mode === "on" ? res("pagado", "ya estaba promocionada (no se volvió a pagar)") : res("omitido", "ya estaba promocionada");
    }
    const opener = await firstVisible(
      [p.getByRole("button", { name: OPEN_RE }), p.getByRole("link", { name: OPEN_RE }), p.getByText(OPEN_RE)],
      10_000
    );
    if (!opener) return await fail('No encontré "Promocionar publicación" / "Boost listing" en la publicación');

    // El flujo puede abrir diálogo, navegar o abrir pestaña nueva.
    const popup = p.context().waitForEvent("page", { timeout: 6000 }).catch(() => null);
    await opener.click();
    const newPage = await popup;
    if (newPage) {
      p = newPage;
      await p.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(() => {});
    }
    await pause(2000, 4000);

    // Pantalla real de Facebook (verificada 2026-10-07): /ad_center/create/listingad/ con presupuesto
    // DIARIO en opciones fijas (₡465, ₡930…; por defecto ₡1.860) y duración "continua". Pago único =
    // la opción fija más alta ≤ amountCrc + "Elegir fecha de finalización" con 1 día.
    if (/\/ad_center\/create\/listingad/.test(p.url())) {
      await p.waitForLoadState("domcontentloaded").catch(() => {});
      await guard(p);
      const fin = await firstVisible([p.getByRole("radio", { name: /Elegir fecha de finalizaci[oó]n/i })], 15_000);
      if (!fin) return await fail('listingad: no encontré "Elegir fecha de finalización"; no se pagó');
      await fin.click();
      await pause(1500, 2500);
      const dias = await firstVisible([p.locator('input[type="number"]')], 8000);
      if (!dias) return await fail("listingad: no encontré el campo de días; no se pagó");
      const valor = async () => (await dias.inputValue().catch(() => "")).trim();
      await dias.fill("1");
      await dias.press("Tab").catch(() => {});
      await pause(1200, 2000);
      for (let i = 0; i < 10 && (await valor()) !== "1"; i++) {
        const menos = await firstVisible([p.getByRole("button", { name: /^Disminuir$/i })], 2000);
        if (!menos) break;
        await menos.click();
        await pause(400, 800);
      }
      if ((await valor()) !== "1") return await fail(`listingad: la duración quedó en "${await valor()}" días, no 1; no se pagó`);

      // Opción fija más alta que no pase del monto aprobado.
      const radios = p.getByRole("radio");
      /** @type {{i: number, amount: number}|null} */
      let best = null;
      for (let i = 0, n = await radios.count(); i < n; i++) {
        const first = ((await radios.nth(i).innerText().catch(() => "")) || "").split("\n")[0].trim();
        const m = first.match(/^₡\s?([\d.,]+)$/);
        const amt = m ? parseAmount(m[1]) : null;
        if (amt !== null && amt <= amountCrc && (!best || amt > best.amount)) best = { i, amount: amt };
      }
      if (!best) return await fail(`listingad: no hay presupuesto fijo ≤ ₡${amountCrc}; no se pagó`);
      await radios.nth(best.i).click();
      await pause(1500, 2500);
      if ((await radios.nth(best.i).getAttribute("aria-checked").catch(() => null)) === "false") {
        return await fail(`listingad: no quedó seleccionado ₡${best.amount}; no se pagó`);
      }
      await guard(p);

      // Verificación final del "Resumen del pago" justo antes de publicar.
      const text = await bodyText(p);
      const tm = text.match(/Presupuesto total\s*₡\s?([\d.,]+)\s*CRC/i);
      const total = tm ? parseAmount(tm[1]) : null;
      if (total === null) return await fail("listingad: no pude leer el presupuesto total; no se pagó");
      if (total !== best.amount || total > amountCrc) return await fail(`listingad: presupuesto total ₡${total}, esperado ₡${best.amount}; no se pagó`);
      if (!/durante 1 d[ií]a\b/i.test(text) || /circulaci[oó]n continuamente/i.test(text)) {
        return await fail("listingad: el resumen no dice 1 día (podría quedar continua); no se pagó");
      }
      const resumen = `₡${total} CRC por 1 día (+IVA ≈ ₡${conIva(total)})`;
      if (cfg.mode === "dry") {
        log(`pauta dry: ${resumen}; NO se pulsó "Publicar"`);
        await evidence(p, `pauta dry-run: ${resumen}; NO se pulsó "Publicar"`);
        return res("simulado", `${resumen}; "Publicar" sin pulsar`);
      }
      const publicarBtn = await firstVisible([p.getByRole("button", { name: /^Publicar$/i })], 5000);
      if (!publicarBtn) return await fail('listingad: no encontré "Publicar"; no se pagó');
      clicked = true;
      await publicarBtn.click();
      log(`pauta: pulsado "Publicar" (una vez): ${resumen}`);
      const hasta = Date.now() + 45_000;
      let enviada = false;
      while (Date.now() < hasta) {
        await pause(1500, 2500);
        // Confirmación real (2026-10-07): diálogo "Tus anuncios se están creando" · Estado "En revisión".
        const t = await bodyText(p);
        if (/Tus anuncios se est[aá]n creando/i.test(t) || SUBMITTED_RE.test(t)) {
          enviada = true;
          break;
        }
      }
      await evidence(p, `pauta: Publicar pulsado (${resumen})`);
      if (enviada) {
        if (p !== page) await p.close().catch(() => {});
        p = page;
        return res("pagado", `${resumen}; Facebook: anuncio creado, estado "En revisión"`);
      }
      if (p !== page) await p.close().catch(() => {});
      p = page;
      await go(p, listingUrl);
      if (isAlreadyPromoted(await bodyText(p))) return res("pagado", `${resumen}; estado verificado en la publicación`);
      return res("pagado", `SIN VERIFICAR: se pulsó "Publicar" una vez (${resumen}); revisar en Centro de anuncios`);
    }

    let budgetSet = false;
    for (let step = 0; step < 5; step++) {
      await guard(p);
      if (opts.deadline && Date.now() > opts.deadline) return await fail("Sin tiempo en esta corrida antes de confirmar; no se pagó");
      const scope = await scopeOf(p);
      const inDialog = (await scope.evaluate((el) => el.tagName).catch(() => "")) !== "BODY";
      if (!budgetSet) budgetSet = await setBudget(p, scope, amountCrc);
      await guard(p);

      const text = await scope.innerText().catch(() => "");
      const min = readMinimum(text);
      if (min && (min.currency !== "CRC" || min.amount > amountCrc)) {
        return await fail(`Meta exige un mínimo de ${fmt(min)} (pedido ₡${amountCrc}); no se pagó`);
      }
      const total = readBoostTotal(text);
      if (budgetSet && total && !totalPermitido(total, amountCrc)) {
        return await fail(`El total mostrado es ${fmt(total)}, no ₡${amountCrc} CRC; no se pagó`);
      }

      const confirm = await firstVisible([scope.getByRole("button", { name: inDialog ? CONFIRM_DIALOG_RE : CONFIRM_PAGE_RE })], 3000);
      if (confirm) {
        if (!budgetSet) return await fail("No encontré el campo de presupuesto antes de la confirmación; no se pagó");
        // Verificación final, justo antes de pagar.
        const finalText = await scope.innerText().catch(() => "");
        const t = readBoostTotal(finalText);
        if (!t) return await fail("No pude leer el total en la pantalla final; no se pagó");
        if (!totalPermitido(t, amountCrc)) return await fail(`El total final es ${fmt(t)}, no ₡${amountCrc} (ni ₡${conIva(amountCrc)} con IVA) CRC; no se pagó`);
        const btn = ((await confirm.innerText().catch(() => "")) || "").trim();

        if (cfg.mode === "dry") {
          log(`pauta dry: total verificado ${fmt(t)}; NO se pulsó "${btn}"`);
          await evidence(p, `pauta dry-run: total verificado ${fmt(t)}; NO se pulsó "${btn}"`);
          return res("simulado", `total verificado ${fmt(t)}; botón final "${btn}" sin pulsar`);
        }

        // mode "on": UN clic, sin reintentos.
        clicked = true;
        await confirm.click();
        log(`pauta: pulsado "${btn}" (una vez)`);
        const deadline = Date.now() + 40_000;
        while (Date.now() < deadline) {
          await pause(1500, 2500);
          await guard(p);
          if (SUBMITTED_RE.test(await bodyText(p))) return res("pagado", `total ${fmt(t)}; estado: en revisión/activa`);
        }
        // Recargar la publicación (no el flujo de pago) y mirar el estado.
        if (p !== page) await p.close().catch(() => {});
        p = page;
        await go(p, listingUrl);
        if (isAlreadyPromoted(await bodyText(p))) return res("pagado", `total ${fmt(t)}; estado verificado tras recargar`);
        await evidence(p, "pauta: se pulsó pagar una vez pero no vi el estado");
        // Plata: se pulsó → cuenta como pagado (tope diario fail-closed). Nunca se reintenta.
        return res("pagado", `SIN VERIFICAR: se pulsó "${btn}" una vez (total ${fmt(t)}) y no vi "En revisión/Activa"; revisar en Centro de anuncios`);
      }

      const next = await firstVisible([scope.getByRole("button", { name: NEXT_RE })], 3000);
      if (!next) return await fail('No encontré el botón final ni "Siguiente" en la promoción');
      await next.click();
      await pause(1500, 3000);
    }
    return await fail("Demasiados pasos en el flujo de promoción; no se pagó");
  } catch (e) {
    const msg = shortError(e);
    if (clicked && e instanceof BoostBlocked) {
      // Tras el clic Facebook pidió tarjeta/método nuevo: sin método no hay cobro. No se ingresa nada.
      return await fail(`Tras pulsar pagar: ${msg}`);
    }
    if (clicked) {
      await evidence(p, `pauta: error tras pulsar pagar: ${msg}`);
      return res("pagado", `SIN VERIFICAR: se pulsó pagar una vez y luego: ${msg}; revisar en Centro de anuncios (no se reintentó)`);
    }
    if (e?.name === "CheckpointError") return await fail(`necesita_humano: ${msg}`);
    if (e instanceof BoostBlocked) return await fail(msg);
    return await fail(`${msg} (url ${safeUrl(p.url())})`);
  } finally {
    if (p !== page) await p.close().catch(() => {});
  }
}
