import { SITE_NAME, SITE_ORIGIN, absoluteUrl } from "@/lib/site/canonical";

/**
 * What the product is, in the vocabulary a search engine reads.
 *
 * A page can describe itself perfectly in prose and still be invisible to the
 * machinery that decides whether it earns a rich result. This is the same
 * claims the page already makes — the name, what category it is in, what it
 * costs, who publishes it — restated as schema.org so they can be parsed
 * instead of inferred.
 *
 * Everything asserted here is verifiable on the page it ships with. Nothing is
 * invented for the crawler: no rating, no review count, no award. Those are the
 * fields that produce the biggest rich results and the fastest manual penalty,
 * and there is no honest source for them yet.
 */
export function StructuredData() {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_ORIGIN}/#organization`,
        name: SITE_NAME,
        url: SITE_ORIGIN,
        logo: absoluteUrl("/icon-512x512.png"),
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        url: SITE_ORIGIN,
        name: SITE_NAME,
        publisher: { "@id": `${SITE_ORIGIN}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_ORIGIN}/#app`,
        name: SITE_NAME,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web, macOS, Windows, Linux",
        url: SITE_ORIGIN,
        publisher: { "@id": `${SITE_ORIGIN}/#organization` },
        description:
          "The workstation your agents run on. They plan, write, execute and verify inside a real sandbox — with a terminal, a filesystem and the frontier models already wired in.",
        featureList: [
          "Agents that execute and verify inside a real sandbox",
          "Image and video generation behind one prompt box",
          "Security assessment in an isolated container",
          "Twenty-nine specialist agent archetypes",
          "MCP plugins and a real terminal",
        ],
        // Pointing at the page that states the plans rather than restating a
        // price here: a number in the markup and a different number on the
        // pricing page is the failure mode this avoids.
        offers: {
          "@type": "Offer",
          url: absoluteUrl("/pricing"),
          category: "subscription",
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // The payload is built from constants in this file, not from user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
