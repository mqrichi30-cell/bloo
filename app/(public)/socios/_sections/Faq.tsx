import { FAQ } from "../_content";
import { H2 } from "../_ui/typography";

export function Faq() {
  return (
    <section id="faq" className="bg-om-navy text-om-cream">
      <div className="mx-auto max-w-[860px] px-6 py-20 sm:px-10 sm:py-24">
        <h2 className={`${H2} reveal text-om-bone`}>{FAQ.h2}</h2>

        <div className="reveal mt-10 divide-y divide-om-cream/15 border-y border-om-cream/15">
          {FAQ.items.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[1.0625rem] font-medium text-om-bone marker:content-none [&::-webkit-details-marker]:hidden">
                <span>{item.q}</span>
                <span
                  aria-hidden="true"
                  className="mt-1 shrink-0 text-[1.25rem] leading-none text-om-brassSoft transition-transform duration-200 group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <div className="mt-3 max-w-[68ch] space-y-3">
                {item.a.map((parrafo, i) => (
                  <p key={i} className="text-[0.9375rem] leading-relaxed text-om-cream/80">
                    {parrafo}
                  </p>
                ))}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
