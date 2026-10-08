// @ts-check
// Inspección de la pantalla de pauta SIN tarea del servidor (workflow_dispatch con boost_probe_url).
//   inspect → abre "Promocionar" de la publicación y vuelca la estructura (roles/nombres/texto) + captura
//             de página completa. No toca presupuesto ni botones de pago.
//   dry|on  → corre promocionar() normal con ₡500 (dry no paga).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { firstVisible, go } from "./facebook.mjs";
import { log } from "./util.mjs";
import { closePinModal } from "./inbox.mjs";

const OPEN_RE = /^(Promocionar( publicaci[oó]n| anuncio)?|Impulsar publicaci[oó]n|Boost( listing| post)?)$/i;
// Tarjetas: nunca volcar números de tarjeta (solo podrían aparecer los 4 finales, se tapan igual).
const scrub = (/** @type {string} */ s) => s.replace(/\d{4}(?=\D*$)|(?:\d[ -]?){8,}/g, "####");

/** @param {import('playwright').Page} page @param {string} url @param {string} outBase */
export async function inspectBoost(page, url, outBase) {
  await go(page, url);
  const opener = await firstVisible(
    [page.getByRole("button", { name: OPEN_RE }), page.getByRole("link", { name: OPEN_RE }), page.getByText(OPEN_RE)],
    15_000
  );
  if (!opener) throw new Error('inspect: no encontré "Promocionar" en la publicación');
  const popup = page.context().waitForEvent("page", { timeout: 6000 }).catch(() => null);
  await opener.click();
  const p = (await popup) || page;
  await p.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(() => {});
  await p.waitForTimeout(6000);
  await dumpScreen(p, `${outBase}-1-inicio`);
  // Abrir (sin confirmar nada) el presupuesto personalizado y la fecha de finalización.
  const custom = await firstVisible([p.getByRole("button", { name: /Seleccionar presupuesto personalizado/i })], 5000);
  if (custom) {
    await custom.click();
    await p.waitForTimeout(3000);
    await dumpScreen(p, `${outBase}-2-personalizado`);
    await p.keyboard.press("Escape").catch(() => {});
    await p.waitForTimeout(1500);
  }
  const fin = await firstVisible([p.getByRole("radio", { name: /Elegir fecha de finalizaci[oó]n/i })], 5000);
  if (fin) {
    await fin.click();
    await p.waitForTimeout(3000);
    await dumpScreen(p, `${outBase}-3-fecha`);
  }
  log("inspect: listo (no se pulsó Publicar)");
}

/** Formulario de crear publicación (sin llenar ni publicar nada). @param {import('playwright').Page} page @param {string} outBase */
export async function inspectCreate(page, outBase) {
  await go(page, "https://www.facebook.com/marketplace/create/item");
  await page.waitForTimeout(8000);
  await dumpScreen(page, `${outBase}-create`);
  log("inspect_create: listo (no se publicó nada)");
}

/** Pantalla de EDITAR una publicación (no guarda nada). @param {import('playwright').Page} page @param {string} url @param {string} outBase */
export async function inspectEdit(page, url, outBase) {
  const id = (url.match(/\/item\/(\d+)/) || [])[1];
  await go(page, `https://www.facebook.com/marketplace/edit/?listing_id=${id}`);
  await page.waitForTimeout(8000);
  await dumpScreen(page, `${outBase}-edit`);
  log("inspect_edit: listo (no se guardó nada)");
}

/** Cambia SOLO la descripción de una publicación y pulsa "Actualizar". @param {import('playwright').Page} page @param {string} url @param {string} text @param {(p: any, note: string) => Promise<void>} evidence */
export async function setDescription(page, url, text, evidence) {
  const id = (url.match(/\/item\/(\d+)/) || [])[1];
  if (!text.trim()) throw new Error("set_description: texto vacío");
  await go(page, `https://www.facebook.com/marketplace/edit/?listing_id=${id}`);
  await page.waitForTimeout(6000);
  // La descripción es el textarea cuyo VALOR empieza con el título de bloo (React no lo pone en textContent).
  const all = page.locator("textarea");
  let area = null;
  for (let i = 0, n = await all.count(); i < n; i++) {
    if ((await all.nth(i).inputValue().catch(() => "")).startsWith("Lentes de sol bloo")) {
      area = all.nth(i);
      break;
    }
  }
  if (!area) throw new Error("set_description: no encontré la descripción actual");
  await area.click();
  await area.fill(text);
  await page.waitForTimeout(1500);
  const actual = (await area.inputValue().catch(() => "")).trim();
  if (actual !== text.trim()) throw new Error("set_description: el texto no quedó igual; no guardo");
  const btn = await firstVisible([page.getByRole("button", { name: /^Actualizar$/ })], 8000);
  if (!btn) throw new Error('set_description: no encontré "Actualizar"');
  await btn.click();
  await page.waitForTimeout(6000);
  await evidence(page, "set_description: Actualizar pulsado");
  log("set_description: descripción actualizada");
}

