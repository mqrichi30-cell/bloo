// @ts-check
import { chromium } from "playwright";

/** UA de Chrome de escritorio coherente con la versión real del motor. @param {import('playwright').Browser} browser */
export function desktopUserAgent(browser) {
  const major = (browser.version().match(/^(\d+)/) || [])[1] || "140";
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/**
 * Lanza Chromium con un contexto realista es-CR.
 * @param {{headless?: boolean, storageState?: any}} [opts]
 */
export async function launch(opts = {}) {
  const launchOpts = {
    headless: opts.headless ?? true,
    args: ["--disable-blink-features=AutomationControlled"],
  };
  // Regla del dueño: siempre Google Chrome real (misma huella que la sesión capturada).
  // Chromium de Playwright solo como respaldo si Chrome no está instalado.
  let browser;
  if (process.env.ROBOT_BROWSER === "chromium") {
    browser = await chromium.launch(launchOpts);
  } else {
    try {
      browser = await chromium.launch({ ...launchOpts, channel: "chrome" });
    } catch (e) {
      console.warn(`[robot] Google Chrome no disponible (${String(e?.message || e).split("\n")[0]}); uso Chromium de Playwright`);
      browser = await chromium.launch(launchOpts);
    }
  }
  const context = await browser.newContext({
    storageState: opts.storageState,
    locale: "es-CR",
    timezoneId: "America/Costa_Rica",
    viewport: { width: 1366, height: 768 },
    userAgent: desktopUserAgent(browser),
    extraHTTPHeaders: { "Accept-Language": "es-CR,es;q=0.9,en;q=0.6" },
  });
  return { browser, context };
}
