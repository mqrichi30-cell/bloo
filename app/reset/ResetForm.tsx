"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AlertTriangle, Check, X as XIcon } from "lucide-react";
import { TextInput } from "@/components/ui/TextInput";
import { PrimaryButton } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api-client";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation";

// Mismo texto que resetPasswordSchema en lib/validation.ts, así el mensaje de
// validación en vivo nunca queda desincronizado del que puede devolver el server.
const MIN_LENGTH_MESSAGE = `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`;
const MISMATCH_MESSAGE = "Las contraseñas no coinciden.";

export function ResetForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [touchedConfirm, setTouchedConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const meetsLength = password.length >= PASSWORD_MIN_LENGTH;
  const showMismatch = touchedConfirm && confirm.length > 0 && password !== confirm;

  if (!token) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-error-bg text-error-text">
          <AlertTriangle size={26} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <p className="text-h2 text-ink-900">Enlace inválido o vencido</p>
        <p className="max-w-[32ch] text-body text-ink-600">
          Este enlace para crear una contraseña nueva ya no sirve. Pedí uno nuevo.
        </p>
        <div className="mt-2 w-full max-w-[280px]">
          <Link href="/olvide">
            <PrimaryButton type="button">Pedir un enlace nuevo</PrimaryButton>
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center"
        aria-live="polite"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success-bg text-success-text">
          <Check size={26} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <p className="text-h2 text-ink-900">Contraseña actualizada</p>
        <p className="max-w-[32ch] text-body text-ink-600">
          Ya podés entrar con tu usuario y tu contraseña nueva.
        </p>
        <div className="mt-2 w-full max-w-[280px]">
          <Link href="/login">
            <PrimaryButton type="button">Ir a iniciar sesión</PrimaryButton>
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouchedPassword(true);
    setTouchedConfirm(true);
    setServerError(null);

    if (!meetsLength || password !== confirm) return;

    setLoading(true);
    try {
      await apiFetch("/api/auth/reset", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Se nos escapó una ola. Probá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col justify-center gap-4 px-6 py-8" noValidate>
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-h1 text-ink-900">Creá una contraseña nueva</h1>
        <p className="text-body text-ink-600">Usá algo que no uses en otro lado.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <TextInput
          label="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setTouchedPassword(true)}
          required
        />
        <p
          aria-live="polite"
          className={`flex items-center gap-1.5 text-caption ${
            !touchedPassword ? "text-ink-600" : meetsLength ? "text-success-text" : "text-error-text"
          }`}
        >
          {touchedPassword ? (
            meetsLength ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <XIcon size={14} aria-hidden="true" />
            )
          ) : null}
          {touchedPassword && !meetsLength ? MIN_LENGTH_MESSAGE : `Mínimo ${PASSWORD_MIN_LENGTH} caracteres`}
        </p>
      </div>

      <TextInput
        label="Confirmá la contraseña"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        onBlur={() => setTouchedConfirm(true)}
        error={showMismatch ? MISMATCH_MESSAGE : undefined}
        required
      />

      {serverError && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-sm bg-error-bg px-3 py-2 text-caption text-error-text"
        >
          {serverError}
        </p>
      )}

      <PrimaryButton type="submit" loading={loading} className="mt-2">
        Guardar contraseña
      </PrimaryButton>
    </form>
  );
}
