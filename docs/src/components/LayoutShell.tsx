"use client";

import { useState, useCallback } from "react";
import Header from "./Header";
import Sidebar from "./Sidebar";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <>
      <Header onToggleSidebar={toggleSidebar} />
      <Sidebar mobileOpen={sidebarOpen} onClose={closeSidebar} />
      <main className="main-content">{children}</main>
    </>
  );
}
