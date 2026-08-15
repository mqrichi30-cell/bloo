import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ResetForm } from "./ResetForm";

export default function ResetPage() {
  return (
    <div className="mobile-shell flex min-h-dvh flex-col bg-white px-6 pb-10 pt-6">
      <Link
        href="/login"
        className="inline-flex min-h-[44px] w-fit items-center gap-1.5 text-label text-ink-600"
      >
        <ArrowLeft size={18} aria-hidden="true" />
        Volver a iniciar sesión
      </Link>

      <div className="flex flex-1 flex-col gap-2">
        <div className="flex justify-center pt-6">
          <Logo variant="dark" height={30} />
        </div>

        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
