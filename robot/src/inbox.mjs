// @ts-check
// Respuesta automática ÚNICA a compradores de Marketplace de bloo (Messenger del perfil personal).
//
// Ruta: /marketplace/you/selling/ → botón "Messenger" del encabezado → carpeta "Marketplace" → chat
// ACOPLADO. No se usa /messages/: ahí sale el modal "Ingresa tu PIN para restaurar los chats" (cifrado
// de extremo a extremo), que tapa el compositor y cuyas salidas cambian el estado de cifrado del
// dispositivo. Los hilos de Marketplace son /messages/t/<id> (sin E2EE): su historial está completo.
//
// Regla stateless (sin base de datos), por hilo cuyo artículo empieza EXACTO con "Lentes de sol bloo"
// (mayúsculas incluidas: los manuales "Lentes de sol Bloo" del dueño no se tocan):
//   - vista previa "Tú: …"                          → ya respondido, ni se abre (no se marca leído)
//   - se abre: algún mensaje "por Tú"               → ya respondido, no se toca
//   - sin "X inició este chat" (historial parcial)  → incierto, no se toca
//   - sin mensajes del comprador                    → nada que responder
//   - si no                                         → responder UNA vez REPLY_TEXT, verificar que salió 1 vez
// Nunca escribe el PIN, no archiva, no borra, no reacciona. Si abrió un hilo no leído y no respondió,
// lo vuelve a marcar "no leído". Tope: maxReplies por corrida; ante cualquier duda tras enviar, se detiene.
import { CheckpointError, assertNoCheckpoint } from "./checkpoint.mjs";
import { FB_BASE, firstVisible, go } from "./facebook.mjs";
import { log, pause } from "./util.mjs";

export const BLOO_PREFIX = "Lentes de sol bloo";
export const REPLY_TEXT =
  "¡Hola! 😊 Gracias por escribirle a bloo. Sí, todavía está disponible. Para atenderte más rápido, escríbenos por WhatsApp al 8943-3677 (wa.me/50689433677) y coordinamos la entrega o el envío. Las fotos de la publicación son de referencia: con gusto te enviamos fotos reales y te mostramos todos los estilos que tenemos. ¡Que tengas un lindo día!";
// Firma para contar nuestra respuesta en el hilo (robusta a emoji/espacios que Messenger reescriba).
const REPLY_MARK = "Gracias por escribirle a bloo";
const SELLER = /^(Tú|You)$/;
const ROW_PREFIX = /^(Chat en grupo|Chat de grupo|Group chat): /;
const MSG_RE = /^Presionar Enter, Mensaje enviado (.+?) por ([^:]+?): ([\s\S]*)$/;

/** Colapsa espacios y quita selectores de variante de emoji. @param {string} s */
export const normText = (s) => String(s || "").replace(/️/g, "").replace(/\s+/g, " ").trim();

/** Nombre corto para logs (datos de compradores fuera de los logs). @param {string} name */
export const maskName = (name) => (name ? `${[...name][0]}***` : "?");

/**
 * Fila de la carpeta Marketplace. label = aria-label ("Chat en grupo: Sharon · Lentes de sol bloo · …"),
 * text = textContent de la fila (título + vista previa + hora).
 * @param {string} label @param {string} text
 */
export function parseRow(label, text) {
  const full = normText(String(label || "").replace(ROW_PREFIX, ""));
  const i = full.indexOf(" · ");
  const name = i >= 0 ? full.slice(0, i) : full;
  const title = i >= 0 ? full.slice(i + 3) : "";
  let preview = normText(text);
  if (preview.startsWith(full)) preview = preview.slice(full.length).trim();
  const unread = /^Mensaje no le[ií]do:|mensajes? nuevos?/i.test(preview);
  preview = preview.replace(/^Mensaje no le[ií]do:\s*/i, "");
  return { label: full, name, title, preview, unread, isBloo: title.startsWith(BLOO_PREFIX), sellerLast: /^(Tú|You):/.test(preview) };
}

