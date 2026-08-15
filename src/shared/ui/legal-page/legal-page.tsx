import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function LegalPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl pb-16 pt-4 sm:pt-8">
      <Link
        href="/data/"
        className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft size={16} />
        Back to LIBERO EDA
      </Link>
      <header className="mt-6 border-b border-base-300 pb-7">
        <p className="eyebrow">LIBERO EDA</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-base-content/65">{description}</p>
        <p className="mt-4 text-xs text-base-content/50">Effective August 15, 2026</p>
      </header>
      <div className="legal-copy mt-8 space-y-8">{children}</div>
    </article>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-base-content/70">{children}</div>
    </section>
  );
}
