# Action landing preview

Current implementation: `app/components/landing-action/ActionLanding.tsx` and its CSS module. Public preview `/landing`; original `/landing/action` retained. Signed-out root now imports ActionLanding, while authenticated root retains the Build workspace.

Changes in this pass: mobile navigation, explicit login, model-selection explanation matching the fixed Hack route, accessible FAQ disclosures, Home/End tab navigation, focusable tabpanel, readable source formatting, and page metadata. Fixed adjacent words when the desktop introduction line break is hidden on mobile.

Observed in the browser:

- 390×844 viewport: document scrollWidth 390, no horizontal overflow.
- Mobile navigation opens with Workspace, Workflows, Pricing and Log in.
- End on Build tab selects Hack.
- Model FAQ expands and its answer is visible.
- `/landing` renders at desktop width; temporary viewport reset.
- Authenticated `/` still opens the Build chat and existing history. Signed-out `/` mapping verified in source, not by signing the user's active account out.
- TypeScript check clean (`/tmp/rift-landing-types.log`); diff whitespace check clean.

Still required: full production build, signed-out end-to-end navigation in an isolated session, broader responsive/accessibility review, final visual polish and release. No award-quality or production-readiness claim is established by these checks. Walkthrough is explicitly illustrative, not presented as a real live agent run.

## Distinct product demonstrations

Reviewed https://composio.dev/ again for product-led interactive storytelling. Replaced the shared abstract orb with three distinct illustrative outcomes: a small project app, an existing campaign image, and a security finding with example configuration and remediation. Studio reuses the repository's studio-perfume.webp through next/image; no new generation or third-party download. The walkthrough remains explicitly illustrative.

Desktop rendering inspected in the in-app browser. Isolated installed Chrome headless checks at 390×844 measured document width 390 in all three modes; Studio image decode completed. Screenshots: /tmp/rift-landing-build-390.png, /tmp/rift-landing-studio-390.png, /tmp/rift-landing-hack-390.png. Studio mobile screenshot visually inspected. TypeScript and diff whitespace checks passed. Mobile menu now closes after choosing a link and on Escape, with keyboard focus returned to its summary.

Not a full release acceptance: complete page/a11y review, all viewport sizes, signed-out entry and production packaging still need verification.