/**
 * Mensajes de un hilo a partir de las etiquetas accesibles "Presionar Enter, Mensaje enviado <fecha> por <X>: <texto>".
 * @param {string[]} labels
 */
export function parseMessages(labels) {
  const out = [];
  for (const raw of labels) {
    const m = normText(raw).match(MSG_RE);
    if (!m) continue;
    const from = m[2].trim();
    const text = m[3].trim();
    if (/ inici[oó] este chat\.?$/.test(text) && text.startsWith(from)) continue; // marcador, no es mensaje
    out.push({ from, text, seller: SELLER.test(from) });
  }
  return out;
}

/**
 * Decide qué hacer con un hilo abierto.
 * @param {{labels: string[], started: boolean}} t  started = se ve "X inició este chat" (historial completo)
 * @returns {{action: 'responder'|'saltar', reason: string, sellerCount: number, buyerCount: number}}
 */
export function decideThread(t) {
  const msgs = parseMessages(t.labels);
  const sellerCount = msgs.filter((m) => m.seller).length;
  const buyerCount = msgs.length - sellerCount;
  const r = (/** @type {'responder'|'saltar'} */ action, reason) => ({ action, reason, sellerCount, buyerCount });
  if (sellerCount > 0) return r("saltar", `ya respondido (${sellerCount} mensaje(s) del vendedor)`);
  if (!t.started) return r("saltar", 'historial incompleto (no veo "inició este chat")');
  if (buyerCount === 0) return r("saltar", "sin mensajes del comprador");
  return r("responder", `sin respuesta del vendedor (${buyerCount} mensaje(s) del comprador)`);
}

/** Cuántas veces está nuestra respuesta (mensajes del vendedor con la firma). @param {string[]} labels */
export function countReplies(labels) {
  return parseMessages(labels).filter((m) => m.seller && normText(m.text).includes(REPLY_MARK)).length;
}

/**
 * @typedef {import('playwright').Page} Page
 * @typedef {{label: string, name: string, title: string, preview: string, unread: boolean, isBloo: boolean, sellerLast: boolean}} Row
 * @typedef {{who: string, title: string, result: string, reason: string}} Outcome
 * @typedef {{base?: string, dryRun?: boolean, maxReplies?: number, deadline?: number,
 *   openAll?: boolean, onEvidence?: (page: Page, note: string) => Promise<void>}} InboxOpts
 *   openAll: SOLO en dry, abre también los hilos con vista previa "Tú:" (validar selectores en vivo).
 */

/** Abre el desplegable de Messenger y la carpeta Marketplace. @param {Page} page */
async function openFolder(page) {
  // Idempotente: si la carpeta o el desplegable ya están abiertos, no volver a pulsar "Messenger" (lo cerraría).
  if (await page.getByRole("link", { name: ROW_PREFIX }).filter({ visible: true }).first().isVisible().catch(() => false)) return;
  let folder = await firstVisible([page.getByRole("button", { name: /^Marketplace/ })], 1500);
  if (!folder) {
    const btn = await firstVisible([page.getByRole("button", { name: /^Messenger$/ })], 15_000);
    if (!btn) throw new Error('no encontré el botón "Messenger" del encabezado');
    await btn.click();
    await pause(1500, 3000);
    folder = await firstVisible([page.getByRole("button", { name: /^Marketplace/ })], 10_000);
  }
  if (!folder) throw new Error("no encontré la carpeta Marketplace en Messenger");
  await folder.click();
  await pause(2000, 3500);
  const first = await firstVisible([page.getByRole("link", { name: ROW_PREFIX })], 15_000);
  if (!first) throw new Error("la carpeta Marketplace no mostró conversaciones");
}

