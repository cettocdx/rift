import type { Metadata } from "next";
import {
  LegalDocumentPage,
  type LegalDocumentSection,
} from "@/app/components/legal/LegalDocumentPage";

export const metadata: Metadata = {
  title: "Terms of Service | RIFT",
  description: "Terms of Service and conditions for RIFT services.",
  openGraph: {
    title: "Terms of Service | RIFT",
    description: "Terms of Service and conditions for RIFT services.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Terms of Service | RIFT",
    description: "Terms of Service and conditions for RIFT services.",
  },
};

export const dynamic = "force-static";

const sections: LegalDocumentSection[] = [
  {
    id: "lawful-use",
    title: "Lawful Use",
    content: (
      <p>
        Users of products, services, or software (&quot;Products&quot;) provided
        by RIFT LLC (&quot;the Company&quot;) agree to use the Products only for
        lawful purposes and in accordance with all applicable laws, regulations,
        and guidelines.
      </p>
    ),
  },
  {
    id: "limitation-of-liability",
    title: "Limitation of Liability",
    content: (
      <p>
        Neither RIFT LLC, nor its parent companies, affiliates, directors,
        officers, employees, agents, partners, or licensors shall be held
        responsible or liable, directly or indirectly, for any damages, losses,
        or consequences, whether incidental, consequential, direct, indirect,
        special, punitive, or otherwise, arising out of or in connection with
        any use or misuse of the Products, whether such use is lawful or
        unlawful.
      </p>
    ),
  },
  {
    id: "user-content",
    title: "No Endorsement of User Content",
    content: (
      <p>
        The Company does not endorse, support, represent, or guarantee the
        completeness, accuracy, reliability, or suitability of any content or
        communications made available through its Products, nor does it endorse
        any opinions expressed by users of its Products.
      </p>
    ),
  },
  {
    id: "responsibility-and-indemnity",
    title: "User Responsibility and Indemnity",
    content: (
      <p>
        The user assumes full responsibility for any risks associated with their
        use of the Products. The user agrees to indemnify and hold harmless RIFT
        LLC, its parent companies, and their respective officers, directors,
        employees, and agents from and against any claims, actions, or demands,
        including without limitation reasonable legal and accounting fees,
        arising or resulting from their use of the Products or their breach of
        these Terms of Service. This indemnity includes any liability or expense
        arising from claims, losses, damages, judgments, fines, litigation
        costs, and legal fees.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to Terms of Service",
    content: (
      <p>
        RIFT LLC reserves the right to update or modify these Terms of Service
        at any time without prior notice. Your use of the Products after any
        such changes constitutes your acceptance of the new terms. It is your
        responsibility to review the Terms of Service periodically for changes.
      </p>
    ),
  },
  {
    id: "severability",
    title: "Severability",
    content: (
      <p>
        If any provision of these Terms of Service is found by a court of
        competent jurisdiction to be invalid, the parties nevertheless agree
        that the court should endeavor to give effect to the parties&apos;
        intentions as reflected in the provision, and the other provisions of
        the Terms of Service remain in full force and effect.
      </p>
    ),
  },
];

export default function TermsOfServicePage() {
  return (
    <LegalDocumentPage
      activePath="/terms-of-service"
      title="Terms of Service"
      description="Terms of Service and conditions for RIFT services."
      lastUpdated="July 20, 2026"
      lastUpdatedIso="2026-07-20"
      sections={sections}
      closing={
        <p>
          By using the Products provided by RIFT LLC, you indicate your
          understanding and agreement to abide by the terms and conditions set
          forth in these Terms of Service. If you do not agree with these terms,
          please refrain from using the Products.
        </p>
      }
    />
  );
}
