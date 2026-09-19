"use client";

import { useId, useState, type FormEvent } from "react";
import { AVISO_PRIVACIDAD, CONTACTO, WHATSAPP_BLOO } from "../_content";
import { H2 } from "../_ui/typography";
type Status = "idle" | "loading" | "success" | "error";

const fieldClass =
  "min-h-[48px] w-full rounded-[8px] border border-om-navy/25 bg-white px-4 text-[0.9375rem] text-om-navy outline-none placeholder:text-om-navy/55 focus:border-om-brassInk focus:ring-2 focus:ring-om-brassInk/25";

const labelClass = "text-[0.8125rem] font-medium text-om-navy/80";

export function Contacto() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const formId = useId();

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    // Honeypot: si el bot lo llenó, no molestamos con validación — solo no
    // enviamos (la API igual respondería éxito falso).
    const honeypot = String(data.get("website") ?? "").trim();

    const aceptaPrivacidad = data.get("aceptaPrivacidad") === "on";

    const payload = {
      nombre: String(data.get("nombre") ?? ""),
      negocio: String(data.get("negocio") ?? ""),
      tipo: String(data.get("tipo") ?? ""),
      canton: String(data.get("canton") ?? ""),
      whatsapp: String(data.get("whatsapp") ?? ""),
      correo: String(data.get("correo") ?? ""),
      mensaje: String(data.get("mensaje") ?? ""),
      aceptaPrivacidad,
      website: honeypot,
    };

    if (!payload.nombre || !payload.negocio || !payload.tipo || !payload.canton) {
      setStatus("error");
      setErrorMsg(CONTACTO.errorValidacionVacio);
      return;
    }
    if (!/^\d{8}$/.test(payload.whatsapp.replace(/[\s-]/g, ""))) {
      setStatus("error");
      setErrorMsg(CONTACTO.errorValidacionWhatsapp);
      return;
    }
    if (!payload.aceptaPrivacidad) {
      setStatus("error");
      setErrorMsg(AVISO_PRIVACIDAD.errorNoAceptado);
      return;
    }

    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/socios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(json.error ?? CONTACTO.errorEnvio);
        return;
      }
      setStatus("success");
      form.reset();
    } catch {
      setStatus("error");
      setErrorMsg(CONTACTO.sinConexion);
    }
  }

  return (
    <section id="contacto" className="bg-white text-om-navy">
      <div className="mx-auto max-w-[760px] px-6 py-20 sm:px-10 sm:py-24">
        <div className="reveal text-center">
          <h2 className={H2}>{CONTACTO.h2}</h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-[1.0625rem] leading-relaxed text-om-navy/75">
            {CONTACTO.bajada}
          </p>
        </div>

        {status === "success" ? (
          <div
            role="status"
            className="reveal mt-12 rounded-[8px] border border-om-brassInk/30 bg-om-cream/50 px-6 py-8 text-center"
          >
            <p className="text-[1.0625rem] font-semibold text-om-navy">{CONTACTO.exito}</p>
            <p className="mt-2 text-[0.9375rem] text-om-navy/80">{CONTACTO.exitoLinea2}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="reveal mt-12 grid gap-5 sm:grid-cols-2" noValidate>
            {/* Honeypot: oculto visualmente, presente en el DOM. Ningún humano lo llena. */}
            <p className="absolute h-0 w-0 overflow-hidden" aria-hidden="true">
              <label htmlFor={`${formId}-website`}>No llenar este campo</label>
              <input type="text" id={`${formId}-website`} name="website" tabIndex={-1} autoComplete="off" />
            </p>

            <div className="flex flex-col gap-1.5 sm:col-span-1">
              <label htmlFor={`${formId}-nombre`} className={labelClass}>
                Su nombre
              </label>
              <input id={`${formId}-nombre`} name="nombre" type="text" required className={fieldClass} />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-1">
              <label htmlFor={`${formId}-negocio`} className={labelClass}>
                Nombre del negocio
              </label>
              <input id={`${formId}-negocio`} name="negocio" type="text" required className={fieldClass} />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-1">
              <label htmlFor={`${formId}-tipo`} className={labelClass}>
                Tipo de negocio
              </label>
              <select id={`${formId}-tipo`} name="tipo" required defaultValue="" className={fieldClass}>
                <option value="" disabled>
                  Elija una opción
                </option>
                {CONTACTO.tipoOpciones.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-1">
              <label htmlFor={`${formId}-canton`} className={labelClass}>
                Cantón
              </label>
              <input
                id={`${formId}-canton`}
                name="canton"
                type="text"
                required
                placeholder="Dónde está su punto de venta"
                className={fieldClass}
              />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-1">
              <label htmlFor={`${formId}-whatsapp`} className={labelClass}>
                WhatsApp
              </label>
              <input
                id={`${formId}-whatsapp`}
                name="whatsapp"
                type="tel"
                inputMode="numeric"
                required
                placeholder="8888 8888"
                className={fieldClass}
              />
              <span className="text-[0.8125rem] text-om-navy/60">Por aquí le mandamos el catálogo</span>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-1">
              <label htmlFor={`${formId}-correo`} className={labelClass}>
                Correo (opcional)
              </label>
              <input id={`${formId}-correo`} name="correo" type="email" className={fieldClass} />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor={`${formId}-mensaje`} className={labelClass}>
                ¿Algo que debamos saber?
              </label>
              <textarea
                id={`${formId}-mensaje`}
                name="mensaje"
                rows={3}
                placeholder="Su formato, su temporada alta, su clientela"
                className={`${fieldClass} min-h-[96px] resize-y py-3`}
              />
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <label className="flex items-start gap-2.5 text-[0.8125rem] leading-relaxed text-om-navy/80">
                <input
                  type="checkbox"
                  name="aceptaPrivacidad"
                  required
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-om-navy/35 text-om-brassInk focus:ring-om-brassInk/40"
                />
                <span>{AVISO_PRIVACIDAD.checkboxLabel}</span>
              </label>

              <details className="ml-6 text-[0.8125rem] text-om-navy/70">
                <summary className="cursor-pointer text-om-brassInk underline decoration-om-brassInk/40 underline-offset-2">
                  {AVISO_PRIVACIDAD.linkTexto}
                </summary>
                <div className="mt-2 max-w-[52ch] space-y-1.5 leading-relaxed">
                  <p className="font-medium text-om-navy/80">{AVISO_PRIVACIDAD.titulo}</p>
                  {AVISO_PRIVACIDAD.cuerpo.map((linea, i) => (
                    <p key={i}>{linea}</p>
                  ))}
                </div>
              </details>
            </div>

            {status === "error" && (
              <p role="alert" className="sm:col-span-2 text-[0.875rem] text-error-text">
                {errorMsg}
                {errorMsg === CONTACTO.errorEnvio && (
                  <>
                    {" "}
                    <a
                      href={WHATSAPP_BLOO.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline decoration-current/40 underline-offset-2"
                    >
                      {WHATSAPP_BLOO.display}
                    </a>
                    .
                  </>
                )}
              </p>
            )}

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={status === "loading"}
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[8px] bg-om-navy px-6 text-[0.9375rem] font-semibold text-om-bone transition-colors hover:bg-om-navy/90 disabled:opacity-60 sm:w-auto"
              >
                {status === "loading" ? CONTACTO.cargando : CONTACTO.boton}
              </button>
              <p className="mt-3 text-[0.8125rem] text-om-navy/60">{CONTACTO.notaBoton}</p>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
