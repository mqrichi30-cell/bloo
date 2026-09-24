// Allowlists de hosts para las URLs que circulan por el pipeline de imágenes.
//
// sourceUrl: el worker la DESCARGA. Si se aceptara cualquier URL, quien
// logre meter una fila (o un fotoUrl) apuntando a una IP interna o a un
// host arbitrario convierte al worker en un SSRF (revisión de seguridad
// 2026-09-23). Mismo host que el proxy app/api/nihao-img (ALLOWED_HOST).
//
// publicUrl: la reporta el worker y el panel la pinta como <img src>. Solo
// se acepta el Storage de Supabase donde sube el worker (imagegen/storage.py
// usa SUPABASE_URL). Sin SUPABASE_URL configurado no se acepta ninguna:
// fail-closed.

export const SOURCE_HOSTS: readonly string[] = ["img.nihaojewelry.com"];

function parseHttps(u: string): URL | null {
  try {
    const url = new URL(u);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function isAllowedSourceUrl(u: string): boolean {
  const url = parseHttps(u);
  return url !== null && SOURCE_HOSTS.includes(url.hostname) && !url.username && !url.password;
}

export function isAllowedPublicUrl(u: string): boolean {
  const url = parseHttps(u);
  const base = process.env.SUPABASE_URL ? parseHttps(process.env.SUPABASE_URL) : null;
  if (!url || !base) return false;
  return url.hostname === base.hostname && url.pathname.startsWith("/storage/v1/object/public/");
}
