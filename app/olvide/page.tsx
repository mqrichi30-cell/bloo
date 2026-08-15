"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Waves } from "lucide-react";
import { Logo } from "@/components/Logo";
import { TextInput } from "@/components/ui/TextInput";
import { PrimaryButton } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api-client";

// Mensaje genérico a propósito: el server SIEMPRE responde { ok: true } exista
// o no el usuario, para no dejar que este formulario se use para adivinar
// usuarios válidos (enumeración). No cambiar este texto a algo que confirme o
// niegue si el usuario existe.
const GENERIC_SENT_MESSAGE =
  "Si ese usuario tiene un correo registrado, te mandamos el enlace. Revisá tu bandeja.";

export default function OlvidePage() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/api/auth/forgot", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Se nos escapó una ola. Probá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mobile-shell flex min-h-dvh flex-col bg-white px-6 pb-10 pt-6">
      <Link
        href="/login"
        className="inline-flex min-h-[44px] w-fit items-center gap-1.5 text-label text-ink-600"
      >
        <ArrowLeft size={18} aria-hidden="true" />
        Volver a iniciar sesión
      </Link>

      <div className="flex flex-1 flex-col justify-center gap-8 py-8">
        <div className="flex justify-center">
          <Logo variant="dark" height={30} />
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-3 text-center" aria-live="polite">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-info-bg text-info-text">
              <Waves size={26} strokeWidth={1.75} aria-hidden="true" />
            </div>
            <p className="text-h2 text-ink-900">Revisá tu correo</p>
            <p className="max-w-[32ch] text-body text-ink-600">{GENERIC_SENT_MESSAGE}</p>
            <Link
              href="/login"
              className="mt-2 inline-flex min-h-[44px] items-center text-label text-ink-900 underline underline-offset-2"
            >
              Volver a iniciar sesión
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1 text-center">
              <h1 className="text-h1 text-ink-900">¿Olvidaste tu contraseña?</h1>
              <p className="text-body text-ink-600">
                Escribí tu usuario y te mandamos un enlace para crear una nueva.
              </p>
            </div>

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

            {error && (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-sm bg-error-bg px-3 py-2 text-caption text-error-text"
              >
                {error}
              </p>
            )}

            <PrimaryButton type="submit" loading={loading} className="mt-2">
              Enviar enlace
            </PrimaryButton>
          </form>
        )}
      </div>
    </div>
  );
}
