# RIFT landing — design and verification

## Direction

PrimeSec informed the graphite/acid-yellow contrast, monumental type and physical hero object. RIFT's own approved symbol supplies the sculpture geometry. The result uses a custom Three.js metal object rather than a copied stock statue. Emil Kowalski's motion guidance informed damped pointer movement, brief control feedback and restrained entrance motion.

The main conversion path is Get RIFT → `/download`. Product discovery uses real Build, Studio and Hack screens, followed by workflow, model choice, FAQ and a final download invitation.

## Screen provenance

All three PNGs under `public/landing-prime/` were captured from the running RIFT UI Preview desktop application through native computer control on 2026-09-15. Sidebars were collapsed before capture to keep private account/history information out of the page.

- `desktop-build.png`: the actual Build start screen.
- `desktop-studio.png`: an actual Studio result displaying a ceramic sphere.
- `desktop-hack.png`: an existing hypothetical configuration review. The landing caption identifies it as a review, not a live security incident.

No generated product UI, invented customer logos, testimonials or numerical performance claims were added.

## Observed browser checks

- Desktop hero visually inspected after material refinement; chrome highlights and yellow seams remain legible on graphite.
- 390px mobile layout inspected. Headline changed to three block lines to remove overflow.
- Mobile menu opened and closed with Escape, returning focus to the menu control.
- Product tabs switched with keyboard arrows and displayed their corresponding panel.
- FAQ disclosure opened and displayed its answer.
- Desktop DOM check: viewport width 1152, document width 1152; every image in the main content loaded; one WebGL canvas present.
- Model marks corrected for contrast on the dark background.

Reduced-motion handling, offscreen/document-hidden rendering suspension, WebGL fallback, cleanup, bounded pixel ratio and a manual animation pause are implemented. These are code-reviewed safeguards; they are not a claim of a complete accessibility or device-lab audit.

## Design critique

The custom branded sculpture and real product screens give the page a specific identity. The generous typography and consistent accent establish hierarchy without fake dashboard decorations. The motion is secondary to reading and navigation.

Awwwards' design/usability/creativity/content categories were used as a critique framework, not as an award prediction. The page still needs real visitor feedback and measured conversion data to validate its marketing effectiveness. There is no claimed jury score, Lighthouse score or universal device certification.

## Release verification

- ESLint for the new landing components and routes: passed with zero warnings.
- Production build: passed, including TypeScript and static page generation.
- Published local preview: `http://localhost:3020/landing`, release `.next-ui-release-1789477480053-815ec36b`.
- Live HTTP checks: `/landing`, `/landing/prime`, `/download` and the Studio screenshot all returned 200.
- Temporary development server on 3021 was stopped; its generated TypeScript includes were removed.
