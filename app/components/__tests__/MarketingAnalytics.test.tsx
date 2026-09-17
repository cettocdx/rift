import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MarketingAnalytics } from "../MarketingAnalytics";

jest.mock("next/navigation", () => ({ usePathname: jest.fn() }));
// Observe which scripts the component emits without Next's lazy-load scheduler
// or a browser request to the advertising provider.
jest.mock("next/script", () => ({
  __esModule: true,
  default: ({
    src,
    id,
    children,
  }: {
    src?: string;
    id?: string;
    children?: ReactNode;
  }) => (
    // eslint-disable-next-line @next/next/no-sync-scripts -- inert jsdom boundary, not a production script loader
    <script src={src} id={id}>
      {children}
    </script>
  ),
}));

const originalSetting = process.env.NEXT_PUBLIC_MARKETING_ANALYTICS_ENABLED;
const mockPathname = jest.mocked(usePathname);

afterEach(() => {
  cleanup();
  if (originalSetting === undefined) {
    delete process.env.NEXT_PUBLIC_MARKETING_ANALYTICS_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_MARKETING_ANALYTICS_ENABLED = originalSetting;
  }
});

it.each(["/login", "/signup", "/invite/token", "/pricing"])(
  "emits no scripts on %s when explicitly disabled for a canary build",
  (pathname) => {
    process.env.NEXT_PUBLIC_MARKETING_ANALYTICS_ENABLED = "false";
    mockPathname.mockReturnValue(pathname);
    const { container } = render(<MarketingAnalytics />);
    expect(container).toBeEmptyDOMElement();
  },
);

it.each([undefined, "true"])(
  "preserves marketing scripts when the setting is %s",
  (setting) => {
    if (setting === undefined)
      delete process.env.NEXT_PUBLIC_MARKETING_ANALYTICS_ENABLED;
    else process.env.NEXT_PUBLIC_MARKETING_ANALYTICS_ENABLED = setting;
    mockPathname.mockReturnValue("/login");
    const { container } = render(<MarketingAnalytics />);
    expect(container.querySelectorAll("script")).toHaveLength(2);
    expect(container.querySelector("script[src]")).toHaveAttribute(
      "src",
      "https://www.googletagmanager.com/gtag/js?id=AW-18267889487",
    );
    expect(container.querySelector("#google-ads-gtag")).toHaveTextContent(
      "gtag('config', 'AW-18267889487')",
    );
  },
);

it.each([
  "/landing",
  "/pricing",
  "/upgrade",
  "/signup",
  "/login",
  "/invite",
  "/invite/token",
])(
  "preserves tracking on the existing marketing route %s by default",
  (pathname) => {
    delete process.env.NEXT_PUBLIC_MARKETING_ANALYTICS_ENABLED;
    mockPathname.mockReturnValue(pathname);
    const { container } = render(<MarketingAnalytics />);
    expect(container.querySelectorAll("script")).toHaveLength(2);
  },
);

it.each(["/", "/c/chat-id", "/tasks", "/runs", "/login-extra", "/invited"])(
  "does not track product routes or lookalike prefixes: %s",
  (pathname) => {
    process.env.NEXT_PUBLIC_MARKETING_ANALYTICS_ENABLED = "true";
    mockPathname.mockReturnValue(pathname);
    const { container } = render(<MarketingAnalytics />);
    expect(container).toBeEmptyDOMElement();
  },
);
