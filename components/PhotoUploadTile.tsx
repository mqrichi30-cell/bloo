"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";

interface PhotoUploadTileProps {
  imageUrl?: string | null;
  onPick: (file: File) => Promise<void> | void;
  loading?: boolean;
}

export function PhotoUploadTile({ imageUrl, onPick, loading }: PhotoUploadTileProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const displayUrl = preview ?? imageUrl ?? null;

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative flex h-40 w-40 items-center justify-center overflow-hidden rounded-lg bg-surface-alt transition-transform active:scale-[0.98]"
        aria-label="Cambiar foto del modelo"
      >
        {displayUrl && (
          // /api/uploads/models requiere sesión; el optimizador de next/image
          // la fetchea server-side sin cookie y rompe la miniatura. <img>
          // normal la pide desde el browser.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={displayUrl}
            src={displayUrl}
            alt=""
            className="h-full w-full object-cover animate-toast-in"
          />
        )}
        <div className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-navy-900 text-white shadow-md">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setPreview(URL.createObjectURL(file));
          await onPick(file);
          e.target.value = "";
        }}
      />
      <p className="text-caption text-ink-600">JPEG, PNG o WEBP, máx 5MB</p>
    </div>
  );
}
