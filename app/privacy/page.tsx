import Link from "next/link";
import { createPageMetadata } from "@/shared/config";
import { LegalPage, LegalSection } from "@/shared/ui/legal-page";

export const metadata = createPageMetadata({
  title: "Privacy Notice",
  description: "How LIBERO EDA handles technical access data and local display preferences.",
  path: "/privacy/",
});

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Notice"
      description="LIBERO EDA is a read-only research data explorer. This notice describes the limited technical data involved when you use the public site."
    >
      <LegalSection title="Information you provide">
        <p>
          LIBERO EDA has no accounts, uploads, comments, contact forms, advertising, or first-party
          analytics. You do not provide personal information to use the site.
        </p>
      </LegalSection>

      <LegalSection title="Technical access data">
        <p>
          The hosting provider processes ordinary request information needed to deliver and secure
          the site, such as IP address, request time, requested path, browser information, and
          diagnostic events. The operator may use the operational logs made available by the
          provider only for security, reliability, and troubleshooting.
        </p>
      </LegalSection>

      <LegalSection title="Local display preferences">
        <p>
          When you change a replay video orientation, the site stores the preference under
          <code className="mono rounded-sm bg-base-200 px-1.5 py-0.5 text-xs">
            libero-eda.video-orientation.v1
          </code>{" "}
          in your browser&apos;s local storage. This feature does not transmit the preference to the
          operator. You can remove it by resetting the orientation or clearing this site&apos;s
          stored data.
        </p>
      </LegalSection>

      <LegalSection title="External data sources">
        <p>
          Your browser retrieves pinned datasets and benchmark definitions from Hugging Face and
          GitHub. Those services receive ordinary network request information under their own
          privacy terms. The exact sources used by the application are listed on the{" "}
          <Link href="/sources/" className="font-medium text-primary hover:underline">
            Sources page
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="Sharing and retention">
        <p>
          The operator does not sell personal information, use it for targeted advertising, or build
          visitor profiles. Technical logs are retained according to the hosting provider&apos;s
          operational policies. Local display preferences remain on your device until you remove
          them.
        </p>
      </LegalSection>

      <LegalSection title="Contact and changes">
        <p>
          For privacy questions, use the contact options on the{" "}
          <a
            href="https://github.com/ekunish"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary hover:underline"
          >
            ekunish GitHub profile
          </a>
          . Report security issues through the repository&apos;s private security advisory workflow
          and do not include sensitive information in a public issue. Material changes to this
          notice will be published on this page with a revised effective date.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
