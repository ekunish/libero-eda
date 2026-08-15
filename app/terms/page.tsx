import Link from "next/link";
import { createPageMetadata } from "@/shared/config";
import { LegalPage, LegalSection } from "@/shared/ui/legal-page";

export const metadata = createPageMetadata({
  title: "Terms of Use",
  description: "Terms for using the public LIBERO EDA research data explorer.",
  path: "/terms/",
});

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      description="These terms apply to the public LIBERO EDA website. By using the site, you agree to use it lawfully and with appropriate care for its research context."
    >
      <LegalSection title="Purpose">
        <p>
          LIBERO EDA is provided for research, education, and informational exploration of robot
          demonstration data and benchmark conditions. It is not a production robotics control
          system or a substitute for independent validation.
        </p>
      </LegalSection>

      <LegalSection title="Project status and third-party materials">
        <p>
          This project is not affiliated with or endorsed by the authors of LIBERO or LIBERO-Plus.
          The LIBERO EDA source code is available under the Apache License 2.0. Datasets, benchmark
          definitions, simulator assets, and other third-party materials remain subject to their
          respective upstream terms and licenses.
        </p>
        <p>
          See the{" "}
          <Link href="/sources/" className="font-medium text-primary hover:underline">
            Sources page
          </Link>{" "}
          and the repository&apos;s third-party notices before redistributing or reusing data.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>
          You may use the site for lawful research, education, and analysis. You must not interfere
          with the site, bypass access or security controls, misrepresent the project or its data,
          introduce malicious code, or use automated access in a way that degrades the service or
          upstream data providers.
        </p>
      </LegalSection>

      <LegalSection title="No warranties">
        <p>
          The site and its content are provided on an “as is” and “as available” basis. To the
          maximum extent permitted by law, no warranty is made regarding accuracy, completeness,
          fitness for a particular purpose, uninterrupted availability, or reproducibility of any
          research result. Always verify claims against the cited primary sources.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          To the maximum extent permitted by applicable law, the operator is not liable for
          indirect, incidental, special, consequential, or research-related losses arising from use
          of, or inability to use, the site or third-party materials. Nothing in these terms
          excludes liability that cannot legally be excluded.
        </p>
      </LegalSection>

      <LegalSection title="Availability, changes, and governing law">
        <p>
          The site, content, and these terms may be changed, suspended, or discontinued without
          guarantee of prior notice. Material changes to these terms will be published here with a
          revised effective date. These terms are governed by the laws of Japan, without regard to
          conflict-of-law principles.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
