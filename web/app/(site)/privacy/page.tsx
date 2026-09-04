import type { Metadata } from "next";
import { DocShell } from "@/components/site/DocShell";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "Pando's privacy policy: what we collect, how we use it, SMS consent, and your choices.",
};

const SECTIONS = [
  { id: "collect", label: "Information we collect" },
  { id: "use", label: "How we use it" },
  { id: "sms", label: "SMS consent" },
  { id: "share", label: "What we share" },
  { id: "retention", label: "Retention and deletion" },
  { id: "choices", label: "Your choices" },
  { id: "children", label: "Children" },
  { id: "changes", label: "Changes" },
  { id: "contact", label: "Contact" },
];

/**
 * Ported verbatim from privacy.html. Body copy is styled by the `.legal` block in
 * globals.css rather than per-element utilities, so this stays close to plain
 * HTML — a legal document that a non-engineer can safely edit.
 */
export default function PrivacyPage() {
  return (
    <DocShell
      title="Privacy policy"
      effective="Effective July 1, 2026 · Pando Systems, Inc · Pasadena, California"
      sections={SECTIONS}
    >
      <p>
        Pando helps parents get trusted local answers by text. This policy explains
        what information we collect, how we use it, and the choices you have. If
        anything here is unclear, email us at{" "}
        <a href="mailto:hello@pando.is">hello@pando.is</a> and a person will answer.
      </p>

      <h2 id="collect">Information we collect</h2>
      <ul>
        <li>
          <strong>Contact and profile information</strong> you provide: your name,
          phone number, neighborhood, children’s ages, and the preferences you
          select during signup (such as schedule, budget posture, and community
          groups).
        </li>
        <li>
          <strong>Messages</strong> you exchange with Pando, including questions you
          ask and recommendations you share.
        </li>
        <li>
          <strong>Recommendations and nominations</strong> you contribute, including
          caveats and whether you’re willing to serve as a reference.
        </li>
        <li>
          <strong>Payment information</strong> if you purchase a paid service,
          processed by our payment provider (Stripe). Pando does not store card
          numbers.
        </li>
      </ul>

      <h2 id="use">How we use it</h2>
      <ul>
        <li>
          To answer your questions and route them to parents whose experience is
          relevant.
        </li>
        <li>
          To attribute recommendations honestly — showing whether an answer came
          from one parent, multiple parents, or public information, and when it was
          last confirmed.
        </li>
        <li>
          To operate contributor features such as thanks messages and frequency
          limits.
        </li>
        <li>To keep the service safe, prevent abuse, and comply with law.</li>
      </ul>

      <h2 id="sms">SMS consent and mobile information</h2>
      <div className="my-3.5 rounded-xl border border-gold-line bg-gold-wash px-5 py-4">
        <p className="mb-0!">
          <strong>
            No mobile information will be shared with third parties or affiliates
            for marketing or promotional purposes.
          </strong>{" "}
          Text messaging originator opt-in data and consent are not shared with, or
          sold to, any third party.
        </p>
      </div>
      <p>
        We use service providers (such as our messaging platform) solely to deliver
        the messages you’ve opted into. You can revoke SMS consent at any time by
        replying STOP.
      </p>

      <h2 id="share">What we share</h2>
      <ul>
        <li>
          <strong>With other parents:</strong> when you contribute a recommendation,
          we may share it with other Pando users along with limited attribution (for
          example, “a local parent” or your first name if you agree to be a
          reference). We never share your phone number with other users without your
          explicit consent.
        </li>
        <li>
          <strong>Caregiver information:</strong> a caregiver is only ever mentioned
          in an answer if they have separately consented to be listed on Pando.
        </li>
        <li>
          <strong>Service providers:</strong> vendors that help us run Pando
          (messaging, hosting, payments, and AI language processing), bound to use
          information only to provide their service to us. Our AI providers process
          messages to generate responses and are contractually prohibited from using
          your information to train their models.
        </li>
        <li>
          <strong>Legal:</strong> if required by law or to protect the safety of our
          users.
        </li>
      </ul>
      <p>
        We do not sell your personal information, and we do not share it for
        cross-context behavioral advertising.
      </p>

      <h2 id="retention">Retention and deletion</h2>
      <p>
        We keep your information while your account is active and as needed to
        operate the service. You can request deletion of your data at any time by
        texting DELETE to Pando or emailing{" "}
        <a href="mailto:hello@pando.is">hello@pando.is</a>; we’ll confirm once
        complete, subject to records we’re legally required to keep.
      </p>

      <h2 id="choices">Your choices</h2>
      <ul>
        <li>
          Reply <strong>STOP</strong> to stop all text messages.
        </li>
        <li>
          Text <strong>BLAST SETTINGS</strong> to change how often you’re asked for
          recommendations.
        </li>
        <li>
          Email us to access, correct, or delete your information. California
          residents may exercise rights under the CCPA/CPRA by contacting us at the
          address below.
        </li>
      </ul>

      <h2 id="children">Children</h2>
      <p>
        Pando is a service for parents and guardians aged 18 and over. It is not
        directed to children, and we do not knowingly collect personal information
        from anyone under 18. Information parents share about their children is
        limited to what’s needed for relevant recommendations (such as age ranges).
      </p>

      <h2 id="changes">Changes</h2>
      <p>
        If we make material changes to this policy, we’ll update this page and note
        the new effective date. Significant changes affecting SMS consent will be
        communicated before they take effect.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        Pando Systems, Inc · Pasadena, California ·{" "}
        <a href="mailto:hello@pando.is">hello@pando.is</a>
      </p>
    </DocShell>
  );
}
