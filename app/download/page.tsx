import type { Metadata } from "next";
import { DownloadPageContent } from "./DownloadPageContent";

export const metadata: Metadata = {
  title: "Download | RIFT",
  description:
    "Download the RIFT direct desktop build for macOS on Apple Silicon. The Windows release is in progress. On mobile, install RIFT from your browser.",
  openGraph: {
    title: "Download RIFT",
    description:
      "Download the RIFT direct desktop build for macOS on Apple Silicon. The Windows release is in progress. On mobile, install RIFT from your browser.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Download RIFT",
    description:
      "Download the RIFT direct desktop build for macOS on Apple Silicon. The Windows release is in progress. On mobile, install RIFT from your browser.",
  },
};

export default function DownloadPage() {
  return <DownloadPageContent />;
}
