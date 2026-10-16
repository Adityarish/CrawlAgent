import "./globals.css";
import "leaflet/dist/leaflet.css";

const deploymentHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL
  : deploymentHost
    ? `https://${deploymentHost}`
    : "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: "JobAtlas — Better work starts here",
  description: "A focused job discovery workspace for ambitious people.",
  openGraph: {
    title: "JobAtlas",
    description: "A focused job discovery workspace for ambitious people.",
    type: "website",
    images: [
      {
        url: "/jobatlas-og-preview.jpg",
        width: 1341,
        height: 574,
        alt: "JobAtlas — Better work starts here",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "JobAtlas",
    description: "A focused job discovery workspace for ambitious people.",
    images: ["/jobatlas-og-preview.jpg"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
