import type { Metadata } from "next";
import {
  LegalDocumentPage,
  type LegalDocumentSection,
} from "@/app/components/legal/LegalDocumentPage";

export const metadata: Metadata = {
  title: "Privacy Policy | RIFT",
  description: "Privacy Policy and data handling practices for RIFT services.",
  openGraph: {
    title: "Privacy Policy | RIFT",
    description:
      "Privacy Policy and data handling practices for RIFT services.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Privacy Policy | RIFT",
    description:
      "Privacy Policy and data handling practices for RIFT services.",
  },
};

export const dynamic = "force-static";

const sections: LegalDocumentSection[] = [
  {
    id: "service-scope",
    title: "Service Scope",
    content: (
      <p>
        The Service includes AI-assisted software development, media generation,
        workspace tools, and authorized security testing features. Available
        features may change as the Service evolves.
      </p>
    ),
  },
  {
    id: "information-we-collect",
    title: "Information We Collect",
    content: (
      <p>
        We may collect and store any information you provide to us or that we
        collect in connection with your use of the Service. This may include,
        but is not limited to, personal information such as your email address
        and any data or content you create, upload, or share through the
        Service, including project files, prompts, generated outputs, build
        logs, media inputs, and authorized security testing results.
      </p>
    ),
  },
  {
    id: "how-we-use-information",
    title: "How We Use Your Information",
    content: (
      <p>
        The information we collect is used to provide, maintain, protect, and
        improve the Service; to develop new services; and to protect us and our
        users. We also use this information to offer tailored content and
        improve our AI-assisted software, media, workspace, and authorized
        security testing capabilities.
      </p>
    ),
  },
  {
    id: "sharing-and-disclosure",
    title: "Information Sharing and Disclosure",
    content: (
      <>
        <p>
          We do not share personal information with companies, organizations, or
          individuals outside of RIFT LLC except in the following circumstances:
        </p>
        <ul className="ml-5 list-disc space-y-2 marker:text-[#8d949d] dark:marker:text-[#777d85]">
          <li>With your consent.</li>
          <li>
            {[
              "For legal reasons, we will share personal information if we ",
              "have a good-faith belief that access, use, preservation, or ",
              "disclosure of the information is reasonably necessary to meet ",
              "any applicable law, regulation, legal process, or enforceable ",
              "governmental request.",
            ].join("")}
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    content: (
      <p>
        We strive to use commercially acceptable means to protect your
        information, but we cannot guarantee its absolute security. Your use of
        the Service signifies your agreement that the risk of any data breaches
        or security vulnerabilities is borne solely by you.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to This Privacy Policy",
    content: (
      <p>
        We may modify this Privacy Policy at any time. We will notify you of any
        changes by posting the new Privacy Policy on this page. You are advised
        to review this Privacy Policy periodically for any changes.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact Us",
    content: (
      <p>
        If you have any questions about this Privacy Policy, please visit our
        help center at{" "}
        <a
          href="https://help.rift.co/en/"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://help.rift.co/en/
        </a>
      </p>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalDocumentPage
      activePath="/privacy-policy"
      title="Privacy Policy"
      description="Privacy Policy and data handling practices for RIFT services."
      lastUpdated="July 20, 2026"
      lastUpdatedIso="2026-07-20"
      sections={sections}
      intro={
        <p>
          Welcome to RIFT. This Privacy Policy explains how RIFT LLC
          (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) collects, uses,
          shares, and protects information in relation to our website and any
          associated services, software, and content (collectively, the
          &quot;Service&quot;). By accessing or using our Service, you
          (&quot;you&quot; or &quot;User&quot;) understand and agree to the
          collection and use of information in accordance with this policy.
        </p>
      }
      closing={
        <p>
          By accessing or using our Service, you acknowledge that you have read,
          understood, and agreed to be bound by this Privacy Policy.
        </p>
      }
    />
  );
}
