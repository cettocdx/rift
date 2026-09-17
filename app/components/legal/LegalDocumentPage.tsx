import Link from "next/link";
import type { ReactNode } from "react";

import {
  MarketingBody,
  MarketingPage,
} from "@/app/components/marketing/MarketingPage";
import { X_LABEL } from "@/app/components/landing-x/x-system";

/**
 * The three legal documents, in the brand's language.
 *
 * Previously these ran on a palette of their own: a light grey page, a blue
 * link colour and a header that shared nothing with the product. A reader who
 * clicked "Privacy" from the footer arrived somewhere else. This renders the
 * same documents inside the marketing shell, so the navigation, the plate, the
 * type and the footer are the ones they just left.
 *
 * The document text is untouched. Restyling a legal page is a design change;
 * editing its wording is not, and is not ours to make quietly. That is also why
 * any dash or phrasing inside a section body stays exactly as written.
 *
 * ── The palette moved once more ──
 *
 * Every colour here used to be named against the old shell — `--primary` for a
 * link, `--cursor-text-secondary` for running copy, `--surface` for the closing
 * card. When MarketingPage moved onto the landing's system those names stopped
 * being defined by the page, so the classes were resolving against whatever
 * globals happened to supply, on a ground they were never chosen for. They are
 * x-system tokens now, which is the same set the shell above them declares.
 *
 * Links lost their accent colour with the move and did not gain a new one: on
 * a page that is nothing but running text, a coloured link every other line is
 * the loudest thing on the screen. They carry weight and a hairline underline
 * that darkens on hover, which is what the landing does everywhere else.
 */

export type LegalDocumentSection = {
  id: string;
  title: string;
  content: ReactNode;
};

type LegalDocumentPageProps = {
  activePath: "/terms-of-service" | "/privacy-policy" | "/refund-policy";
  title: string;
  description: string;
  lastUpdated: string;
  lastUpdatedIso: string;
  intro?: ReactNode;
  sections: LegalDocumentSection[];
  closing: ReactNode;
};

const LEGAL_DOCUMENTS = [
  { href: "/terms-of-service", label: "Terms" },
  { href: "/privacy-policy", label: "Privacy" },
  { href: "/refund-policy", label: "Refunds" },
] as const;

function DocumentIndex({ sections }: { sections: LegalDocumentSection[] }) {
  return (
    <nav aria-label="On this page">
      <ol className="space-y-px">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="block rounded-[8px] px-2 py-1.5 text-[13px] font-normal leading-[19px] tracking-[-0.01em] text-[var(--x-ink-45)] transition-colors duration-(--duration-hover) hover:bg-[var(--x-raise)] hover:text-[var(--x-ink)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--x-ink)] motion-reduce:transition-none"
            >
              {section.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LegalDocumentPage({
  activePath,
  title,
  description,
  lastUpdated,
  lastUpdatedIso,
  intro,
  sections,
  closing,
}: LegalDocumentPageProps) {
  return (
    <MarketingPage
      title={title}
      lede={description}
      meta={
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span>
            Last updated{" "}
            <time dateTime={lastUpdatedIso} className="text-[var(--x-ink)]">
              {lastUpdated}
            </time>
          </span>
          <span>
            Company <span className="text-[var(--x-ink)]">RIFT LLC</span>
          </span>
          {/* The other two documents, one press away. A reader checking refunds
              usually wants to check terms in the same sitting. */}
          <nav
            aria-label="Legal documents"
            className="flex items-center gap-0.5 rounded-full border-[0.5px] border-[var(--x-line-soft)] p-0.5"
          >
            {LEGAL_DOCUMENTS.map((document) => {
              const isActive = activePath === document.href;
              return (
                <Link
                  key={document.href}
                  href={document.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-full px-3 py-1 text-[12.5px] font-medium tracking-[-0.01em] transition-colors duration-(--duration-hover) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--x-ink)] motion-reduce:transition-none ${
                    isActive
                      ? "bg-[var(--x-ink)] text-[var(--x-ground)]"
                      : "text-[var(--x-ink-45)] hover:text-[var(--x-ink)]"
                  }`}
                >
                  {document.label}
                </Link>
              );
            })}
          </nav>
        </div>
      }
    >
      <MarketingBody>
        <details className="mb-8 rounded-[12px] border-[0.5px] border-[var(--x-line-soft)] px-3 py-1 lg:hidden">
          <summary className="cursor-pointer py-2.5 text-[13px] font-medium tracking-[-0.01em] text-[var(--x-ink)] focus-visible:outline-none">
            On this page
          </summary>
          <div className="pb-2">
            <DocumentIndex sections={sections} />
          </div>
        </details>

        <div className="grid min-w-0 gap-12 lg:grid-cols-[220px_minmax(0,720px)] lg:gap-16">
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <p className={`${X_LABEL} mb-3 px-2`}>On this page</p>
              <DocumentIndex sections={sections} />
            </div>
          </aside>

          <article className="min-w-0 text-[15px] leading-[1.75] text-[var(--x-ink-45)]">
            {intro ? (
              <div className="mb-10 text-[16px] leading-[1.7] text-[var(--x-ink-80)]">
                {intro}
              </div>
            ) : null}

            <div className="space-y-11">
              {sections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  aria-labelledby={`${section.id}-title`}
                  className="scroll-mt-28 border-t-[0.5px] border-t-[var(--x-line)] pt-7"
                >
                  <h2
                    id={`${section.id}-title`}
                    className="mb-3.5 text-[18px] font-medium leading-7 tracking-[-0.025em] text-[var(--x-ink)] sm:text-[20px]"
                  >
                    {section.title}
                  </h2>
                  <div className="space-y-4 [&_a]:font-medium [&_a]:text-[var(--x-ink)] [&_a]:underline [&_a]:decoration-[var(--x-line-soft)] [&_a]:underline-offset-4 [&_a]:transition-colors [&_a]:hover:decoration-[var(--x-ink)] [&_a]:focus-visible:rounded-[4px] [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-offset-2 [&_a]:focus-visible:outline-[var(--x-ink)] [&_strong]:font-medium [&_strong]:text-[var(--x-ink)]">
                    {section.content}
                  </div>
                </section>
              ))}
            </div>

            <div className="mt-12 rounded-[14px] bg-[var(--x-raise)] p-6 text-[14px] leading-[1.7] text-[var(--x-ink-45)] sm:p-7 sm:text-[15px]">
              {closing}
            </div>
          </article>
        </div>
      </MarketingBody>
    </MarketingPage>
  );
}
