# RIFT — Landing-page copy and layout

Part of [Power, under direction](01-agency-handoff.md). **Provisional until approved.** This is the complete page specification and copy, not a deployed page. Product owner must approve the release-specific statements before publication. Editorial notes and proof placeholders are not public page copy.

## Conversion and information architecture

**Primary action:** Request Access. Every primary button opens or anchors to the same form. Keep the CTA in the header, hero, offer block, and final section; do not insert it after every paragraph. **Secondary action:** Explore the workflow, which scrolls to the mechanism. A video action appears only once a usable, verified video exists.

**Header:** canonical RIFT logo. Navigation: Workflow · Use cases · Questions. Right: Request Access. On mobile, retain logo and primary action; put anchors in an accessible menu if needed. Avoid a dense product taxonomy.

**Hierarchy:** one H1, descriptive H2s, short H3s for benefits and use cases. Body width approximately 65 characters. No small uppercase paragraph copy. UI is shown at readable scale, and any staged label survives responsive crops.

**Access-model condition:** the supplied brief suggests early access, but the README describes public availability. Confirm before implementation. If the product is publicly open, use **Open RIFT** across this whole package and route to the verified onboarding destination; remove the request form and evaluation-review promises. Do not put an artificial waiting list in front of a functioning public product.

## 1. Hero

**Eyebrow:** RIFT / Agentic security workspace

**H1:** Security execution. Under your direction.

**Subhead:** RIFT brings agentic execution to terminal-native security work. Set an authorized objective, choose the working environment and approval mode, and inspect the tool output as the work progresses.

**Primary CTA:** Request Access

**Secondary CTA:** Explore the workflow

**Supporting line:** Bring a security workflow you want to evaluate.

**Visual:** P1 from the production file: a front-facing, release-verified view of a single operation. Show actual environment and mode if the release exposes them. If the visual is staged, retain **Staged demonstration** prominently. Do not put fabricated “all systems secure” results on the screen.

**Release contingency:** if the target security release does not support the specific configuration sequence in the subhead, replace it with: “RIFT is a terminal-native agentic security workspace for tool-based execution. Evaluate it against a defined security workflow, with the execution environment and available approval controls made clear.” Do not show unsupported controls.

**Headline options for controlled testing:**

- Recommended: **Security execution. Under your direction.**
- Operator leverage: **Keep your attention on the investigation.**
- Evidence angle: **Agentic security work you can inspect.**

**Alternative subheads:**

- “Delegate tool-based security work in a terminal-native workspace. Evaluate the execution environment, available approval choices, and output against the way your team works.”
- “For security engineers and red-team operators moving from separate tool runs to agentic workflows. Bring one authorized objective and evaluate RIFT against it.”

Choose one headline/subhead pair. Do not rotate headlines automatically or combine all variants into a long hero.

## 2. Problem

**H2:** The command is only one part of the work.

**Body:** Security work moves through tools, results, notes, and decisions. Running a command is one step. Interpreting the output, carrying context forward, and deciding what happens next are part of the same job.

**Supporting copy:** Adding an agent raises another set of questions: where will the work run, which actions require a decision, and what will you be able to inspect afterward?

**Visual:** three editorial columns labeled **Tool**, **Output**, **Next decision**, linked by a simple reading path. They illustrate workflow structure; they are not comparative performance data. No staged “before” mess with fifty tabs.

**Hierarchy:** H2, two short paragraphs, diagram. No CTA needed.

## 3. Desired outcome

**H2:** Delegate execution. Stay close to the work.

**Body:** The aim is more room for operator judgment: define the objective, understand the execution context, and review what the work produces. RIFT brings an agentic approach to that process, with terminal-native interaction and tool output at the center.

**Three supporting labels:**

- **Direction:** start with a defined objective.
- **Context:** know the selected environment and approval mode.
- **Review:** inspect what the output supports.

**Visual:** a single continuous horizontal sequence on desktop, vertical on mobile. Describe direction, context, and review as the intended operating model; do not claim that RIFT eliminates manual work or operator responsibility.

## 4. Product mechanism

**H2:** From objective to tool output.

**Body:** RIFT is designed to carry out tool-based security workflows. The agent works from the objective and available context, uses tools, and reasons about the returned output to inform its next step.

**Environment note:** The execution target matters. A configured cloud sandbox and a local terminal are different environments. Local terminal commands run with the permissions of the local account; review prompts do not make that shell an OS sandbox.

**Approval note:** Approval behavior depends on the selected mode. Confirm the mode before execution; do not assume every action will pause for review.

**Visual:** five plain labels: **Objective → Context → Tool action → Output → Next step**. Below, show one actual captured sequence if available. Do not create a diagram that suggests the agent enforces all policy boundaries unless those boundaries are verified.

**Interaction:** click or tap steps to reveal short explanations only if useful. Essential copy stays available without interaction. No fake running animation.

