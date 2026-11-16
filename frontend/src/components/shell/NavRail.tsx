"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RISK_COLOR } from "@/lib/format";
import { useStore } from "@/lib/store";

const ITEMS = [
  {
    href: "/",
    label: "Operations",
    icon: (
      <path d="M3 3h6v6H3zM11 3h6v3h-6zM11 8h6v9h-6zM3 11h6v6H3z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    ),
  },
  {
    href: "/twin",
    label: "Twin",
    icon: (
      <path d="M10 2.5 17 6v8l-7 3.5L3 14V6zM3 6l7 3.5L17 6M10 9.5v8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    ),
  },
  {
    href: "/forecast",
    label: "Forecast",
    icon: <path d="M3 3v14h14M6 12l3-4 3 2 4-6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    href: "/alerts",
    label: "Alerts",
    icon: <path d="M10 3 2.5 16h15zM10 8v4M10 14v.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  },
];

export function NavRail() {
  const pathname = usePathname();
  const warnings = useStore((s) => s.data?.warnings);
  const urgent = warnings ? warnings.counts.ACT + warnings.counts.PREPARE : 0;

  return (
    <nav className="flex flex-col items-stretch gap-1 border-r border-line bg-panel py-2" aria-label="Sections">
      {ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative mx-1.5 flex flex-col items-center gap-1 rounded-md py-2 transition-colors ${active ? "bg-panel-3 text-fg" : "text-fg-3 hover:text-fg-2"}`}
          >
            {active && <span className="absolute -left-1.5 top-2 h-7 w-0.5 rounded-r bg-water" />}
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
              {item.icon}
            </svg>
            <span className="text-[9.5px] tracking-wide">{item.label}</span>
            {item.href === "/alerts" && urgent > 0 && warnings && (
              <span
                className="num absolute right-1.5 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-medium text-bg"
                style={{ background: RISK_COLOR[warnings.system_level] }}
              >
                {urgent}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
