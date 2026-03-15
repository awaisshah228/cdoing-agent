"use client";

import { useState } from "react";
import Link from "next/link";

export default function Header({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="header">
      <button
        className="hamburger"
        onClick={() => {
          setMenuOpen(!menuOpen);
          onToggleSidebar?.();
        }}
        aria-label="Toggle navigation"
      >
        <span className={`hamburger-line ${menuOpen ? "open" : ""}`} />
        <span className={`hamburger-line ${menuOpen ? "open" : ""}`} />
        <span className={`hamburger-line ${menuOpen ? "open" : ""}`} />
      </button>
      <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>
          <span style={{ color: "var(--accent)" }}>Cdoing</span> Agent
        </span>
        <span className="badge badge-purple">Docs</span>
      </Link>
      <nav className="header-nav">
        <Link href="/getting-started" className="header-nav-link">
          Guide
        </Link>
        <Link href="/architecture" className="header-nav-link">
          Architecture
        </Link>
        <Link href="/contributing" className="header-nav-link">
          Contributing
        </Link>
        <a
          href="https://github.com/your-org/cdoing-agent"
          target="_blank"
          rel="noopener noreferrer"
          className="header-nav-link"
        >
          GitHub
        </a>
      </nav>
    </header>
  );
}
