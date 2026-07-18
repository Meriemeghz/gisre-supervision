"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "Dashboard", detail: "Temps reel" },
  { href: "/investigations", label: "Investigations", detail: "Validation IA" },
  { href: "/models", label: "Modeles IA", detail: "Lifecycle" },
  { href: "/analyze", label: "Analyse", detail: "Historique" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brandLogo" src="/brand/gisre-logo.png" alt="GISRE - Plateforme nationale d'interoperabilite" />
        </div>

        <nav className="nav" aria-label="Navigation principale">
          {navItems.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link className={active ? "active" : ""} href={item.href} key={item.href}>
                <span>{item.label}</span>
                <small>{item.detail}</small>
              </Link>
            );
          })}
        </nav>

        <div className="sidebarStatus">
          <span className="statusDot" />
          <div>
            <strong>Pipeline actif</strong>
            <small>Kafka - AI - Dashboard</small>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbarTitle">
            <span>Observability Console</span>
            <strong>GISRE Interoperability</strong>
          </div>
          <div className="topbarSearch">
            <span />
            <input aria-label="Recherche globale" placeholder="Rechercher flow, API, acteur, anomalie..." />
          </div>
          <div className="topbarActions">
            <span className="topbarPill">Realtime</span>
            <span className="topbarAvatar">AI</span>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
