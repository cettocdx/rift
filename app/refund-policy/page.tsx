import type { Metadata } from "next";
import {
  LegalDocumentPage,
  type LegalDocumentSection,
} from "@/app/components/legal/LegalDocumentPage";

export const metadata: Metadata = {
  title: "Refund Policy | RIFT",
  description: "Refund Policy for RIFT credit purchases.",
  openGraph: {
    title: "Refund Policy | RIFT",
    description: "Refund Policy for RIFT credit purchases.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Refund Policy | RIFT",
    description: "Refund Policy for RIFT credit purchases.",
  },
};

export const dynamic = "force-static";

const sections: LegalDocumentSection[] = [
  {
    id: "free-tier",
    title: "Free tier",
    content: (
      <p>
        The free allowance (daily Ask messages and the one free Agent run) is
        provided at no cost, so there is nothing to refund.
      </p>
    ),
  },
  {
    id: "unused-credits",
    title: "Unused credits",
    content: (
      <p>
        If you have not consumed any credits from a purchase, you may request a
        full refund of that purchase within <strong>14 days</strong> of the
        transaction.
      </p>
    ),
  },
  {
    id: "consumed-credits",
    title: "Consumed credits",
    content: (
      <p>
        Credits that have already been spent on Ask or Agent requests are
        non-refundable, as the underlying compute and model costs have already
        been incurred. Partially used purchases may be refunded on a pro-rata
        basis for the unused remainder, at the Company&apos;s discretion.
      </p>
    ),
  },
  {
    id: "crypto-payments",
    title: "Crypto payments",
    content: (
      <p>
        Cryptocurrency transactions are irreversible. Where a refund is approved
        for a crypto purchase, it will be credited back to your in-app credit
        balance rather than returned on-chain.
      </p>
    ),
  },
  {
    id: "failed-runs",
    title: "Failed runs",
    content: (
      <p>
        If a request fails on our side and no usable output is produced, the
        credits (or free run) consumed by that request are automatically
        restored to your account; no action is required.
      </p>
    ),
  },
  {
    id: "requesting-a-refund",
    title: "How to request a refund",
    content: (
      <p>
        Contact RIFT Support through our{" "}
        <a
          href="https://help.rift.co/en/"
          target="_blank"
          rel="noopener noreferrer"
        >
          help center
        </a>{" "}
        from the address on your account with your order details. We aim to
        respond within 5 business days. Approved refunds are returned to the
        original payment method where possible.
      </p>
    ),
  },
  {
    id: "abuse-and-chargebacks",
    title: "Abuse & chargebacks",
    content: (
      <p>
        We reserve the right to decline refunds for accounts that violate our
        Terms of Service, and to suspend accounts associated with fraudulent
        payments or chargebacks.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    content: (
      <p>
        RIFT LLC may update this Refund Policy at any time. Continued use of the
        Products after changes constitutes acceptance of the updated policy.
      </p>
    ),
  },
];

export default function RefundPolicyPage() {
  return (
    <LegalDocumentPage
      activePath="/refund-policy"
      title="Refund Policy"
      description="Refund Policy for RIFT credit purchases."
      lastUpdated="July 20, 2026"
      lastUpdatedIso="2026-07-20"
      sections={sections}
      intro={
        <p>
          RIFT LLC (&quot;the Company&quot;) sells prepaid usage credits on a
          pay-as-you-go basis. This policy explains when credit purchases can be
          refunded.
        </p>
      }
      closing={
        <p>
          This policy applies in addition to your statutory rights, which it
          does not limit where they apply.
        </p>
      }
    />
  );
}
