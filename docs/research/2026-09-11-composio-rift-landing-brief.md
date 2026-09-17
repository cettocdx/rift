# RIFT landing research and implementation brief

## Recommendation

Present RIFT as a workspace for completing technical and creative tasks, with Build, Hack and Studio demonstrated through distinct, readable fragments of the actual interface. Put one convincing product scene directly below the opening proposition. Follow it with three focused workflows, then explain model choice and plugins through controls people recognize from the product.

The central design decision is to reduce the distance between a claim and its evidence. A large collection of miniature windows can suggest breadth while leaving the visitor unable to read what happened. RIFT should instead show a task, a visible action and an inspectable result within each demonstration. The initial page should work as a complete static document; motion should clarify the transition between those states.

This recommendation combines current reference observations with the repository’s existing landing architecture. It does not establish conversion performance or production reliability. Public references were accessed September 11, 2026. Desktop observations used a 1280 × 720 viewport; the Composio mobile observation used 390 × 844. Exact animation durations were not established for the reference sites.

## Reference evidence

### Composio

The homepage uses a near-black visible ground, centered regular-weight headline, blue/green line fields, rectangular actions and monospace navigation. Desktop H1 computed at 64/64px, weight 400, Geist; feature H2 at 44/48.4px; the demonstration label uses JetBrains Mono at 14/20px. The demo places conversation centrally, with tool, connection and execution fragments around it. Four numbered controls navigate vertically through illustrated feature sections; clicking the second leaves the third visible below, rather than replacing one tab panel. [1](https://composio.dev/)

Observed state changes include the conversation progressing into Slack tool/sandbox results, an error/patch/success card sequence, and changing ecosystem examples. Neither exact easing nor the animation engine was verified. At 390px, the headline computes to 36/36px, navigation collapses, feature images stack above copy, and page width equals viewport width. The large desktop demonstration disappears from the mobile accessibility tree. These observations do not establish full accessibility conformance. [1](https://composio.dev/)

The separate For You page organizes examples around concrete tasks involving familiar apps, then groups use cases by role. Its promise is expressed through workflows rather than an API inventory. Its integration totals and customer assertions belong to Composio and supply no evidence for equivalent RIFT claims. [2](https://composio.dev/for-you)

### Cursor

The current desktop page uses an off-white ground, a left-aligned H1 measured at 26px and weight 400, restrained pill actions and a large layered product scene. The screenshot shows a primary desktop window with task list, conversation and output preview, plus a partially overlapping CLI window. The browser text explicitly describes its demonstration for sighted users. The task counts and completed state differed between initial page content and the later visual observation, providing evidence of changing demonstration state; precise choreography remains unmeasured. [3](https://cursor.com/)

The useful lesson is hierarchy: the application carries the visual argument and the headline introduces it economically. RIFT should borrow this allocation of space while retaining its own typography, assets and interaction vocabulary. Cursor’s artwork, customer logos, model names and commercial claims should not be transferred.

### Warp

Warp’s current page uses a light dotted/ruled grid, strong monospace hierarchy, figure captions and an architectural product illustration. A numbered feature list sits beside a shared preview. Clicking the second feature visibly changes that preview to configuration code and highlights the selected row. Its section navigation becomes a prominent blue strip lower on the page. The page also includes evaluation and cost examples, with explicit sample framing in one figure. [4](https://www.warp.dev/)

The useful lesson is controlled density: one active demonstration can explain several related capabilities without several simultaneous animated scenes. RIFT can use this pattern for models or plugin setup. It should avoid borrowing the infrastructure/factory positioning, which would obscure its broader creative workspace.

### Linear

Linear’s homepage uses a near-black ground, large left-aligned heading, fine separators and an oversized app preview beginning below the introduction. The preview retains issue text, activity and review context rather than showing empty chrome. Subsequent sections explain intake, planning, AI and code review with detailed UI fragments. The accessible tree exposes a skip link and names the main preview; later observations show agent progress content changing. [5](https://linear.app/)

The useful lesson is specificity: a recognizable issue and its resulting review are stronger than a generic dashboard. RIFT should give each scene a coherent example task whose result matches the preceding action. No conclusion is drawn about Linear’s complete keyboard support or reduced-motion implementation.

## Current RIFT source and limitations

The signed-out root page imports and renders `XLanding`. `/landing/x` is the corresponding dedicated route. The active composition is in [XLanding.tsx](/Users/cetto/RIFT-Release/app/components/landing-x/XLanding.tsx:69); the root import is in [page.tsx](</Users/cetto/RIFT-Release/app/(chat)/page.tsx:19>). Existing alternate routes and their specifications are historical options, not evidence that the root uses them.

The active composition already includes a Build stage, Studio stage, Hack workbench, model/vendor treatments, connector content, receipt/proof sections and pricing. Build and Studio use `RiftMiniApp`; Hack uses a separate workbench surface. The landing distinguishes limited live demonstrations from prepared output in its accompanying copy. This distinction should survive any visual revision.

`XStage` authors content at 1440px, calculates a scale from the container width and constrains the stage height. It disables interaction below its 640px threshold. That preserves desktop proportions but cannot make small text readable on a phone. A new crop strategy should solve information selection, rather than merely increasing the number of scaled windows. See [XStage.tsx](/Users/cetto/RIFT-Release/app/components/landing-x/XStage.tsx:76) and [XSurface.tsx](/Users/cetto/RIFT-Release/app/components/landing-x/XSurface.tsx:64).

The current tokens define a white page, neutral gray raised surfaces, black ink and a green status accent. Comments describing earlier colors do not override the current values. The rotating hero verb already has a reduced-motion branch and an accessible static text equivalent. These are useful foundations; they do not verify every downstream animation. See [x-system.ts](/Users/cetto/RIFT-Release/app/components/landing-x/x-system.ts:84) and [XHero.tsx](/Users/cetto/RIFT-Release/app/components/landing-x/XHero.tsx:58).

| Area    | Source-backed capability                                                            | Suitable landing treatment                              | Claim boundary                                                                             |
| ------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Build   | Existing chat/build model catalog and landing task surface                          | Task → changed file → check output                      | Do not promise every task succeeds or every result is verified                             |
| Hack    | Dedicated workbench and Max entitlement                                             | Declared scope → selected tool output → evidence detail | Max is stored internally as `ultra`; disclose Max, keep authorization context              |
| Studio  | `/studio` selects image purpose; image/video catalog and provider policies exist    | Prompt → selected renderer → output                     | Catalog membership alone does not prove provider availability or a successful generation   |
| Models  | `BUILD_MODELS` and `MEDIA_MODELS` are canonical lists                               | A readable selector containing actual catalog entries   | Avoid static counts, invented rankings or promises of identical model behavior             |
| Plugins | Protected PluginsWorkbench with Plugins/Skills tabs                                 | Search/list/detail crop, then setup state               | A listed plugin is not necessarily connected                                               |
| MCP     | Registry adapter supports filtered public remote endpoints and supported transports | Namespace/provider label, setup, then connection result | Avoid “any server,” “zero setup” or a registry total presented as guaranteed compatibility |

Capability sources: [types/chat.ts](/Users/cetto/RIFT-Release/types/chat.ts:397), [media policies](/Users/cetto/RIFT-Release/lib/ai/media-models.ts:177), [Studio route](</Users/cetto/RIFT-Release/app/(chat)/studio/page.tsx:21>), [premium access](/Users/cetto/RIFT-Release/lib/auth/premium-access.ts:36), [PluginsWorkbench](/Users/cetto/RIFT-Release/app/components/PluginsWorkbench.tsx:112), [registry normalization](/Users/cetto/RIFT-Release/lib/ai/mcp/registry/catalog.ts:46).

The September 11 clean-source verification supersedes the September 10 report’s uncommitted-source and clean-checkout packaging gap. It reports successful source checks while explicitly leaving live provider, worker, startup, session, isolation, recovery and Apple distribution gates outside that conclusion. Marketing should not turn source test success into a blanket reliability or distribution claim. See [clean-source verification](/Users/cetto/RIFT-Release/docs/release/2026-09-11-clean-source-verification.md).

## Proposed page structure

### Opening proposition and product scene

Use a short, stable headline: **“Build, investigate, create. In one workspace.”** Support it with concrete scope: **“Work with coding agents, run an authorized security workflow, and create images or video with the model you choose.”** This is proposed copy, subject to the capability boundaries above. An alternative preserving the existing brand phrase is **“Give it the work.”** followed immediately by the concrete explanation; avoid making completion guarantees in the headline.

The primary action should enter the existing product authentication flow. A secondary **“Explore the workspace”** action should navigate to the first demonstration. Verify the actual destination and return-path behavior rather than inventing a new entry URL. Keep pricing and download links secondary until availability is established by their existing routes.

Compose the hero preview from a principal Build conversation and result, with a restrained Studio output fragment offset beside it. Use one frame boundary. The first view should contain a readable task and recognizable output even before animation begins. Do not place critical information behind the lower viewport edge simply to create a dramatic reveal.

### Three workflows

Give Build the first and largest section because it anchors the technical product. Follow with Hack and Studio, allowing Studio to create a change in visual texture through real output assets. If source data shows a different acquisition priority later, reorder without changing the component contract. Keep all three names visible in navigation or an introductory row, so Studio visitors do not need to infer its existence from a code-led opening.

Each workflow contains one compact claim, a short paragraph, a crop that shows a meaningful change and one next action. Avoid four bullets repeating the same facts in another section. Short metadata such as a selected model, file path or artifact type belongs inside the demonstration only when it helps explain what is happening.

Use a numbered anchor rail on wide screens only if it materially helps navigate the three substantial sections. On smaller screens place the same links in a simple horizontal row that wraps. If using a shared preview instead, implement true tabs with one associated panel; do not visually imitate tabs while giving them unrelated anchor behavior.

### Models, plugins and evidence

After the workflow tour, show a model selector crop and explain choice per task. Its labels should derive from the current catalog at build/render time. Pair it with a Plugins/Skills workbench crop that makes available versus connected states legible. This explains extensibility with visible controls rather than a decorative orbit of logos.

Combine receipt, trace and control messaging into one evidence section. A selected run can show an action list and one result artifact; an adjacent short explanation tells the visitor what remains inspectable. Show cost only when the value comes from that run or is explicitly labeled an illustrative example. Finish with concise pricing context, an entry action and existing legal links.

## Cropped preview specifications

These are original implementation recommendations, not measurements of competitors.

| Preview | Principal crop                     | Secondary fragment                 | Essential readable content                                       | Mobile composition                              |
| ------- | ---------------------------------- | ---------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Hero    | Build conversation and output pane | One Studio result edge             | Task, active surface, result                                     | One task/result pair; remove the extra window   |
| Build   | File change plus check output      | Short action trace                 | File name, meaningful changed lines, actual check result         | One diff excerpt followed by the result line    |
| Hack    | Scope header and finding detail    | Tool output excerpt                | Authorized target/scope, tool, evidence, Max label outside frame | Scope above one finding; no terminal mosaic     |
| Studio  | Prompt and selected output         | Model control and second variation | Prompt, image/video type, renderer label                         | One output at useful size, control below        |
| Models  | Open model menu                    | Composer edge for context          | Current model, provider, alternatives                            | Real-size menu fragment with fewer visible rows |
| Plugins | Search/results and selected detail | Setup/connected state              | Provider or namespace, purpose, state                            | One result and one state; preserve naming       |

Prefer a selective DOM recreation using the product’s existing presentational primitives and neutral tokens where the component is lightweight. A frozen real product capture is also acceptable when it preserves exact UI fidelity and has an accessible description. Avoid mounting authenticated runtime contexts, editors, terminal emulators or actual network tools merely to make a marketing scene look alive.

Create sample records explicitly scoped to the marketing preview. Use readable, plausible task content without fake customers, ratings or generated performance statistics. A prepared run should be visibly labeled **“Example workflow”** or **“Recorded example”**. If a preview is live, its result, timeout and budget-exhausted behavior must remain honest; never animate an invented success after an actual request fails.

At desktop size, aim for 14–16px primary UI text in the visible crop. Chrome and tertiary metadata may be smaller, but nothing essential should require magnification. Crop unused navigation and repeated sidebars first. Fade or clip only the peripheral continuation of content, never the result needed to substantiate the claim. Use restrained 8–12px frame radii and one subtle border/shadow system; nested application elements can use tighter radii.

At narrow sizes, recompose the information rather than scale a 1440px scene to 350px. Keep the task, action and outcome in their natural reading order. Decorative desktop screenshots may retain their proportion, but a real-size caption must convey the same meaningful information. A preview that looks interactive must respond predictably or be presented as an illustration without focusable fake controls.

## Motion direction

Animate changes in work state: selecting a model, revealing a diff, completing a check, attaching an output or establishing a plugin connection. Decorative movement should remain subordinate. Only one narrative sequence should be active in the viewport at a time, with all offscreen sequences paused.

| Event               | Proposed behavior                          | Proposed timing                  | Rest state                   |
| ------------------- | ------------------------------------------ | -------------------------------- | ---------------------------- |
| Initial reveal      | Opacity plus 8–12px upward settle          | 360–480ms; ease-out              | Fully readable content       |
| Control hover/press | Color change and at most 1px press         | 120–180ms                        | Stable geometry              |
| Tab/preview change  | Short crossfade, at most 6px travel        | 180–260ms                        | One visible selected preview |
| Tool action appears | Insert one row, then reveal result         | 220–320ms transition             | Completed row remains        |
| Studio output       | Placeholder resolves into final media      | 280–400ms opacity                | Final image remains          |
| Replay              | Explicit button restarts the demonstration | Roughly 6–10s complete narrative | Stops on useful outcome      |

These durations are starting values for RIFT, not reference measurements. Verify them at normal and reduced motion, on an actual low-performance device or throttled environment, and with long translated labels. Avoid full-frame blur, animated large shadows or changes to layout dimensions. Transform and opacity generally avoid the more expensive layout/paint stages; profile the actual scene before claiming it is cheap. [6](https://web.dev/articles/animations-guide)

The default should be one deliberate playback when sufficiently visible, ending at the useful result. If continuous playback remains, provide a visible pause mechanism. Automatically moving information lasting more than five seconds alongside other content needs pause/stop/hide under WCAG 2.2.2; automatically updating information has a related requirement without the five-second exception. [7](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)

Under reduced motion, render the completed state immediately and suppress decorative camera movement, repeated blinking and automatic switching. Keep deliberate controls usable with immediate or simple opacity changes. WCAG’s Animation from Interactions guidance distinguishes nonessential motion and supports disabling it; this is a design requirement here, not a claim that the references already satisfy it. [8](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)

## Responsive and accessibility acceptance

Test the RIFT page at 320, 390, 768, 1024 and 1440 CSS pixels. Verify the primary action, every section label and the meaningful content of every crop without horizontal page scrolling. WCAG’s reflow guidance uses a width equivalent to 320 CSS pixels for vertically scrolling content, with exceptions for content whose meaning requires two dimensions. [9](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)

Preserve a single H1, coherent H2/H3 order, navigation landmarks and a skip link. Every menu, tab and replay control must have a descriptive accessible name and visible focus. A tabbed implementation should follow the ARIA pattern’s roles, selected state, panel association and keyboard behavior. Anchor links should remain ordinary links with appropriate scroll offsets. [10](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)

Use 44px interaction targets as the design target. WCAG 2.2’s AA minimum is 24 × 24 CSS pixels or qualifying spacing/exceptions; a tiny control inside a scaled screenshot should not be counted as a usable target. [11](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) Check actual text contrast against the composited background, especially muted terminal metadata and text over media. Do not use green or red alone to distinguish success from failure.

Decorative looping content should be excluded from the accessibility tree; the workflow’s meaning needs a static equivalent. If a sequence reports status, avoid making screen readers announce every animated intermediate row. A no-JavaScript or failed-hydration state must still contain the proposition, product descriptions and working navigation/entry links.

## Implementation boundaries and verification plan

Build within the current Next.js, React, Tailwind and Motion stack. Use a landing-only component boundary and styles/tokens rather than altering shared app appearance. Preserve alternate routes and existing auth/plan guards. New previews should consume a small common record structure: surface, title, input, visible actions, output, model label, evidence label and optional asset. Keep that structure separate from production execution.

The first implementation slice should contain the page shell, hero and one complete Build demonstration in both desktop and mobile layouts. Validate its readability and navigation before producing the other surfaces. Next add Hack and Studio with real capability labels, then the model/plugin controls, then final motion. This sequencing makes the design reviewable before visual effects obscure basic composition.

Verify all CTA destinations and hash navigation; keyboard navigation and focus restoration; replay/pause and reduced-motion states; unsupported media and loading/error fallbacks; narrow-screen overflow; and preview isolation from live tool execution. Run appropriate lint/type checks and focused component checks for behavior that has changed. Inspect browser errors and unexpected network calls while traversing the landing. Capture desktop and mobile evidence after the final composition is stable.

Performance acceptance should be based on measured page behavior, not on a promise that a particular framework or property is fast. Reserve preview dimensions to prevent layout movement, defer offscreen media and heavier components, avoid duplicate video decoders, and do not fetch model responses on page load. Measure loading and interaction metrics against the current page using comparable settings before assigning improvement claims.

Publication remains a separate step from visual implementation. The evidence supports a concrete landing direction and source-aware execution plan; it does not certify all product integrations, billing flows, native distribution or live demonstrations.

## Sources

1. Composio. [Homepage](https://composio.dev/). Accessed September 11, 2026. Desktop/mobile visual and computed typography observations; feature navigation and state changes. Page publication date not stated.
2. Composio. [For You](https://composio.dev/for-you). Accessed September 11, 2026. Workflow and role-based information architecture. Page publication date not stated.
3. Cursor. [AI Coding Agent for Building Ambitious Software](https://cursor.com/). Accessed September 11, 2026. Current desktop composition, computed H1, product demonstration and accessible descriptions. Page publication date not stated.
4. Warp. [The Open Platform for Automating Development](https://www.warp.dev/). Accessed September 11, 2026. Current grid/figure composition and feature selection behavior. Page publication date not stated.
5. Linear. [The system for product development](https://linear.app/). Accessed September 11, 2026. Current hero, app fragments, information architecture and observed progress states. Page publication date not stated.
6. web.dev. [How to create high-performance CSS animations](https://web.dev/articles/animations-guide). Accessed September 11, 2026. Transform/opacity and rendering performance guidance.
7. W3C WAI. [Understanding SC 2.2.2: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html). Accessed September 11, 2026. Informative explanation of Level A motion/update requirements.
8. W3C WAI. [Understanding SC 2.3.3: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html). Accessed September 11, 2026. Informative explanation of Level AAA interaction-motion guidance.
9. W3C WAI. [Understanding SC 1.4.10: Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html). Accessed September 11, 2026. Responsive reading and dimensional exceptions.
10. W3C WAI ARIA Authoring Practices. [Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/). Accessed September 11, 2026. Roles and keyboard interaction guidance.
11. W3C WAI. [Understanding SC 2.5.8: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Accessed September 11, 2026. Minimum target dimensions and exceptions.

Repository evidence additionally includes the linked source files, [historical landing teardown](/Users/cetto/RIFT-Release/docs/LANDING_X_TEARDOWN.md), [August 31 design specification](/Users/cetto/RIFT-Release/docs/superpowers/specs/2026-08-31-rift-landing-v5-verified-terrain-design.md), [MCP registry audit](/Users/cetto/RIFT-Release/docs/audits/2026-09-09/mcp-registry-implementation.md), and the September 11 clean-source verification. Earlier reference measurements are historical evidence and are not represented as current observations.
