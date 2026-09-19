import { FOOTER, WHATSAPP_BLOO } from "../_content";
import { Logo } from "../_ui/Logo";
import { Token } from "../_ui/Token";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-om-navy text-om-cream/70">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-6 py-10 text-[0.8125rem] sm:flex-row sm:items-center sm:justify-between sm:px-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          <Logo className="h-5 text-om-cream/70" />
          <p>
            © {year} bloo. {FOOTER.nota}
          </p>
        </div>
        <p className="flex items-center gap-1.5">
          <span>WhatsApp</span>
          <a
            href={WHATSAPP_BLOO.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-om-cream underline decoration-om-cream/40 underline-offset-2 hover:decoration-om-cream/70"
          >
            {WHATSAPP_BLOO.display}
          </a>
          <span aria-hidden="true">·</span>
          <span>Correo</span>
          <Token name="EMAIL_BLOO" tone="dark" />
        </p>
      </div>
    </footer>
  );
}
