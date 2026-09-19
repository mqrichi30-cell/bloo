import Image from "next/image";
import { socioImageExists } from "../_lib/images";

interface ProductImageProps {
  file: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  className?: string;
  priority?: boolean;
}

/**
 * PNG sin fondo en /public/socios/<file> si Cristhofer ya lo subió; si no,
 * un placeholder sólido con las mismas dimensiones (sin servicios externos,
 * per la tarea). Server Component: la verificación de archivo (fs) corre en
 * el servidor.
 */
export function ProductImage({ file, alt, width, height, sizes, className = "", priority }: ProductImageProps) {
  if (socioImageExists(file)) {
    return (
      <Image
        src={`/socios/${file}`}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        priority={priority}
        className={className}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={alt}
      className={`flex items-center justify-center border border-om-sand/70 bg-om-bone ${className}`}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <svg
        width="34%"
        viewBox="0 0 64 28"
        fill="none"
        aria-hidden="true"
        className="text-om-sand"
      >
        <path
          d="M2 14c0-5 5-8 12-8s12 3 12 8-5 8-12 8-12-3-12-8Z"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M38 14c0-5 5-8 12-8s12 3 12 8-5 8-12 8-12-3-12-8Z"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path d="M26 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M2 12 0 8M62 12l2-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
