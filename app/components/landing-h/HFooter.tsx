import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { RiftLogo } from "@/components/icons/rift-logo";

import { H_CONTAINER, H_LABEL } from "./h-system";

const COLS: { title: string; links: [string, string][] }[] = [
  {
    title: "Product",
    links: [
      ["Build", "#build"],
      ["Studio", "#studio"],
      ["Hack Workbench", "#workbench"],
      ["Specs", "#specs"],
    ],
  },
  {
    title: "Start",
    links: [
      ["Create an account", "/signup"],
      ["Log in", "/login"],
      ["Download", "/download"],
      ["Pricing", "#pricing"],
    ],
  },
  {
    title: "Legal",
    links: [
      ["Terms of service", "/terms-of-service"],
      ["Privacy policy", "/privacy-policy"],
      ["Refund policy", "/refund-policy"],
    ],
  },
];

/**
 * The footer, in Hermeus's industrial register: an address line, uppercase
 * column heads, hairline rules, a media-inquiry contact.
 */
export function HFooter() {
  return (
    <footer className="border-t border-[var(--h-line)] bg-[var(--h-panel)]">
      <div className={`${H_CONTAINER} py-16`}>
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <RiftLogo size={20} className="text-[var(--h-ink)]" />
              <RiftWordmark
                decorative
                height={21}
                className="text-[14px] font-semibold uppercase tracking-[0.18em] text-[var(--h-ink)]"
              />
            </div>
            <p className="mt-5 max-w-[34ch] text-[13px] leading-[1.6] text-[var(--h-ink-70)]">
              The agent workstation. Plan, write, execute and verify from one
              surface, on a real machine.
            </p>
          </div>
          {COLS.map((col) => (
            <div key={col.title}>
              <p className={H_LABEL}>{col.title}</p>
              <ul className="mt-5 flex flex-col gap-3">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <a
                      href={href}
                      className="text-[13px] text-[var(--h-ink-70)] transition-colors hover:text-[var(--h-ink)]"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col justify-between gap-4 border-t border-[var(--h-line)] pt-8 text-[12px] uppercase tracking-[0.1em] text-[var(--h-ink-45)] sm:flex-row">
          <span>&copy; 2026 RIFT</span>
          <a
            href="mailto:hello@riftsys.app"
            className="transition-colors hover:text-[var(--h-ink)]"
          >
            hello@riftsys.app
          </a>
        </div>
      </div>
    </footer>
  );
}
