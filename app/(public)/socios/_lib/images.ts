import { existsSync } from "fs";
import path from "path";

const SOCIOS_DIR = path.join(process.cwd(), "public", "socios");

/**
 * true si Cristhofer ya subió el PNG a /public/socios/<filename>. Server-side
 * only (fs) — usado desde Server Components para decidir entre next/image y
 * un placeholder con las dimensiones exactas, sin servicios externos.
 */
export function socioImageExists(filename: string): boolean {
  try {
    return existsSync(path.join(SOCIOS_DIR, filename));
  } catch {
    return false;
  }
}
