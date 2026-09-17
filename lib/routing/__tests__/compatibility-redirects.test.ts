import {
  COMPATIBILITY_REDIRECTS,
  getCompatibilityRedirects,
} from "../compatibility-redirects";

describe("compatibility redirects", () => {
  it("routes retired entry points to the surfaces that own them", () => {
    expect(getCompatibilityRedirects()).toEqual(
      expect.arrayContaining([
        { source: "/notebook", destination: "/hack", permanent: false },
        {
          source: "/appearance",
          destination: "/settings/appearance",
          permanent: false,
        },
      ]),
    );
    expect(COMPATIBILITY_REDIRECTS).toHaveLength(2);
  });

  it("resolves settings aliases before React runs", () => {
    // The [section] page can resolve these too, but it renders inside the
    // authenticated client shell, so its redirect reaches the browser as an
    // RSC instruction and the not-found body flashes first.
    const redirects = getCompatibilityRedirects();

    expect(redirects).toEqual(
      expect.arrayContaining([
        {
          source: "/settings/usage",
          destination: "/settings/billing",
          permanent: false,
        },
        {
          source: "/settings/personalization",
          destination: "/settings/general",
          permanent: false,
        },
        {
          source: "/settings/extensions",
          destination: "/plugins",
          permanent: false,
        },
      ]),
    );
    // Dialog tab names ("data controls") arrive through a caller, never an
    // address bar, so they stay out of the routing table.
    expect(redirects.every((redirect) => !redirect.source.includes(" "))).toBe(
      true,
    );
  });

  it("returns a copy so Next cannot mutate the shared route contract", () => {
    const redirects = getCompatibilityRedirects();

    expect(redirects).not.toBe(COMPATIBILITY_REDIRECTS);
    expect(redirects[0]).not.toBe(COMPATIBILITY_REDIRECTS[0]);
  });
});