## 5. Benefits

**H2:** Put the operator’s decisions in focus.

**H3: Delegate tool-based work**

Use an agentic workflow for execution that would otherwise require repeated manual coordination. Evaluate the fit against a task you understand.

**H3: Work in a familiar technical language**

Terminal-native interaction keeps commands and their output close to the task. The workspace is built around technical work, not a layer of decorative dashboards.

**H3: Review with context**

Read the output alongside the task you set. Keep a clear distinction between what a tool returned, what the agent inferred, and what still needs validation.

**H3: Choose the execution setup deliberately**

Understand the available environment and approval settings before the work begins. Choose the configuration appropriate to the workflow you are authorized to run.

**Visual:** four modest text blocks, no giant feature icons. Attach a real detail crop to the most important benefit rather than inventing a new screenshot for each. Claims describe use and design intent; they do not quantify time saved.

## 6. How it works

**H2:** Start with one workflow worth evaluating.

1. **Define the objective.** Identify the authorized task, relevant context, and the result you need to assess.
2. **Confirm the setup.** Check the execution target and available approval mode. Local and cloud execution have different boundaries.
3. **Follow the work.** Review proposed actions where the selected mode requires it, then inspect available tool output.
4. **Assess the result.** Decide what the result supports, what needs further validation, and whether RIFT fits the workflow.

**Visual:** four numbered rows; each row has one image detail or none. Use release-accurate wording. Do not invent a “scope enforcement” toggle because the process mentions an authorized objective.

## 7. Use cases

**H2:** A concrete task is the best starting point.

**Reconnaissance**

Evaluate how RIFT assists with gathering and interpreting information about an authorized target. Review the actual methods and output rather than assuming passive behavior.

**Security testing and validation**

Explore a bounded testing workflow in a controlled environment. Inspect the evidence before treating a potential finding as confirmed.

**Research and follow-up**

Use the agentic workflow to support technical investigation, with the operator deciding what the result establishes and what to test next.

**Repetitive security work**

Bring a repeatable task with clear inputs and an inspectable outcome. Evaluate whether RIFT can reduce the coordination involved in that particular workflow.

**Visual:** simple list, four descriptive labels, one expanded example. Examples are illustrative use cases from the supplied brief; tools and support vary by release and environment. Do not imply every listed task is guaranteed to complete autonomously.

## 8. Why RIFT versus alternatives

**H2:** Choose the working model that fits the task.

**Body:** RIFT is worth evaluating when you want agentic tool execution in a terminal-native security workspace. The right choice depends on how repeatable the task is, how much operator judgment it needs, and where it must run.

| Working model             | When it fits                                                                 | Question to ask                                                                           |
| ------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Direct CLI tools          | Precise, operator-directed work with familiar tools                          | How much coordination do I want to handle myself?                                         |
| A task-specific script    | A stable process with known inputs and behavior                              | Who maintains the script when the workflow changes?                                       |
| An AI advice conversation | Planning, explanation, or interpretation without necessarily executing tools | How will advice become work in the intended environment?                                  |
| RIFT                      | Evaluating agentic execution within a terminal-native security workflow      | Do the available tools, environment, approvals, and output meet this task’s requirements? |

**Visual:** a quiet comparison table, not a wall of RIFT checkmarks. This compares operating models, not named competitors or exclusive features. No assertion that all other agents lack execution or control.

## 9. Proof

**H2, only when real evidence is ready:** Inspect a real workflow.

**Public intro, only with a verified capture:** This demonstration shows a defined task in an authorized lab environment. Review the execution target, approval mode, tool activity, and outcome together.

**Internal proof slots — do not publish as customer-facing facts:**

- **[VERIFIED DEMONSTRATION]** Capture owner supplies the release/build, date, authorized lab context, environment, mode, unedited source footage, and edited demonstration.
- **[REVIEWABLE RESULT]** Show output that can be understood in context. Redact sensitive details; note the limits of the result.
- **[PERMISSIONED OPERATOR COMMENT]** Exact quotation, real identity, explicit publication permission, and relevant context. Omit the block until available.
- **[MEASURED WORKFLOW COMPARISON]** If produced later, disclose method, task, settings, repetitions, and limitations. No empty numerical tiles.

**Fallback if proof is not ready:** rename the section **What to inspect in your evaluation**. Use these exact three lines: “Check the execution environment. Understand the approval mode. Read the output in context.” Use an editorial checklist, not a fake demo or a “trusted by” strip.

**Visual:** real media with visible provenance; no customer logos until permission and customer relationship are verified.

## 10. Objection handling

**H2:** Questions to settle before execution.

**“Will every action ask for approval?”**

Approval behavior varies by mode. Review the selected settings and the behavior available in the release you are evaluating. A mode that runs freely should not be understood as per-action approval.

**“Is local execution sandboxed?”**

