import "./globals.css";
import { SessionProvider } from "../components/SessionProvider";
import { getSession } from "../lib/auth";

export const metadata = {
  title: "Decision Platform",
  description: "Modular decision platform shell",
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


