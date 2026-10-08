// @ts-check
// Respuesta automática ÚNICA a compradores de Marketplace de bloo (Messenger web del perfil personal).
// Regla stateless: un hilo cuyo artículo empieza con "Lentes de sol bloo" se responde SOLO si en todo el
// historial visible (desde "X inició este chat") no hay ningún mensaje del vendedor ("por Tú").
// Nunca escribe el PIN de chats cifrados, no archiva, no borra, no reacciona.
import { firstVisible } from "./facebook.mjs";
import { log } from "./util.mjs";

/** Cierra el modal "Ingresa tu PIN para restaurar los chats" con su X. NUNCA escribe el PIN. @param {import('playwright').Page} page */
export async function closePinModal(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const pin = page.getByText(/Ingresa tu PIN para restaurar/i).filter({ visible: true }).first();
    if (!(await pin.isVisible().catch(() => false))) return;
    const dialog = page.getByRole("dialog").filter({ hasText: /Ingresa tu PIN/i });
    const close = await firstVisible([dialog.getByRole("button", { name: /^Cerrar$/ }), page.getByRole("button", { name: /^Cerrar$/ })], 4000);
    if (close) {
      await close.click({ timeout: 5000 }).catch(async () => {
        // La X a veces queda tapada por la capa de animación: foco + Enter (equivale a un clic de teclado).
        await close.focus().catch(() => {});
        await page.keyboard.press("Enter").catch(() => {});
      });
    }
    await page.waitForTimeout(2000);
  }
  if (await page.getByText(/Ingresa tu PIN para restaurar/i).filter({ visible: true }).first().isVisible().catch(() => false)) {
    log("inbox: el modal de PIN sigue visible (no se escribe nada)");
  }
}
