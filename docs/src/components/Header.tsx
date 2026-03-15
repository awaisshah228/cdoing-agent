import Link from "next/link";

export default function Header() {
  return (
    <header className="header">
      <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>
          <span style={{ color: "var(--accent)" }}>Cdoing</span> Agent
        </span>
        <span className="badge badge-purple">Docs</span>
      </Link>
      <nav style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
        <Link href="/getting-started" style={{ padding: "6px 12px", borderRadius: 6, fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>
          Guide
        </Link>
        <Link href="/architecture" style={{ padding: "6px 12px", borderRadius: 6, fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>
          Architecture
        </Link>
        <Link href="/contributing" style={{ padding: "6px 12px", borderRadius: 6, fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>
          Contributing
        </Link>
        <a
          href="https://github.com/your-org/cdoing-agent"
          target="_blank"
          rel="noopener noreferrer"
          style={{ padding: "6px 12px", borderRadius: 6, fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}
        >
          GitHub
        </a>
      </nav>
    </header>
  );
}
