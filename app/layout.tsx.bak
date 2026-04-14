import "./globals.css";
import { SessionProvider } from "../components/SessionProvider";
import { getSession } from "../lib/auth";

export const metadata = {
  title: "Meridian AI — Decision Platform",
  description: "Acquisition intelligence for luxury goods and real estate.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();
  return (
    <html lang="en">
      <body>
        <SessionProvider initialUser={user}>{children}</SessionProvider>
      </body>
    </html>
  );
}
