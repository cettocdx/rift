"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";

const TRACKED_ROUTES = [
  "/landing",
  "/pricing",
  "/upgrade",
  "/signup",
  "/login",
  "/invite",
];

/** Keep advertising code off latency-sensitive product surfaces. */
export function MarketingAnalytics() {
  const pathname = usePathname();
  // Public env values are baked into the browser bundle; canaries must opt out
  // before building. An unset value preserves the public site's behavior.
  if (process.env.NEXT_PUBLIC_MARKETING_ANALYTICS_ENABLED === "false")
    return null;

  const shouldLoad = TRACKED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (!shouldLoad) return null;

  return (
    <>
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=AW-18267889487"
        strategy="lazyOnload"
      />
      <Script id="google-ads-gtag" strategy="lazyOnload">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'AW-18267889487');
        `}
      </Script>
    </>
  );
}
