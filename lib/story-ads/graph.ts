// Cliente mínimo de Graph API para la Marketing API (campañas de Historias).
// Interfaz chica (get/post) para que la lógica de lib/story-ads/campaign.ts se
// teste con un mock sin red.
//
// El token va en el header Authorization, nunca en la URL (no queda en logs
// de proxies) y nunca se imprime: los errores solo llevan código/mensaje de
// Meta, que no incluyen el token.
import { GRAPH_API_VERSION } from "@/lib/meta/config";

export type GraphParams = Record<string, string | number | boolean | object | null | undefined>;

export interface GraphClient {
  get(path: string, params?: GraphParams, opts?: { timeoutMs?: number }): Promise<unknown>;
  post(path: string, params: GraphParams, opts?: { timeoutMs?: number }): Promise<unknown>;
}

/**
 * Error de Graph. `incierto` = no sabemos si la escritura se aplicó (timeout,
 * corte de red, 5xx en un POST): ANTES de reintentar hay que consultar el
 * estado en Meta (ver campaign.ts, búsqueda por nombre).
 */
export class GraphError extends Error {
  constructor(
    message: string,
    readonly info: {
      status: number | null;
      code?: number;
      subcode?: number;
      userTitle?: string;
      userMsg?: string;
      transient?: boolean;
      incierto: boolean;
    }
  ) {
    super(message);
    this.name = "GraphError";
  }
}

function encode(params: GraphParams): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    q.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return q;
}

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    is_transient?: boolean;
  };
}

export function fetchGraphClient(accessToken: string, defaults: { timeoutMs: number }): GraphClient {
  const base = `https://graph.facebook.com/${GRAPH_API_VERSION}/`;

  async function call(method: "GET" | "POST", path: string, params: GraphParams, timeoutMs: number): Promise<unknown> {
    const url = new URL(path.replace(/^\//, ""), base);
    const init: RequestInit = {
      method,
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (method === "GET") {
      encode(params).forEach((v, k) => url.searchParams.set(k, v));
    } else {
      init.body = encode(params);
    }
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      const msg = e instanceof Error ? e.name : "error";
      // Sin respuesta: un POST pudo haberse aplicado igual.
      throw new GraphError(`graph ${method} ${path}: sin respuesta (${msg})`, { status: null, incierto: method === "POST", transient: true });
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* body no JSON */
    }
    if (!res.ok) {
      const err = (body as GraphErrorBody | null)?.error ?? {};
      throw new GraphError(`graph ${method} ${path}: HTTP ${res.status} ${err.code ?? ""}/${err.error_subcode ?? ""} ${err.message ?? ""}`.trim(), {
        status: res.status,
        code: err.code,
        subcode: err.error_subcode,
        userTitle: err.error_user_title,
        userMsg: err.error_user_msg,
        transient: err.is_transient ?? res.status >= 500,
        incierto: method === "POST" && res.status >= 500,
      });
    }
    return body;
  }

  return {
    get: (path, params = {}, opts) => call("GET", path, params, opts?.timeoutMs ?? defaults.timeoutMs),
    post: (path, params, opts) => call("POST", path, params, opts?.timeoutMs ?? defaults.timeoutMs),
  };
}
