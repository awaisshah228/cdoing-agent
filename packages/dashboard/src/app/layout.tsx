import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { ConnectionStatus } from "@/components/connection-status";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cdoing Agent Dashboard",
  description: "Admin dashboard for Remote Coding Agent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Sidebar />
        <main className="ml-64 min-h-screen">
          <header className="h-16 flex items-center justify-between px-8 border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-40">
            <div />
            <ConnectionStatus />
          </header>
          <div className="p-8">{children}</div>
        </main>
      </body>
    </html>
  );
}
