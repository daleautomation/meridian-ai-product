import "./globals.css";

export const metadata = {
  title: "Decision Platform",
  description: "Modular decision platform shell",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


