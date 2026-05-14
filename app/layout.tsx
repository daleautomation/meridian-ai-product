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
  title: "Meridian AI | Relationship Priority Queue",
  description:
    "Meridian AI prioritizes existing relationships, stale opportunities, and follow-up work so operators know who matters, why, and what to do next.",
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
