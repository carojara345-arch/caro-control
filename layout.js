import "./globals.css";

export const metadata = {
  title: "Caro Control",
  description: "Sistema personal de gestión profesional y contable de Carolina",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
