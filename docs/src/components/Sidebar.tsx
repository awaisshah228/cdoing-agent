"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  {
    title: "Getting Started",
    items: [
      { name: "Introduction", href: "/" },
      { name: "Installation & Setup", href: "/getting-started" },
      { name: "Contributing Guide", href: "/contributing" },
    ],
  },
  {
    title: "Architecture",
    items: [
      { name: "Overview", href: "/architecture" },
      { name: "Project Structure", href: "/architecture#project-structure" },
      { name: "Data Flow", href: "/architecture#data-flow" },
    ],
  },
  {
    title: "Packages",
    items: [
      { name: "Core Package", href: "/core-package" },
      { name: "AI Package", href: "/ai-package" },
      { name: "CLI Package", href: "/cli" },
      { name: "VSCode Extension", href: "/vscode-extension" },
    ],
  },
  {
    title: "Systems",
    items: [
      { name: "Tools System", href: "/tools" },
      { name: "Permissions & Sandbox", href: "/permissions" },
      { name: "OAuth Authentication", href: "/oauth" },
    ],
  },
];

export default function Sidebar({ mobileOpen, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      {mobileOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        {navigation.map((section) => (
          <div key={section.title} className="sidebar-section">
            <div className="sidebar-section-title">{section.title}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${
                  pathname === item.href ? "active" : ""
                }`}
                onClick={onClose}
              >
                {item.name}
              </Link>
            ))}
          </div>
        ))}
      </aside>
    </>
  );
}
