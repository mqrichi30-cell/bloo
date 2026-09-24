"use client";

import { useRef, useState } from "react";
import { Glasses } from "lucide-react";
import type { ListingImage } from "./types";

interface ImageCarouselProps {
  images: ListingImage[];
  alt: string;
}

/** Carrusel de imágenes 'lista' con scroll-snap nativo — sin librería, gesto táctil real. */
export function ImageCarousel({ images, alt }: ImageCarouselProps) {
  const ready = images.filter((img) => img.estado === "lista" && img.publicUrl);
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  if (ready.length === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-surface-alt text-blue-300">
        <Glasses size={40} strokeWidth={1.5} />
      </div>
    );
  }

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    setActive(index);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="no-scrollbar flex w-full snap-x snap-mandatory overflow-x-auto rounded-lg"
      >
        {ready.map((img) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={img.id}
            src={img.publicUrl ?? undefined}
            alt={alt}
            className="aspect-square w-full shrink-0 snap-center object-cover"
            loading="lazy"
          />
        ))}
      </div>
      {ready.length > 1 && (
        <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
          {ready.map((img, i) => (
            <span
              key={img.id}
              className={`h-1.5 rounded-full transition-all ${
                i === active ? "w-4 bg-navy-900" : "w-1.5 bg-line-200"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
