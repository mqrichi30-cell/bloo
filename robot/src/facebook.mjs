// @ts-check
// Flujos de Facebook Marketplace (UI es-CR). Clicks y teclado reales; selectores accesibles.
import { assertNoCheckpoint } from "./checkpoint.mjs";
import { pause, typingDelay, log, safeUrl } from "./util.mjs";

export const FB_BASE = "https://www.facebook.com";
const NAV_TIMEOUT = 45_000;

/**
 * @typedef {import('playwright').Page} Page
 * @typedef {import('playwright').Locator} Locator
 * @typedef {{base?: string, dryRun?: boolean}} FlowOpts
 */

/** Primer locator visible de una lista de candidatos. @param {Locator[]} candidates @param {number} [timeout] */
async function firstVisible(candidates, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const c of candidates) {
      const l = c.first();
      if (await l.isVisible().catch(() => false)) return l;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

/** @param {Page} page @param {string} url */
async function go(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await pause(1500, 3000);
  await assertNoCheckpoint(page);
}

/** Limpia el campo y escribe como humano. @param {Page} page @param {Locator} field @param {string} text */
async function typeInto(page, field, text) {
  await field.click();
  await pause(300, 800);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await field.pressSequentially(text, { delay: typingDelay(), timeout: 90_000 });
  await pause();
}

/** Valor actual de un input/textarea/contenteditable. @param {Locator} field */
async function fieldValue(field) {
  return field.evaluate((el) =>
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : /** @type {HTMLElement} */ (el).innerText
  );
}

/** Normaliza saltos de línea/espacios finales para comparar. @param {string} s */
const norm = (s) => s.replace(/\r\n?/g, "\n").replace(/ /g, " ").trim();

/**
 * Texto largo: insertText en 2–4 trozos con pausas cortas (tipear char a char tarda demasiado).
 * Verifica que el valor final sea exactamente el texto (saltos de línea incluidos).
 * @param {Page} page @param {Locator} field @param {string} text
 */
async function insertLongText(page, field, text) {
  await field.click({ timeout: 90_000 });
  await pause(300, 800);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  const parts = Math.min(4, Math.max(2, Math.ceil(text.length / 250)));
  const size = Math.ceil(text.length / parts);
  for (let i = 0; i < text.length; i += size) {
    await page.keyboard.insertText(text.slice(i, i + size));
    await pause(300, 900);
  }
  let got = await fieldValue(field).catch(() => "");
  if (norm(got) !== norm(text)) {
    // Un reintento con fill() (dispara input de React) antes de rendirse.
    await field.fill(text, { timeout: 90_000 }).catch(() => {});
    await pause();
    got = await fieldValue(field).catch(() => "");
  }
  if (norm(got) !== norm(text)) {
    throw new Error(`La descripción quedó incompleta (${norm(got).length}/${norm(text).length} caracteres)`);
  }
  await pause();
}

/** @param {Page} page @param {RegExp} name */
function fieldByName(page, name) {
  return [
    page.getByRole("textbox", { name }),
    page.getByLabel(name),
    page.locator("label").filter({ hasText: name }).locator("input, textarea"),
  ];
}

/** Normaliza/valida una URL de publicación de Marketplace. @param {string} raw @param {string} base */
export function normalizeItemUrl(raw, base = FB_BASE) {
  let u;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  const m = u.pathname.match(/\/marketplace\/item\/(\d+)/);
  if (!m) return null;
  const baseHost = new URL(base).hostname;
  if (!/(^|\.)facebook\.com$/i.test(u.hostname) && u.hostname !== baseHost) return null;
  return `${base}/marketplace/item/${m[1]}/`;
}

/** Normaliza un título para comparar EXACTO (solo colapsa espacios; respeta mayúsculas y acentos). @param {string} s */
export const cleanTitle = (s) => String(s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

/**
 * Lee "Tus publicaciones" (página ya abierta) y devuelve los ids de las tarjetas cuyo título es
 * EXACTAMENTE `title`, y cuántos textos exactos hay en total (para detectar tarjetas sin enlace).
 * Nunca usa coincidencia parcial: los listados manuales del dueño ("Lentes de sol Bloo") no deben tocarse.
 * @param {Page} page @param {string} title
 * @returns {Promise<{ids: string[], orphanCount: number}>}
 */
export async function scanExactTitle(page, title) {
  return page.evaluate((want) => {
    const clean = (/** @type {any} */ s) => String(s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
    const idOf = (/** @type {Element} */ a) => ((a.getAttribute("href") || "").match(/\/marketplace\/item\/(\d+)/) || [])[1];
    const SEL = 'a[href*="/marketplace/item/"]';
    /** textos "hoja" y aria-labels de un elemento */
    const textsOf = (/** @type {Element} */ root) => {
      const out = [];
      for (const el of [root, ...root.querySelectorAll("*")]) {
        const lbl = el.getAttribute("aria-label");
        if (lbl) out.push(lbl);
        if (el.children.length === 0) out.push(el.textContent);
      }
      return out;
    };
    const ids = new Set();
    /** @type {Element[]} */
    const cards = [];
    for (const a of document.querySelectorAll(SEL)) {
      const id = idOf(a);
      if (!id) continue;
      // Subir hasta la tarjeta: el mayor ancestro que solo enlaza a ESTA publicación.
      let card = a;
      while (card.parentElement && card.parentElement !== document.body) {
        const p = card.parentElement;
        if ([...p.querySelectorAll(SEL)].some((x) => idOf(x) && idOf(x) !== id)) break;
        card = p;
      }
      if (textsOf(card).some((t) => clean(t) === want)) {
        ids.add(id);
        cards.push(card);
      }
    }
    // Títulos exactos FUERA de las tarjetas con enlace (tarjeta sin enlace = posible duplicado).
    let orphanCount = 0;
    for (const el of document.body.querySelectorAll("*")) {
      if (el.children.length === 0 && clean(el.textContent) === want && !cards.some((c) => c.contains(el))) orphanCount++;
    }
    return { ids: [...ids], orphanCount };
  }, cleanTitle(title));
}

/** Abre "Tus publicaciones", espera y hace scroll para cargar tarjetas. @param {Page} page @param {string} title @param {string} base */
async function openSellingAndScan(page, title, base) {
  await go(page, `${base}/marketplace/you/selling`);
  await page.getByText(cleanTitle(title), { exact: true }).first().waitFor({ timeout: 15_000 }).catch(() => {});
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 1500);
    await pause(700, 1400);
  }
  return scanExactTitle(page, title);
}

/**
 * Busca la URL de UNA publicación con título EXACTO en "Tus publicaciones".
 * - 0 coincidencias → null (tras reintentar con recarga).
 * - >1 coincidencias (o un título exacto sin enlace junto a otros) → Error: nunca adivina.
 * @param {Page} page @param {string} title @param {string} [base]
 * @param {{exclude?: string[], attempts?: number}} [opts] exclude = ids que ya existían antes de publicar
 */
export async function findListingUrl(page, title, base = FB_BASE, opts = {}) {
  const exclude = new Set(opts.exclude || []);
  const attempts = opts.attempts ?? 3;
  for (let i = 0; i < attempts; i++) {
    const { ids, orphanCount } = await openSellingAndScan(page, title, base);
    const fresh = ids.filter((id) => !exclude.has(id));
    const total = fresh.length + orphanCount;
    if (fresh.length > 1 || (fresh.length === 1 && orphanCount > 0) || (!exclude.size && orphanCount > 1)) {
      throw new Error(`Hay ${total} publicaciones con el título exacto "${cleanTitle(title)}"; no adivino cuál`);
    }
    if (fresh.length === 1) return `${base}/marketplace/item/${fresh[0]}/`;
    if (!exclude.size && ids.length === 0 && orphanCount === 1) {
      // Título exacto sin enlace visible: abrirlo y leer la URL.
      await page.getByText(cleanTitle(title), { exact: true }).first().click();
      await page.waitForURL(/\/marketplace\/item\/\d+/, { timeout: 15_000 }).catch(() => {});
      const u = normalizeItemUrl(page.url(), base);
      if (u) return u;
    }
    if (i < attempts - 1) await pause(4000, 8000); // la publicación nueva puede tardar en aparecer
  }
  return null;
}

/** Ids con título exacto que ya existen (antes de publicar). Nunca falla. @param {Page} page @param {string} title @param {string} base */
async function existingIds(page, title, base) {
  try {
    return (await openSellingAndScan(page, title, base)).ids;
  } catch (e) {
    if (e?.name === "CheckpointError") throw e;
    return [];
  }
}

/** Selecciona una opción de un combobox (Categoría / Estado). */
async function openCombo(page, name) {
  const combo = await firstVisible([page.getByRole("combobox", { name }), page.getByLabel(name)]);
  if (!combo) throw new Error(`No encontré el campo ${name}`);
  await combo.click();
  await pause();
  return combo;
}

/** Opciones visibles de un desplegable abierto. @param {Page} page */
function optionLocators(page) {
  return page.locator(
    '[role="option"], [role="listbox"] [role="button"], [role="menuitem"], [role="menuitemradio"], [role="radio"], [role="dialog"] [role="button"]'
  );
}

/** @param {Locator} opts */
async function visibleOptionTexts(opts) {
  const out = [];
  const n = Math.min(await opts.count(), 80);
  for (let i = 0; i < n; i++) {
    const o = opts.nth(i);
    if (!(await o.isVisible().catch(() => false))) continue;
    const t = ((await o.innerText().catch(() => "")) || "").trim().split("\n")[0].trim();
    if (t) out.push({ i, t });
  }
  return out;
}

const ACCESSORY_RE = /accesorio|joyer|anteojo|lentes|gafas|eyewear|sunglass/i;

/** @param {Page} page @param {string|undefined} hint @returns {Promise<string>} texto elegido */
async function pickCategory(page, hint) {
  const name = /Categor[ií]a/i;
  const combo = await openCombo(page, name);
  const editable = await combo
    .evaluate((el) => el.tagName === "INPUT" || el.tagName === "TEXTAREA" || /** @type {HTMLElement} */ (el).isContentEditable)
    .catch(() => false);
  const terms = [...new Set([hint, "Accesorios", "Joyería", "Anteojos", "Lentes de sol"].filter(Boolean))];
  const seen = new Set();
  for (const term of terms) {
    if (editable) {
      await typeInto(page, combo, /** @type {string} */ (term));
      await pause(1000, 2000);
    }
    const opts = optionLocators(page);
    const list = await visibleOptionTexts(opts);
    list.forEach((o) => seen.add(o.t));
    const hintRe = hint ? new RegExp(hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
    const chosen = (hintRe && list.find((o) => hintRe.test(o.t))) || list.find((o) => ACCESSORY_RE.test(o.t));
    if (chosen) {
      await opts.nth(chosen.i).click();
      await pause();
      return chosen.t;
    }
    if (!editable) break; // lista fija: no tiene sentido reintentar con otros términos
  }
  throw new Error(`No encontré categoría de accesorios. Opciones vistas: ${[...seen].slice(0, 15).join(" | ") || "(ninguna)"}`);
}

/** @param {Page} page */
async function pickEstadoNuevo(page) {
  await openCombo(page, /^Estado/i);
  const opt = await firstVisible([page.getByRole("option", { name: /^Nuevo$/ }), optionLocators(page).filter({ hasText: /^\s*Nuevo\s*$/ })], 8000);
  if (!opt) throw new Error('No encontré la opción "Nuevo" en Estado');
  await opt.click();
  await pause();
}

/** Asegura "Promocionar tras publicar" DESMARCADO (crearía un anuncio pagado). @param {Page} page */
async function ensureNoPromote(page) {
  const name = /Promocionar/i;
  const box = await firstVisible([page.getByRole("checkbox", { name }), page.getByRole("switch", { name }), page.getByLabel(name)], 2500);
  if (!box) return;
  const isOn = async () =>
    (await box.isChecked().catch(async () => (await box.getAttribute("aria-checked")) === "true")) === true;
  if (await isOn()) {
    await box.click();
    await pause();
  }
  if (await isOn()) throw new Error('No pude desmarcar "Promocionar tras publicar"');
}

/**
 * Publica una tarea. Devuelve la URL de la publicación (o null si no se pudo ubicar).
 * @param {Page} page
 * @param {import('./api.mjs').Task} task
 * @param {string[]} files rutas locales de fotos
 * @param {FlowOpts} [opts]
 * @returns {Promise<{externalUrl: string|null, category: string, submitted: boolean}>}
 */
export async function publicar(page, task, files, opts = {}) {
  const base = opts.base || FB_BASE;
  const kit = task.kit;
  if (!kit?.title) throw new Error("La tarea no trae título");
  const price = String(Math.round(Number(kit.priceColones) || 0));
  if (!/^\d+$/.test(price) || price === "0") throw new Error("Precio inválido en la tarea");

  // Ids con el mismo título exacto que ya existían (p. ej. una versión vieja vendida):
  // así, tras publicar, la URL nueva es la ÚNICA id que no estaba antes.
  const prior = opts.dryRun ? [] : await existingIds(page, kit.title, base);
  if (prior.length) log(`ya había ${prior.length} publicación(es) con el mismo título exacto`);

  await go(page, `${base}/marketplace/create/item`);

  // Fotos
  const fileInput = page.locator('input[type="file"][accept*="image"]').first();
  await fileInput.waitFor({ state: "attached", timeout: 20_000 });
  await fileInput.setInputFiles(files);
  log(`fotos subidas: ${files.length}`);
  await pause(2000, 4000);

  // Título / Precio
  const title = await firstVisible(fieldByName(page, /^T[ií]tulo/i));
  if (!title) throw new Error("No encontré el campo Título");
  await typeInto(page, title, kit.title);
  const priceField = await firstVisible(fieldByName(page, /^Precio/i));
  if (!priceField) throw new Error("No encontré el campo Precio");
  await typeInto(page, priceField, price);

  // Categoría / Estado
  const category = await pickCategory(page, kit.category);
  log(`categoría elegida: ${category}`);
  await pickEstadoNuevo(page);

  // Más detalles → Descripción
  const desc = kit.description || "";
  if (desc) {
    let descField = await firstVisible(fieldByName(page, /^Descripci[oó]n/i), 1500);
    if (!descField) {
      const more = await firstVisible([page.getByRole("button", { name: /Más detalles/i }), page.getByText(/^Más detalles$/i)], 8000);
      if (!more) throw new Error('No encontré "Más detalles"');
      await more.click();
      await pause();
      descField = await firstVisible(fieldByName(page, /^Descripci[oó]n/i), 8000);
    }
    if (!descField) throw new Error("No encontré el campo Descripción");
    await insertLongText(page, descField, desc);
    log(`descripción verificada (${desc.length} caracteres)`);
  }

  // Marca (opcional, aparece en "Más detalles")
  const brand = await firstVisible(fieldByName(page, /^Marca/i), 1500);
  if (brand) {
    await typeInto(page, brand, "bloo");
    log("marca: bloo");
  }

  // Ubicación solo si está vacía y visible
  const loc = await firstVisible([page.getByRole("combobox", { name: /Ubicaci[oó]n/i })], 1000);
  if (loc && !(await loc.inputValue().catch(() => "x"))) {
    await typeInto(page, loc, kit.location || "San José");
    const opt = await firstVisible([page.getByRole("option").filter({ hasText: /San Jos[eé]/i })], 5000);
    if (opt) await opt.click();
    await pause();
  }

  await ensureNoPromote(page);
  await assertNoCheckpoint(page);

  const next = await firstVisible([page.getByRole("button", { name: /^Siguiente$/ })]);
  if (!next) throw new Error('No encontré el botón "Siguiente"');
  await next.click();
  await pause(1500, 3000);
  await assertNoCheckpoint(page);
  await ensureNoPromote(page);

  const publish = await firstVisible([page.getByRole("button", { name: /^Publicar$/ })], 20_000);
  if (!publish) throw new Error('No encontré el botón "Publicar" (¿faltó algún campo obligatorio?)');
  if (opts.dryRun) {
    log('dry-run: formulario completo, NO se hizo clic en "Publicar"');
    return { externalUrl: null, category, submitted: false };
  }
  const before = page.url();
  await publish.click();
  await page.waitForURL((u) => u.toString() !== before && !/\/marketplace\/create\//.test(u.toString()), { timeout: 45_000 }).catch(() => {});
  await pause(2000, 4000);
  await assertNoCheckpoint(page);

  let externalUrl = normalizeItemUrl(page.url(), base);
  if (!externalUrl) {
    externalUrl = await findListingUrl(page, kit.title, base, { exclude: prior }).catch((e) => {
      if (e?.name === "CheckpointError") throw e;
      log(`url no ubicada: ${e instanceof Error ? e.message : e}`);
      return null;
    });
  }
  log(`publicada; url: ${externalUrl ? safeUrl(externalUrl) : "(no encontrada)"}`);
  return { externalUrl, category, submitted: true };
}

const SOLD_DONE_RE = /Marcar como disponible|Marcado como (agotado|vendido)|^\s*(Agotado|Vendido)\s*$/im;

/**
 * Quita una publicación: marca como agotado/vendido (preferido) o la elimina.
 * @param {Page} page
 * @param {import('./api.mjs').Task} task
 * @param {FlowOpts} [opts]
 * @returns {Promise<{method: 'vendido'|'eliminado'|'ya_estaba'|'dry-run'}>}
 */
export async function quitar(page, task, opts = {}) {
  const base = opts.base || FB_BASE;
  const title = task.kit?.title ? cleanTitle(task.kit.title) : "";
  let url = task.externalUrl ? normalizeItemUrl(task.externalUrl, base) : null;
  if (!url) {
    if (!title) throw new Error("Tarea sin externalUrl ni título");
    // Solo título EXACTO; 0 o >1 coincidencias → fallida (nunca tocar los listados manuales).
    url = await findListingUrl(page, title, base);
    if (!url) throw new Error(`No encontré ninguna publicación con el título exacto "${title}"`);
  }
  await go(page, url);

  // Seguridad: la página debe mostrar exactamente el título de la tarea.
  if (title) {
    const shown = await firstVisible([page.getByText(title, { exact: true })], 10_000);
    if (!shown) throw new Error(`La publicación ${safeUrl(url)} no muestra el título exacto "${title}"; no la toco`);
  }

  if (await firstVisible([page.getByRole("button", { name: /Marcar como disponible/i })], 2500)) return { method: "ya_estaba" };

  const mark = await firstVisible(
    [page.getByRole("button", { name: /Marcar como (agotado|vendido)/i }), page.getByText(/^Marcar como (agotado|vendido)$/i)],
    10_000
  );
  if (mark) {
    if (opts.dryRun) {
      log('dry-run: encontré "Marcar como agotado/vendido", NO se hizo clic');
      return { method: "dry-run" };
    }
    await mark.click();
    await pause(1500, 3000);
    // Diálogos de confirmación posibles ("¿A quién se lo vendiste?", confirmar, etc.)
    for (let i = 0; i < 3; i++) {
      const dlg = page.getByRole("dialog");
      if (!(await dlg.first().isVisible().catch(() => false))) break;
      const btn = await firstVisible(
        [dlg.getByRole("button", { name: /^(Confirmar|Marcar como (agotado|vendido)|Listo|Omitir|Aceptar|Siguiente|Nadie.*)$/i })],
        3000
      );
      if (!btn) break;
      await btn.click();
      await pause(1200, 2500);
    }
    await assertNoCheckpoint(page);
    const ok = await firstVisible([page.getByRole("button", { name: /Marcar como disponible/i }), page.getByText(SOLD_DONE_RE)], 15_000);
    if (!ok) throw new Error("Hice clic en marcar como agotado pero no pude confirmar el cambio");
    return { method: "vendido" };
  }

  // Fallback: eliminar
  const more = await firstVisible(
    [page.getByRole("button", { name: /^(Más|Más opciones|More|Opciones)$/i }), page.getByLabel(/^(Más|Más opciones)$/i)],
    8000
  );
  if (!more) throw new Error('No encontré "Marcar como agotado" ni el menú para eliminar');
  await more.click();
  await pause();
  const del = await firstVisible([page.getByRole("menuitem", { name: /Eliminar/i }), page.getByText(/^Eliminar( publicaci[oó]n)?$/i)], 8000);
  if (!del) throw new Error('No encontré la opción "Eliminar"');
  if (opts.dryRun) {
    log('dry-run: encontré "Eliminar", NO se hizo clic');
    return { method: "dry-run" };
  }
  await del.click();
  await pause();
  const confirm = await firstVisible([page.getByRole("dialog").getByRole("button", { name: /^Eliminar$/i })], 8000);
  if (!confirm) throw new Error("No apareció la confirmación de eliminar");
  await confirm.click();
  await pause(2000, 4000);
  await assertNoCheckpoint(page);
  return { method: "eliminado" };
}
