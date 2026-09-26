// @ts-check
// Correr UNA vez en tu PC:  node capture-session.mjs
// 1) Abre Chromium visible. 2) Iniciás sesión en Facebook vos mismo. 3) Enter en la terminal.
// 4) Guarda la sesión, la sube como secret FB_STORAGE_STATE_B64 (si hay `gh`) y borra el archivo local.
import { spawnSync } from "node:child_process";
import { rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { launch } from "./src/browser.mjs";

const REPO = "mqrichi30-cell/bloo";
const file = path.join(tmpdir(), `fb-session-${process.pid}.storage.json`);

const { browser, context } = await launch({ headless: false });
const page = await context.newPage();
await page.goto("https://www.facebook.com/");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question(
  "\nIniciá sesión en Facebook en la ventana (incluido 2FA si lo pide).\n" +
    "Cuando veas tu inicio de Facebook, volvé acá y presioná Enter... "
);
rl.close();

await context.storageState({ path: file });
await browser.close();

const state = JSON.parse(await readFile(file, "utf8"));
if (!state.cookies?.some((/** @type {any} */ c) => c.name === "c_user")) {
  await rm(file, { force: true });
  console.error("No se detectó sesión iniciada (falta cookie c_user). Probá de nuevo.");
  process.exit(1);
}
const b64 = Buffer.from(JSON.stringify(state)).toString("base64");

const hasGh = spawnSync("gh", ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;
if (hasGh) {
  const r = spawnSync("gh", ["secret", "set", "FB_STORAGE_STATE_B64", "-R", REPO], {
    input: b64,
    stdio: ["pipe", "inherit", "inherit"],
    shell: process.platform === "win32",
  });
  await rm(file, { force: true });
  if (r.status === 0) {
    console.log(`Listo: secret FB_STORAGE_STATE_B64 actualizado en ${REPO}. Archivo local borrado.`);
  } else {
    console.error("gh secret set falló. Revisá `gh auth status` y volvé a correr este script.");
    process.exit(1);
  }
} else {
  const out = path.join(tmpdir(), "FB_STORAGE_STATE_B64.txt");
  await writeFile(out, b64, { mode: 0o600 });
  await rm(file, { force: true });
  console.log(
    "No encontré `gh`. Copiá el contenido de este archivo al secret FB_STORAGE_STATE_B64 del repo " +
      `(GitHub → Settings → Secrets → Actions) y después BORRALO:\n  ${out}`
  );
}
