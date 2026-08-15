"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Logo } from "@/components/Logo";
import { TextInput } from "@/components/ui/TextInput";
import { PrimaryButton } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ role: "admin" | "vendedor" }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      router.push(data.role === "admin" ? "/panel" : "/vender");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mobile-shell relative flex min-h-dvh flex-col overflow-hidden bg-navy-900">
      <svg
        className="absolute inset-x-0 top-1/3 h-2/3 w-full opacity-40"
        viewBox="0 0 400 300"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0 60 Q50 20 100 60 T200 60 T300 60 T400 60 V300 H0 Z"
          fill="#80A7B6"
          opacity="0.35"
        />
        <path
          d="M0 110 Q50 70 100 110 T200 110 T300 110 T400 110 V300 H0 Z"
          fill="#80A7B6"
          opacity="0.5"
        />
      </svg>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-8 pt-16">
        <Logo variant="light" height={48} />
        <p className="text-caption tracking-[0.18em] text-white/80" style={{ letterSpacing: "0.18em" }}>
          MADE FOR SUNNY DAYS…
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex flex-col gap-4 rounded-t-lg bg-cream-100 px-6 pb-10 pt-8 shadow-lg"
      >
        <p className="text-h2 text-ink-900">Bienvenido de vuelta al mar.</p>

        <TextInput
          label="Usuario"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <TextInput
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && (
          <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-caption text-error-text">
            {error}
          </p>
        )}

        <PrimaryButton type="submit" loading={loading} className="mt-2">
          Entrar
        </PrimaryButton>

        <Link
          href="/olvide"
          className="inline-flex min-h-[44px] items-center justify-center text-center text-caption text-ink-600 underline underline-offset-2"
        >
          ¿Olvidaste tu contraseña?
        </Link>
      </form>
    </div>
  );
}
