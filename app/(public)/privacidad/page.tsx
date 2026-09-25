import type { Metadata } from "next";

// Política pública exigida por Meta App Review para la respuesta automática
// de Messenger. Debe ser accesible SIN sesión (ver PUBLIC_PATHS en
// middleware.ts) y el ancla #eliminar-datos es la "Data Deletion Instructions
// URL" que se registra en la app de Meta. Si cambia lo que guarda
// MetaConversation (prisma/schema.prisma) o lo que se manda a Anthropic
// (lib/meta/conversation.ts), actualizar este texto: tiene que ser verdad.

const ACTUALIZADO = "25 de setiembre de 2026";
const EMAIL = "mqrichi30@gmail.com";
const WHATSAPP_URL = "https://wa.me/50689433677";

export const metadata: Metadata = {
  title: "Política de privacidad — bloo",
  description:
    "Cómo bloo trata los datos de quienes nos escriben por Messenger y de nuestros anuncios en Marketplace.",
  robots: { index: true, follow: true },
};

function Seccion({ id, titulo, children }: { id?: string; titulo: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-om-sand/60 pt-6">
      <h2 className="mb-3 text-xl font-semibold text-om-navy">{titulo}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-ink-900">{children}</div>
    </section>
  );
}

export default function PrivacidadPage() {
  return (
    <main className="min-h-screen bg-om-bone">
      <header className="bg-om-navy px-5 py-10 text-om-cream">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm tracking-widest">bloo</p>
          <h1 className="mt-2 text-3xl font-semibold">Política de privacidad</h1>
          <p className="mt-2 text-sm text-om-cream/80">Última actualización: {ACTUALIZADO}</p>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-8 px-5 py-10">
        <Seccion titulo="Quiénes somos">
          <p>
            bloo es un emprendimiento costarricense de lentes de sol. El responsable del tratamiento de
            datos es Cristhofer Marín. Contacto: WhatsApp{" "}
            <a className="text-om-brassInk underline" href={WHATSAPP_URL}>
              +506 8943 3677
            </a>{" "}
            o{" "}
            <a className="text-om-brassInk underline" href={`mailto:${EMAIL}`}>
              {EMAIL}
            </a>
            .
          </p>
        </Seccion>

        <Seccion titulo="Qué datos tratamos de Messenger">
          <p>Cuando nos escribís a la Página de bloo en Facebook Messenger recibimos:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Tu identificador de Messenger para nuestra Página (PSID). No es tu nombre ni tu perfil: Meta
              lo asigna solo para esta Página.
            </li>
            <li>El texto del mensaje que nos enviás.</li>
            <li>La fecha y hora de los mensajes.</li>
          </ul>
          <p>No pedimos ni recibimos por esta vía tu teléfono, correo, fotos ni datos de pago.</p>
        </Seccion>

        <Seccion titulo="Para qué los usamos">
          <p>
            Únicamente para responder tus consultas de compra (modelos, colores, precios, entrega). Algunas
            respuestas son automáticas y las genera una inteligencia artificial de Anthropic: para eso, el
            texto de tu mensaje se envía a Anthropic, que lo procesa para redactar la respuesta. Cuando la
            consulta lo requiere, te atiende una persona de bloo.
          </p>
          <p>No usamos tus datos para publicidad ni para crear perfiles.</p>
        </Seccion>

        <Seccion titulo="Qué guardamos y por cuánto tiempo">
          <p>
            En nuestra base de datos guardamos solo el PSID, las fechas de los mensajes, el identificador
            técnico del último mensaje (para no contestar dos veces) y contadores (cuántos mensajes y
            respuestas automáticas hubo). <strong>No guardamos el texto de tus mensajes.</strong>
          </p>
          <p>
            Esos datos se conservan mientras la conversación siga activa o hasta que pidas eliminarlos. El
            historial de la conversación sí queda en Messenger, bajo la política de privacidad de Meta.
          </p>
        </Seccion>

        <Seccion titulo="No vendemos tus datos">
          <p>No vendemos, alquilamos ni cedemos tus datos personales a nadie.</p>
        </Seccion>

        <Seccion titulo="Terceros que intervienen">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Meta Platforms</strong> (Facebook, Messenger, Marketplace): plataforma por la que nos
              escribís.
            </li>
            <li>
              <strong>Anthropic</strong>: IA que recibe el texto del mensaje para generar la respuesta
              automática.
            </li>
            <li>
              <strong>Supabase</strong>: base de datos donde se guardan el PSID, fechas y contadores.
            </li>
            <li>
              <strong>Netlify</strong>: aloja el sistema que recibe y responde los mensajes.
            </li>
          </ul>
          <p>Cada uno trata los datos según sus propias políticas y solo para prestarnos el servicio.</p>
        </Seccion>

        <Seccion titulo="Anuncios en Marketplace">
          <p>
            Las fotos y precios de nuestros anuncios en Facebook Marketplace son de nuestros productos. Las
            fotos pueden ser del producto o imágenes de ambientación; no incluyen datos de clientes.
          </p>
        </Seccion>

        <Seccion titulo="Tus derechos (Ley 8968)">
          <p>
            Según la Ley de Protección de la Persona frente al Tratamiento de sus Datos Personales (Ley N.°
            8968) de Costa Rica, tenés derecho a acceder a tus datos, rectificarlos, pedir su eliminación y
            oponerte a su tratamiento. Si considerás que no atendimos tu solicitud, podés acudir a la Agencia
            de Protección de Datos de los Habitantes (PRODHAB).
          </p>
        </Seccion>

        <Seccion id="eliminar-datos" titulo="Cómo pedir la eliminación de tus datos">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Escribinos por WhatsApp al{" "}
              <a className="text-om-brassInk underline" href={WHATSAPP_URL}>
                +506 8943 3677
              </a>{" "}
              o al correo{" "}
              <a className="text-om-brassInk underline" href={`mailto:${EMAIL}`}>
                {EMAIL}
              </a>
              , o mandanos &quot;eliminar mis datos&quot; por Messenger.
            </li>
            <li>Indicá que nos escribiste por Messenger a la Página de bloo (y tu nombre en Facebook).</li>
            <li>
              Eliminamos el registro asociado a tu PSID de nuestra base de datos en un plazo máximo de 5 días
              hábiles y te confirmamos por el mismo medio.
            </li>
          </ol>
          <p>
            Para borrar el historial del chat en Messenger, podés eliminar la conversación desde tu cuenta de
            Facebook.
          </p>
        </Seccion>
      </div>
    </main>
  );
}
