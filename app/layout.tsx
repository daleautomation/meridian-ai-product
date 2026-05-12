import type { Metadata, Viewport } from "next";
import { getSession } from "@/lib/auth";
import { SessionProvider } from "@/components/SessionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meridian AI | Operator-grade intelligence systems",
  description:
    "Meridian AI audits operations and builds custom intelligence workspaces for cleaner execution, better lead quality, and stronger revenue.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();

  return (
    <html lang="en">
      <body>
        <SessionProvider initialUser={user ?? null}>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
