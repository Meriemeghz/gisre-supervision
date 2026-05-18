import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "GISRE Supervision",
  description: "Dashboard intelligent de supervision GISRE",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">
              <span className="brandMark">G</span>
              <div>
                <strong>GISRE</strong>
                <small>Supervision IA</small>
              </div>
            </div>
            <nav className="nav">
              <Link href="/">Dashboard</Link>
              <Link href="/alerts">Alertes IA</Link>
              <Link href="/events">Evenements</Link>
              <Link href="/models">Modeles IA</Link>
              <Link href="/analyze">Analyse historique</Link>
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
