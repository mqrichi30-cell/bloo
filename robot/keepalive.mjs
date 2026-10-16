// @ts-check
// Keep-alive diario de la sesión de Facebook: abre facebook.com con la sesión
// guardada (secret FB_STORAGE_STATE_B64), revisa que siga dentro y sale.
// Sale 0 si la sesión sigue viva; sale 3 si Facebook pide login/checkpoint/2FA
// (el workflow falla y GitHub avisa por correo). No escribe nada ni publica.
// Env: FB_STORAGE_STATE_B64. Nada de esto se imprime.
import { launch } from "./src/browser.mjs";
import { assertNoCheckpoint, CheckpointError } from "./src/checkpoint.mjs";

const b64 = process.env.FB_STORAGE_STATE_B64 || "";
if (!b64) {
  console.error("keepalive: falta el secret FB_STORAGE_STATE_B64");
  process.exit(2);
}

/** @type {any} */
let state;
try {
  state = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
} catch {
  console.error("keepalive: el secret no es un storageState válido");
  process.exit(2);
}

const { browser, context } = await launch({ headless: true, storageState: state });
try {
  const page = await context.newPage();
  await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(5_000);
  await assertNoCheckpoint(page);
  const cookies = await context.cookies("https://www.facebook.com");
  const viva = cookies.some((c) => c.name === "c_user");
  if (!viva) throw new CheckpointError("La sesión expiró: no quedó la cookie c_user");
  console.log("keepalive: sesión de Facebook viva");
} catch (e) {
  if (e instanceof CheckpointError) {
    console.error(`keepalive: ${e.message}. Hay que renovar la sesión con robot/capture-session.mjs`);
    process.exitCode = 3;
  } else {
    console.error(`keepalive: error inesperado (${String(e?.message || e).split("\n")[0]})`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