/** Lee las filas visibles de la carpeta; desplaza la lista para cargar más (máx. `scrolls`). @param {Page} page */
async function readRows(page, scrolls = 4) {
  /** @type {Map<string, {label: string, text: string}>} */
  const seen = new Map();
  for (let i = 0; i <= scrolls; i++) {
    const batch = await page.evaluate((src) => {
      const re = new RegExp(src);
      return [...document.querySelectorAll("a[aria-label]")]
        .filter((a) => re.test(a.getAttribute("aria-label") || "") && a.getBoundingClientRect().height > 0)
        .map((a) => ({ label: a.getAttribute("aria-label") || "", text: a.textContent || "" }));
    }, ROW_PREFIX.source);
    const before = seen.size;
    for (const r of batch) if (!seen.has(r.label)) seen.set(r.label, r);
    if (i === scrolls || (i > 0 && seen.size === before)) break;
    const last = page.getByRole("link", { name: ROW_PREFIX }).last();
    await last.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await page.mouse.wheel(0, 600).catch(() => {});
    await pause(1200, 2200);
  }
  return [...seen.values()].map((r) => parseRow(r.label, r.text));
}

/** Locator de la fila (dentro del desplegable) por su etiqueta exacta. @param {Page} page @param {Row} row */
const escRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rowLink = (page, row) =>
  page.getByRole("link", { name: new RegExp(`${ROW_PREFIX.source}${escRe(row.label)}$`) }).filter({ visible: true });

/**
 * Marca el chat acoplado de `row` con data-bloo-chat y devuelve su estado. Identifica el chat por el
 * texto "Escribe en <etiqueta>" (placeholder del compositor): nunca se escribe en otro hilo.
 * @param {Page} page @param {Row} row
 */
async function readChat(page, row) {
  return page.evaluate((label) => {
    document.querySelectorAll("[data-bloo-chat]").forEach((el) => el.removeAttribute("data-bloo-chat"));
    const want = `Escribe en ${label}`;
    const clean = (/** @type {any} */ s) => String(s || "").replace(/\s+/g, " ").trim();
    const ph = [...document.querySelectorAll("*")].find(
      (el) => clean(el.getAttribute("aria-placeholder")) === want || (el.children.length === 0 && clean(el.textContent) === want)
    );
    if (!ph) return null;
    let root = ph.parentElement;
    while (root && !/Mensaje enviado/.test(root.textContent || "")) root = root.parentElement;
    if (!root) return null;
    // Un solo compositor dentro: si no, subimos hasta otro chat acoplado → no es confiable.
    const composers = [...root.querySelectorAll("*")].filter(
      (el) => /^Escribe en /.test(clean(el.getAttribute("aria-placeholder"))) || (el.children.length === 0 && /^Escribe en /.test(clean(el.textContent)))
    );
    if (composers.length > 1) return null;
    root.setAttribute("data-bloo-chat", "1");
    const fromAria = [];
    const fromText = [];
    for (const el of root.querySelectorAll("*")) {
      const a = el.getAttribute("aria-label");
      if (a && a.startsWith("Presionar Enter, Mensaje enviado")) fromAria.push(a);
      if (el.children.length === 0 && (el.textContent || "").startsWith("Presionar Enter, Mensaje enviado")) fromText.push(el.textContent || "");
    }
    const started = / inici[oó] este chat/.test(root.textContent || "");
    return { fromAria, fromText, started };
  }, row.label);
}

/** Lleva el historial del chat marcado hasta arriba (hasta ver "inició este chat"). @param {Page} page */
async function scrollChatToTop(page) {
  for (let i = 0; i < 6; i++) {
    const done = await page.evaluate(() => {
      const root = document.querySelector("[data-bloo-chat]");
      if (!root) return true;
      if (/ inici[oó] este chat/.test(root.textContent || "")) return true;
      for (const el of root.querySelectorAll("*")) {
        const h = /** @type {HTMLElement} */ (el);
        if (h.scrollHeight > h.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(h).overflowY)) h.scrollTop = 0;
      }
      return false;
    });
    if (done) return;
    await pause(1200, 2000);
  }
}

/** Etiquetas de mensajes del chat (la fuente con más coincidencias, sin deduplicar por texto). @param {{fromAria: string[], fromText: string[]}} c */
const chatLabels = (c) => (c.fromAria.length >= c.fromText.length ? c.fromAria : c.fromText);

