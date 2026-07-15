import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Metadata-Based Model Router — POC",
  description: "Predict the cheapest capable model before calling the LLM.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
