import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { getSession } from "@/lib/auth";
import { SessionProvider } from "@/components/SessionProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

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
    <html lang="en" className={inter.variable}>
      <body>
        <SessionProvider initialUser={user ?? null}>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