/** Abre el hilo desde la carpeta y espera su chat acoplado. @param {Page} page @param {Row} row */
async function openThread(page, row) {
  await openFolder(page);
  const link = rowLink(page, row).first();
  if (!(await link.isVisible().catch(() => false))) throw new Error(`no encontré el hilo ${maskName(row.name)} · ${row.title} en la carpeta`);
  await link.click();
  await pause(2500, 4000);
  await assertNoCheckpoint(page);
  const deadline = Date.now() + 15_000;
  let chat = null;
  while (Date.now() < deadline && !(chat = await readChat(page, row))) await pause(800, 1200);
  if (!chat) throw new Error(`no se abrió el chat de ${maskName(row.name)} · ${row.title}`);
  if (!chat.started) {
    await scrollChatToTop(page);
    chat = (await readChat(page, row)) || chat;
  }
  return chat;
}

/** Cierra el chat acoplado (solo la ventana; no archiva). @param {Page} page */
async function closeChat(page) {
  const x = await firstVisible([page.getByRole("button", { name: /^Cerrar chat$|^Close chat$/ })], 3000);
  if (x) await x.click().catch(() => {});
  await pause(800, 1500);
}

/** Vuelve a marcar "no leído" un hilo que abrimos sin responder (mejor esfuerzo). @param {Page} page @param {Row} row */
async function restoreUnread(page, row) {
  try {
    await openFolder(page);
    await rowLink(page, row).first().hover().catch(() => {});
    const more = await firstVisible([page.getByRole("button", { name: `Más opciones para ${row.label}`, exact: true })], 6000);
    if (!more) throw new Error("sin menú de la fila");
    await more.click();
    await pause(800, 1500);
    const item = await firstVisible([page.getByRole("menuitem", { name: /Marcar como no le[ií]do/ }), page.getByText(/^Marcar como no le[ií]do$/)], 5000);
    if (!item) throw new Error('sin "Marcar como no leído"');
    await item.click();
    await pause(800, 1500);
    log(`inbox: ${maskName(row.name)} · ${row.title} → vuelto a "no leído"`);
  } catch (e) {
    log(`inbox: no pude volver a "no leído" ${maskName(row.name)} (${e instanceof Error ? e.message : e})`);
    await page.keyboard.press("Escape").catch(() => {});
  }
}

/**
 * Escribe REPLY_TEXT en el compositor del chat marcado, verifica el texto y pulsa Enter UNA vez.
 * Nunca toca inputs de PIN: solo un contenteditable role=textbox dentro del chat marcado.
 * @param {Page} page
 */
async function sendReply(page) {
  const box = page.locator('[data-bloo-chat] [contenteditable="true"][role="textbox"]').filter({ visible: true }).first();
  if (!(await box.isVisible().catch(() => false))) throw new Error("no encontré el compositor del chat");
  const name = (await box.getAttribute("aria-label").catch(() => "")) || "";
  if (/pin|c[oó]digo|contrase/i.test(name)) throw new Error(`el campo enfocado no es el compositor (${name})`);
  await box.click();
  await pause(500, 1200);
  const text = REPLY_TEXT;
  const size = Math.ceil(text.length / 3);
  for (let i = 0; i < text.length; i += size) {
    await page.keyboard.insertText(text.slice(i, i + size));
    await pause(400, 1100);
  }
  const got = normText(await box.innerText().catch(() => ""));
  if (got !== normText(text)) {
    // No enviar algo distinto: vaciar y abortar.
    await page.keyboard.press("ControlOrMeta+a").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    throw new Error(`el compositor no quedó con el texto exacto (${got.length}/${normText(text).length}); no envío`);
  }
  // El PIN de chats cifrados debe seguir vacío (si existe en la página).
  const pinTouched = await page.evaluate(() =>
    [...document.querySelectorAll('input[aria-label="PIN"], input[name="pin"]')].some((i) => /** @type {HTMLInputElement} */ (i).value)
  );
  if (pinTouched) throw new Error("el campo PIN tiene texto: aborto sin enviar");
  await pause(800, 1800);
  await page.keyboard.press("Enter");
}