/** @param {import('playwright').Page} p @param {string} outBase */
async function dumpScreen(p, outBase) {
  const dump = await p.evaluate(() => {
    const sel = 'button,[role=button],[role=radio],[role=checkbox],[role=combobox],[role=tab],[role=slider],[role=spinbutton],[role=switch],[role=option],input,select,textarea,a[href]';
    const rows = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const role = el.getAttribute("role") || el.tagName.toLowerCase();
      const name = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
      const extra = [
        el.getAttribute("aria-checked") && `checked=${el.getAttribute("aria-checked")}`,
        el.getAttribute("aria-disabled") === "true" && "disabled",
        /** @type {any} */ (el).type && `type=${/** @type {any} */ (el).type}`,
        /** @type {any} */ (el).value && `value=${String(/** @type {any} */ (el).value).slice(0, 30)}`,
      ].filter(Boolean).join(" ");
      rows.push(`${role} | ${name} | ${extra} | y=${Math.round(r.top + window.scrollY)}`);
    }
    return { url: location.pathname, rows, text: document.body.innerText.slice(0, 12000) };
  });
  await writeFile(`${outBase}-inspect.txt`, scrub(`url: ${dump.url}\n\n== CONTROLES ==\n${dump.rows.join("\n")}\n\n== TEXTO ==\n${dump.text}\n`));
  await p.screenshot({ path: `${outBase}-inspect.png`, fullPage: true, timeout: 20_000 }).catch(() => {});
  log(`inspect: ${dump.rows.length} controles volcados (${path.basename(outBase)})`);
}

/** Vuelca cualquier página de Facebook / Business Suite (solo lectura). @param {import('playwright').Page} page @param {string} url @param {string} outBase */
export async function inspectUrl(page, url, outBase) {
  if (!/^https:\/\/(www|business)\.facebook\.com\//.test(url)) throw new Error("inspect_url: solo facebook.com / business.facebook.com");
  await go(page, url);
  await page.waitForTimeout(10_000);
  await dumpScreen(page, `${outBase}-url`);
  log("inspect_url: listo (solo lectura)");
}

/**
 * Carpeta "Marketplace" de Messenger (solo lectura): cierra el modal de PIN SIN escribir nada,
 * abre la carpeta y vuelca filas (texto + href). @param {import('playwright').Page} page @param {string} url @param {string} outBase
 */
export async function inspectInbox(page, url, outBase) {
  if (url && !url.startsWith("https://www.facebook.com/messages/")) throw new Error("inspect_inbox: solo facebook.com/messages/");
  await go(page, url || "https://www.facebook.com/messages/");
  await page.waitForTimeout(6000);
  await dumpScreen(page, `${outBase}-0-inicio`);
  await closePinModal(page);
  await dumpScreen(page, `${outBase}-0b-sin-modal`);
  const folder = await firstVisible([page.getByRole("button", { name: /^Marketplace/ }), page.locator('[role="button"]').filter({ hasText: /^Marketplace/ })], 10_000);
  if (!folder) throw new Error("inspect_inbox: no encontré la carpeta Marketplace");
  await folder.click();
  await page.waitForTimeout(6000);
  await dumpScreen(page, `${outBase}-1-carpeta`);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/messages/"]')].map((a) => {
      const r = a.getBoundingClientRect();
      return `${(a.getAttribute("href") || "").replace(/\d{6,}/g, (m) => "id" + m.slice(-4))} | ${(a.getAttribute("aria-label") || "")} | ${(a.textContent || "").replace(/\s+/g, " ").slice(0, 160)} | x=${Math.round(r.left)} y=${Math.round(r.top)} w=${Math.round(r.width)}`;
    })
  );
  await writeFile(`${outBase}-2-filas.txt`, rows.join("\n"));
  log(`inspect_inbox: ${rows.length} enlaces de hilos (solo lectura)`);
}
