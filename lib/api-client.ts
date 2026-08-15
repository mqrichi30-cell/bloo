"use client";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getCsrfToken(): string | null {
  return readCookie("bloo_csrf");
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function apiFetch<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);

  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (MUTATING_METHODS.has(method)) {
    const csrf = getCsrfToken();
    if (csrf) headers.set("x-csrf-token", csrf);
  }

  const response = await fetch(url, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
  });

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const message = (data && (data as { error?: string }).error) || "Se nos escapó una ola. Probá de nuevo.";
    throw new ApiError(message, response.status);
  }

  return data as T;
}
