"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function Carousel({
  eyebrow,
  title,
  children,
  href,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  href?: string;
}) {
  return (
    <section className="content-section">
      <div className="section-header">
        <div><span>{eyebrow}</span><h2>{title}</h2></div>
        {href && <Link href={href}>View all <ChevronRight size={14} /></Link>}
      </div>
      <div className="content-grid batch4-carousel">{children}</div>
    </section>
  );
}
