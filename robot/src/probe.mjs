// @ts-check
// Inspección de la pantalla de pauta SIN tarea del servidor (workflow_dispatch con boost_probe_url).
//   inspect → abre "Promocionar" de la publicación y vuelca la estructura (roles/nombres/texto) + captura
//             de página completa. No toca presupuesto ni botones de pago.
//   dry|on  → corre promocionar() normal con ₡500 (dry no paga).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { firstVisible, go } from "./facebook.mjs";
import { log } from "./util.mjs";

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
