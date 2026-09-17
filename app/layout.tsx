import { UiPerformanceProbe } from "./components/UiPerformanceProbe";
import { AccountRetainedChatProvider } from "./contexts/RetainedChatContext";
/* eslint-disable @next/next/no-css-tags -- the product shell skin is a public asset loaded before paint; keeping it separate preserves the standard rollback bundle. */
import type { Metadata, Viewport } from "next";
import {
  JetBrains_Mono,
  Geist,
  Space_Grotesk,
  Pixelify_Sans,
} from "next/font/google";
import Script from "next/script";
import "./globals.css";
import "./styles/workspace.css";
import "./styles/typography.css";
import "./styles/mobile-chat.css";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { GlobalStateProvider } from "./contexts/GlobalState";
import { InputProvider } from "./contexts/InputContext";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { TodoBlockProvider } from "./contexts/TodoBlockContext";
import { PostHogProvider } from "./providers";
import { DataStreamProvider } from "./components/DataStreamProvider";
import { ThemeProvider } from "./components/ThemeProvider";
import { MarketingAnalytics } from "./components/MarketingAnalytics";
import { APPEARANCE_BOOTSTRAP_SCRIPT } from "@/lib/appearance/presets";
import { ExtraUsagePurchaseToast } from "./components/extra-usage/ExtraUsagePurchaseToast";

import { SITE_ORIGIN } from "@/lib/site/canonical";
import { StructuredData } from "@/app/components/StructuredData";
import { AppLaunchProvider } from "@/components/launch/AppLaunchProvider";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

// Geist = clean, readable body (UI default). Space Grotesk = geometric display
// font for brand wordmark and headings (the bit of RIFT character).
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

// Pixelify Sans = chunky pixel display, standing in for the snulja "Pixeloid"
// brand/accent face (big RIFT wordmark, pixel numerals, kicker labels).
const pixelifySans = Pixelify_Sans({
  variable: "--font-pixel-src",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const APP_NAME = "RIFT";
const APP_DEFAULT_TITLE = "RIFT - The Professional AI Agent";
const APP_TITLE_TEMPLATE = "%s | RIFT";
const APP_DESCRIPTION =
  "RIFT is a professional AI agent that builds software, creates images, and runs security tests. Describe what you need and it plans, runs the real tools in an isolated cloud sandbox, and delivers the finished result.";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  // SITE_ORIGIN, not an inline default. The fallback here used to be
  // "https://rift.co" — a domain this product does not serve from — so any
  // deployment without NEXT_PUBLIC_BASE_URL set resolved every canonical and
  // every share-image URL to a host nobody owns.
  metadataBase: new URL(SITE_ORIGIN),
  alternates: { canonical: "/" },
  applicationName: APP_NAME,
  title: {
    default: APP_DEFAULT_TITLE,
    template: "%s",
  },
  description: APP_DESCRIPTION,
  manifest: "/manifest.json",
  icons: {
    icon: [
      {
        url: "/rift-icon.svg",
        type: "image/svg+xml",
        sizes: "any",
      },
    ],
    shortcut: "/rift-icon.svg",
    apple: "/apple-touch-icon.png",
  },
  // No `keywords`. Google stopped reading the meta keywords tag in 2009 and
  // every other major engine followed; the array that stood here was fourteen
  // lines telling nobody anything.
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: {
      default: APP_DEFAULT_TITLE,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
    // No `images` here on purpose. An explicit array outranks the file-based
    // convention, and it was pinning every share to /icon-512x512.png — the
    // square app icon — while app/opengraph-image.tsx sat unused. Removing it
    // hands both og:image and twitter:image to the generated 1200x630 card.
  },
  twitter: {
    // The large card. "summary" renders a 120px square thumbnail beside the
    // text; every share of this URL was spending its one impression on that.
    card: "summary_large_image",
    title: {
      default: APP_DEFAULT_TITLE,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
    // No `images` here on purpose. An explicit array outranks the file-based
    // convention, and it was pinning every share to /icon-512x512.png — the
    // square app icon — while app/opengraph-image.tsx sat unused. Removing it
    // hands both og:image and twitter:image to the generated 1200x630 card.
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestedUiSkin = process.env.RIFT_UI_SKIN;
  const uiSkin =
    requestedUiSkin === "hack-terminal"
      ? "hack-terminal"
      : requestedUiSkin === "cursor"
        ? "cursor"
        : requestedUiSkin === "tui"
          ? "tui"
          : undefined;
  const content = (
    <GlobalStateProvider>
      <InputProvider>
        <PostHogProvider>
          <AccountRetainedChatProvider>
            <DataStreamProvider>
              <TodoBlockProvider>
                <TooltipProvider>
                  {children}
                  <UiPerformanceProbe />
                  <ExtraUsagePurchaseToast />
                  <Toaster />
                </TooltipProvider>
              </TodoBlockProvider>
            </DataStreamProvider>
          </AccountRetainedChatProvider>
        </PostHogProvider>
      </InputProvider>
    </GlobalStateProvider>
  );

  return (
    <ConvexAuthNextjsServerProvider>
      <html
        lang="en"
        className="h-full"
        data-ui-skin={uiSkin}
        suppressHydrationWarning
      >
        <head>
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          {uiSkin === "hack-terminal" ? (
            <link rel="stylesheet" href="/workbench-preview.css" />
          ) : null}
          <Script id="rift-appearance-bootstrap" strategy="beforeInteractive">
            {APPEARANCE_BOOTSTRAP_SCRIPT}
          </Script>
          {/* In the RIFT desktop (Tauri) wrapper, flag the document so the
              sidebar goes translucent and the macOS window vibrancy shows
              through as real "glass". Runs before paint (no flash); no-op in a
              regular browser. */}
          <Script id="rift-vibrancy-bootstrap" strategy="beforeInteractive">
            {
              "try{var ua=navigator.userAgent||'';if(ua.includes('Macintosh')&&(ua.includes('RIFT-Desktop')||ua.includes('RIFTWrapperLite')||window.__RIFT_DESKTOP_LITE__===true)){document.documentElement.classList.add('rift-vibrancy')}}catch(e){}"
            }
          </Script>
        </head>
        <body
          className={`${jetbrainsMono.variable} ${geist.variable} ${spaceGrotesk.variable} ${pixelifySans.variable} antialiased h-full`}
          suppressHydrationWarning
        >
          <StructuredData />
          <ThemeProvider>
            <ConvexClientProvider>
              <AppLaunchProvider>{content}</AppLaunchProvider>
            </ConvexClientProvider>
          </ThemeProvider>
          <MarketingAnalytics />
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