/**
 * Corre el inbox una vez.
 * @param {Page} page @param {InboxOpts} [opts]
 * @returns {Promise<{rows: number, bloo: number, sent: number, planned: number, outcomes: Outcome[]}>}
 */
export async function runInbox(page, opts = {}) {
  const base = opts.base || FB_BASE;
  const dry = !!opts.dryRun;
  const maxReplies = opts.maxReplies ?? 10;
  const deadline = opts.deadline ?? Date.now() + 6 * 60_000;
  /** @type {Outcome[]} */
  const outcomes = [];
  const note = (/** @type {Row} */ row, result, reason) => {
    outcomes.push({ who: maskName(row.name), title: row.title, result, reason });
    log(`inbox: ${maskName(row.name)} · ${row.title} → ${result}: ${reason}`);
  };

  await go(page, `${base}/marketplace/you/selling/`);
  await openFolder(page);
  const rows = await readRows(page);
  const bloo = rows.filter((r) => r.isBloo);
  log(`inbox: ${rows.length} conversación(es) de Marketplace; ${bloo.length} de "${BLOO_PREFIX}"${dry ? " (DRY: no se envía nada)" : ""}`);
  await page.keyboard.press("Escape").catch(() => {});

  let sent = 0;
  let planned = 0;
  for (const row of bloo) {
    if (row.sellerLast && !(dry && opts.openAll)) {
      note(row, "no tocar", 'ya respondido (vista previa "Tú:"; no se abre)');
      continue;
    }
    if (planned >= maxReplies) {
      note(row, "pendiente", `tope de ${maxReplies} respuestas por corrida`);
      continue;
    }
    if (Date.now() > deadline - 75_000) {
      note(row, "pendiente", "sin tiempo en esta corrida");
      continue;
    }
    const chat = await openThread(page, row);
    const d = decideThread({ labels: chatLabels(chat), started: chat.started });
    if (d.action === "saltar") {
      note(row, "no tocar", d.reason);
      if (dry && opts.openAll) await opts.onEvidence?.(page, `inbox dry (abrir todo): ${maskName(row.name)} · ${d.reason}`);
      await closeChat(page);
      if (row.unread) await restoreUnread(page, row);
      continue;
    }
    planned++;
    if (dry) {
      note(row, "RESPONDERÍA", d.reason);
      await opts.onEvidence?.(page, `inbox dry: respondería a ${maskName(row.name)} · ${row.title}`);
      await closeChat(page);
      if (row.unread) await restoreUnread(page, row);
      continue;
    }
    await sendReply(page);
    // Verificar: nuestra respuesta aparece exactamente una vez y es el único mensaje del vendedor.
    let after = { count: 0, seller: 0 };
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      await pause(1500, 2500);
      const c = await readChat(page, row);
      if (!c) continue;
      const labels = chatLabels(c);
      after = { count: countReplies(labels), seller: parseMessages(labels).filter((m) => m.seller).length };
      if (after.count >= 1) break;
    }
    await opts.onEvidence?.(page, `inbox: respuesta enviada a ${maskName(row.name)} · ${row.title} (aparece ${after.count} vez/veces)`);
    if (after.count !== 1 || after.seller !== 1) {
      note(row, "VERIFICAR", `tras Enter la respuesta aparece ${after.count} vez/veces (${after.seller} del vendedor)`);
      // Cualquier duda detiene la corrida: no se sigue enviando.
      throw new Error(`verificación de envío falló en ${maskName(row.name)} · ${row.title} (${after.count} copias)`);
    }
    sent++;
    note(row, "RESPONDIDO", "mensaje enviado y verificado (1 vez)");
    await closeChat(page);
    if (planned < maxReplies) await pause(8000, 20_000); // ritmo humano entre envíos
  }
  return { rows: rows.length, bloo: bloo.length, sent, planned, outcomes };
}

export { CheckpointError };
