import { getSession } from "@/lib/auth";
import { SessionProvider } from "@/components/SessionProvider";

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
