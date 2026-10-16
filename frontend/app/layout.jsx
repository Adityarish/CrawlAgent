import "./globals.css";
import "leaflet/dist/leaflet.css";

export const metadata = {
  title: "JobAtlas — Better work starts here",
  description: "A focused job discovery workspace for ambitious people.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