The documented local terminal shell runs with the permissions of the local account. Approval prompts are a decision step, not OS-level isolation. A configured cloud sandbox is a separate execution environment.

**“Can I treat the agent’s conclusion as a confirmed finding?”**

Review the tool output and validate the conclusion against your assessment requirements. A completed command is not proof that a target is secure, and a potential finding is not automatically confirmed.

**Visual:** three compact question/answer blocks. Keep this content near the mechanism and proof, not hidden behind a distant policy link.

## 11. Offer and CTA block

**H2:** Bring a workflow. See where RIFT fits.

**Body:** Tell us what you want to evaluate: the security task, the environment, and the outcome you need to inspect. Request access to explore RIFT against that workflow.

**CTA:** Request Access

**Supporting line:** Availability and next steps will be confirmed after review.

**Internal condition:** the team must agree to actually review requests and provide next steps before this supporting line is published. Do not promise a response deadline or bespoke onboarding that has not been approved.

**Visual:** a quiet contrasting surface; no fabricated scarcity, countdown, waitlist total, or “limited spots” badge.

### Form copy and states

**Title:** Request access to RIFT

**Description:** Start with one workflow you want to evaluate.

| Field               | Label                            | Helper / example                                                                                          |
| ------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Required email      | Email                            | Use the address where you want to receive access information.                                             |
| Required role       | Your role                        | Security engineer · Red team / pentester · Researcher · Security lead · Platform / infrastructure · Other |
| Required short text | What would you like to evaluate? | For example: reconnaissance against an authorized lab environment.                                        |
| Optional selection  | Expected execution environment   | Cloud sandbox · Local environment · Not sure yet                                                          |

**Privacy helper:** “Do not include credentials, private target details, or sensitive findings.” Link a real approved privacy notice using the label **Privacy notice** before collecting data. No invented privacy promise or silent marketing subscription.

**Submit button:** Request Access

**Loading:** Sending request…

**Success heading:** Request received.

**Success body:** We’ve received your evaluation request. Availability and next steps will be sent to the email you provided.

**Error:** We couldn’t send your request. Please try again. Your entries are still here.

**Invalid email:** Enter a valid email address.

**Missing workflow:** Tell us briefly what you want to evaluate.

**Implementation requirements:** real receiving service and owner; persist submissions before success; preserve fields on failure; prevent accidental duplicate submissions; keyboard access; accessible validation; tested mobile layout. Success wording assumes the promised follow-up process is staffed. Do not implement a frontend-only form that reports success without delivering the request.

## 12. FAQ

**What is RIFT?**

RIFT is a terminal-native agentic security workspace designed for tool-based security work, including reconnaissance, testing, validation, and repetitive workflows. The available capabilities depend on the release and execution environment.

**Who is it for?**

Security engineers, red-team operators, and researchers carrying out authorized work. Security leads can evaluate it for operational fit with their teams.

**How autonomous is it?**

RIFT is designed to support autonomous and operator-guided execution. The actual approval behavior depends on the selected mode. Confirm those settings before running a task.

**Where does work execute?**

RIFT documentation describes cloud and local execution paths. These have different boundaries. In the documented local terminal, commands run with local-account permissions and are not OS-sandboxed merely because they are reviewed.

**Does this replace a security assessment or professional judgment?**

Evaluate RIFT as part of a security workflow. You still need to determine scope, review evidence, validate conclusions, and decide whether the result meets your assessment requirements.

**What about audit logs and data handling?**

Review the exact retention, access, output visibility, and export behavior of the release you intend to use. Discuss those requirements during evaluation. This page does not claim a certified audit trail, a retention guarantee, or a compliance certification.

**How do I get access?**

Submit your intended workflow through Request Access. Availability and next steps will be confirmed after review. [Internal: replace with verified onboarding instructions if access is already public.]

**What does it cost?**

Current commercial terms will be confirmed before you begin an evaluation. [Internal: replace with approved pricing or a verified pricing-page link once the launch offer is settled. Do not copy unverified prices from the README.]

**Visual:** simple accordion if needed, with semantic controls and keyboard access. The environment and approval answers should also remain visible in the page body; critical context must not rely entirely on collapsed content.

## 13. Final CTA

**H2:** Start with a real security workflow.

**Body:** Define what you want to evaluate. See whether RIFT fits the way you work.

**CTA:** Request Access

**Visual:** canonical logo, quiet background, no new metaphor or last-minute feature claim.

## 14. Footer and prelaunch review

**Footer copy:** RIFT / Terminal-native agentic security workspace.

Show only real links: Contact, Privacy notice, Terms, and available product documentation. Confirm destinations and ownership before publishing. Do not invent a security certification page or an enterprise sales motion.

**Page review:** verify the approved claim version, all links, access model, real form delivery, mobile product readability, preserved staged labels, keyboard navigation, text contrast, reduced motion, failure states, and analytics events. The visual style is graphite, readable, and sparse; motion explains state rather than delaying content.
