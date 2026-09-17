"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Play,
  RotateCcw,
  Code2,
  Clapperboard,
  ShieldCheck,
  Check,
  FileCode2,
  PanelLeft,
} from "lucide-react";
import { RiftLogo } from "@/components/icons/rift-logo";
import { RiftReasoningOrb } from "@/components/ui/rift-reasoning-orb";
import {
  AssistantTranscript,
  type TranscriptPart,
} from "@/app/components/AssistantTranscript";
import styles from "./action.module.css";

const flows = [
  {
    name: "Build",
    icon: Code2,
    label: "FROM IDEA TO IMPLEMENTATION",
    headline: "Less between you\nand your next idea.",
    body: "An agent with room to work. Move from a conversation into your files, terminal and preview, without losing the thread.",
    prompt: "Review the navigation and make it work on mobile.",
    steps: [
      "Read the navigation component",
      "Inspect the mobile breakpoints",
      "Review the proposed change",
    ],
    result: "Keep the navigation in reach.",
    detail:
      "A small-screen navigation review, with the relevant file and a focused change to inspect.",
    file: "components / navigation.tsx",
    code: [
      '<nav aria-label="Main navigation">',
      "  <MenuButton aria-expanded={open} />",
      "  <NavigationLinks visible={open} />",
      "</nav>",
    ],
    link: "/",
  },
  {
    name: "Studio",
    icon: Clapperboard,
    label: "FROM DIRECTION TO CREATION",
    headline: "Make the work\nlook like your vision.",
    body: "Bring image and video models into the same creative space. Shape the brief, explore a direction and download what you make.",
    prompt: "Help me art-direct a quiet, monochrome product film.",
    steps: [
      "Shape the visual direction",
      "Choose a format and model",
      "Prepare the production brief",
    ],
    result: "A study in light. And less.",
    detail:
      "A creative brief for a 9:16 film: tactile movement, soft light, no voiceover. Choose your model in Studio to produce it.",
    file: "studio / creative-brief",
    code: [
      "FORMAT     9:16 · vertical",
      "LIGHT      Soft, even, natural",
      "MOVEMENT   Slow macro tracking",
      "SOUND      Surface, touch, release",
    ],
    link: "/studio",
  },
  {
    name: "Hack Workbench",
    icon: ShieldCheck,
    label: "FROM ASSUMPTION TO EVIDENCE",
    headline: "Know where\nto look closer.",
    body: "Investigate the systems you’re authorized to assess. Keep scope, evidence and remediation together in a focused workbench.",
    prompt: "Review the cookie configuration in my own application.",
    steps: [
      "Define the authorized scope",
      "Inspect the supplied configuration",
      "Explain the finding and remediation",
    ],
    result: "A finding you can act on.",
    detail:
      "Example review: a session cookie without HttpOnly. Inspect the evidence, then decide how to remediate it.",
    file: "workbench / cookie-review",
    code: [
      "Finding    Missing HttpOnly flag",
      "Evidence   httpOnly: false",
      "Action     Set httpOnly: true",
      "Verify     Inspect Set-Cookie header",
    ],
    link: "/hack",
  },
];
const connectors = [
  {
    id: "github",
    name: "GitHub",
    task: "Review a repository",
    description: "Bring repository context into your development workflow.",
  },
  {
    id: "notion",
    name: "Notion",
    task: "Find the project brief",
    description: "Connect project knowledge to the task in front of you.",
  },
  {
    id: "linear",
    name: "Linear",
    task: "Work from an issue",
    description: "Turn a clearly scoped issue into a plan of action.",
  },
  {
    id: "supabase",
    name: "Supabase",
    task: "Explore your data",
    description: "Give your agent the database context it needs.",
  },
  {
    id: "sentry",
    name: "Sentry",
    task: "Investigate an error",
    description: "Put error evidence alongside your code and tools.",
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    task: "Read the web",
    description: "Bring source material into research and discovery.",
  },
];
const models = [
  {
    id: "openai",
    name: "OpenAI",
    copy: "Reason through a problem. Build on the result.",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    copy: "Explore a brief, work through code, refine the details.",
  },
  {
    id: "gemini",
    name: "Google",
    copy: "Bring multimodal context into your workflow.",
  },
  {
    id: "xai",
    name: "xAI",
    copy: "A different perspective, in the same workspace.",
  },
  { id: "qwen", name: "Qwen", copy: "More choice for the way you work." },
  { id: "kimi", name: "Kimi", copy: "Choose the model that fits the task." },
];

export function ActionLanding() {
  const [active, setActive] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [connector, setConnector] = useState(0);
  const [model, setModel] = useState(0);
  const [menu, setMenu] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const reduced = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const flow = flows[active];
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(
      () => {
        if (step < 3) setStep(step + 1);
        else setPlaying(false);
      },
      reduced ? 100 : 1050,
    );
    return () => clearTimeout(timer);
  }, [playing, step, reduced]);
  function choose(index: number) {
    setActive(index);
    setStep(0);
    setPlaying(false);
  }
  const parts: TranscriptPart[] = flow.steps
    .slice(0, step)
    .map((text, index) => ({
      type: index === 0 ? "tool-read_file" : "tool-shell",
      state: "output-available",
      input: { path: flow.file, description: text },
    }));
  const reveal = {
    initial: reduced ? false : { opacity: 1, y: 18 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.12 },
    transition: { duration: 0.5, ease: "easeOut" as const },
  };
  return (
    <div className={styles.page} data-motion-paused={motionPaused}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <header className={styles.nav}>
        <a href="/landing" className={styles.brand} aria-label="RIFT home">
          <RiftLogo size={34} />
          <span>RIFT</span>
        </a>
        <nav aria-label="Main">
          <a href="#workspace">Product</a>
          <a href="#connections">Connections</a>
          <a href="#models">Models</a>
        </nav>
        <div className={styles.navRight}>
          <a href="/login">Log in</a>
          <a className={styles.smallButton} href="/signup">
            Start building <ArrowUpRight size={15} />
          </a>
          <button
            className={styles.menuButton}
            aria-label="Navigation menu"
            aria-expanded={menu}
            aria-controls="landing-menu"
            onClick={() => setMenu(!menu)}
          >
            <Plus style={{ transform: menu ? "rotate(45deg)" : undefined }} />
          </button>
        </div>
        {menu && (
          <nav
            id="landing-menu"
            className={styles.mobileNav}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setMenu(false);
                (
                  e.currentTarget.parentElement?.querySelector(
                    '[aria-controls="landing-menu"]',
                  ) as HTMLElement
                )?.focus();
              }
            }}
          >
            {["workspace", "connections", "models"].map((id) => (
              <a key={id} href={`#${id}`} onClick={() => setMenu(false)}>
                {id}
              </a>
            ))}
          </nav>
        )}
      </header>
      <main id="main">
        <section className={styles.hero}>
          <div className={styles.horizon} aria-hidden="true">
            <div />
            <div />
            <div />
          </div>
          <div className={styles.heroInner}>
            <p className={styles.eyebrow}>
              <span /> THE SPACE BETWEEN IDEA AND REALITY
            </p>
            <h1>
              Think it.
              <br />
              <span>Take it further.</span>
            </h1>
            <p className={styles.lede}>
              Code, create, investigate.
              <br />
              One workspace for everything that comes next.
            </p>
            <div className={styles.actions}>
              <a className={styles.button} href="/signup">
                Start with RIFT <ArrowUpRight size={18} />
              </a>
              <a href="#workspace">
                Explore the workspace <ArrowRight size={17} />
              </a>
            </div>
          </div>
          <div className={styles.heroFoot}>
            <span>BUILT FOR THE WORK. NOT JUST THE ANSWER.</span>
            <a href="#workspace">SCROLL TO EXPLORE ↓</a>
          </div>
        </section>
        <section id="workspace" className={styles.workspace}>
          <motion.div {...reveal} className={styles.sectionHeading}>
            <p className={styles.eyebrow}>01 / THE WORKSPACE</p>
            <div>
              <h2>
                A place to put
                <br />
                intelligence to work.
              </h2>
              <p>
                Follow an idea through the tools, the details
                <br className={styles.desktopBreak} /> and the decisions that
                turn it into something.
              </p>
            </div>
          </motion.div>
          <div
            className={styles.productTabs}
            role="tablist"
            aria-label="Explore RIFT workflows"
          >
            {flows.map((f, i) => (
              <button
                id={`workflow-tab-${i}`}
                role="tab"
                aria-selected={active === i}
                aria-controls="workflow-panel"
                tabIndex={active === i ? 0 : -1}
                key={f.name}
                onClick={() => choose(i)}
                onKeyDown={(e) => {
                  if (
                    !["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  const n =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? 2
                        : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
                  choose(n);
                  document.getElementById(`workflow-tab-${n}`)?.focus();
                }}
              >
                <f.icon size={17} />
                {f.name}
                <span>0{i + 1}</span>
              </button>
            ))}
          </div>
          <motion.div
            {...reveal}
            ref={stageRef}
            className={styles.desktop}
            id="workflow-panel"
            role="tabpanel"
            aria-labelledby={`workflow-tab-${active}`}
          >
            <div className={styles.windowBar}>
              <span className={styles.traffic} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>RIFT / {flow.name}</span>
              <span className={styles.demoLabel}>
                INTERACTIVE PRODUCT WALKTHROUGH
              </span>
            </div>
            <div className={styles.appBody}>
              <aside className={styles.appSidebar}>
                <RiftLogo size={29} />
                <div className={styles.newChat}>
                  <Plus size={14} /> New chat
                </div>
                {flows.map((f, i) => (
                  <button
                    key={f.name}
                    onClick={() => choose(i)}
                    aria-pressed={i === active}
                  >
                    <f.icon size={15} />
                    {f.name}
                  </button>
                ))}
                <small>Today</small>
                <span className={styles.selectedThread}>
                  {playing ? (
                    <RiftReasoningOrb />
                  ) : (
                    <span className={styles.threadDot} />
                  )}{" "}
                  Explore {flow.name}
                </span>
                <div className={styles.sidebarBottom}>
                  <PanelLeft size={15} />
                  <span>Your workspace</span>
                </div>
              </aside>
              <div className={styles.appChat}>
                <div className={styles.chatTitle}>
                  {flow.name}
                  <span>Example walkthrough</span>
                </div>
                <div className={styles.prompt}>{flow.prompt}</div>
                <div className={styles.activity} aria-live="polite">
                  {playing ? (
                    <>
                      <RiftReasoningOrb />
                      <span className={styles.shimmer}>
                        {flow.steps[Math.min(step, 2)]}
                      </span>
                    </>
                  ) : step === 3 ? (
                    <>
                      <Check size={15} /> Walkthrough complete
                    </>
                  ) : (
                    <>
                      <RiftLogo size={19} /> See how the workflow comes
                      together.
                    </>
                  )}
                </div>
                <AssistantTranscript
                  parts={parts}
                  status={playing ? "streaming" : "ready"}
                  renderPart={(i) => (
                    <p className={styles.step}>
                      <Check size={14} />
                      {flow.steps[i]}
                    </p>
                  )}
                />
                {step === 3 && (
                  <motion.p
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={styles.demoAnswer}
                  >
                    {flow.detail}
                  </motion.p>
                )}
                <div className={styles.composer}>
                  <span>Explore this workflow</span>
                  <div>
                    <span>{flow.name}</span>
                    <button
                      aria-label={
                        playing
                          ? "Pause walkthrough"
                          : step === 3
                            ? "Replay walkthrough"
                            : "Play walkthrough"
                      }
                      onClick={() => {
                        if (playing) setPlaying(false);
                        else {
                          if (step === 3) setStep(0);
                          setPlaying(true);
                        }
                      }}
                    >
                      {playing ? (
                        "Pause"
                      ) : step === 3 ? (
                        <>
                          <RotateCcw size={14} /> Replay
                        </>
                      ) : (
                        <>
                          <Play size={14} /> Play
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div className={styles.inspector}>
                <div className={styles.inspectorTitle}>
                  <FileCode2 size={14} />
                  {flow.file}
                </div>
                <div
                  className={`${styles.artwork} ${styles[`artwork${active}`]}`}
                  aria-hidden="true"
                >
                  <RiftLogo size={130} />
                </div>
                <div className={styles.inspectContent}>
                  <p className={styles.eyebrow}>
                    {active === 0
                      ? "CHANGE REVIEW"
                      : active === 1
                        ? "CREATIVE DIRECTION"
                        : "EVIDENCE & REMEDIATION"}
                  </p>
                  <h3>{flow.result}</h3>
                  <pre>
                    {flow.code.map((line, i) => (
                      <span key={line}>
                        <b>{String(i + 1).padStart(2, "0")}</b>
                        {line}
                        {"\n"}
                      </span>
                    ))}
                  </pre>
                </div>
              </div>
            </div>
          </motion.div>
          <p className={styles.caption}>
            Built with RIFT’s transcript and activity components. Example data;
            no live task is started.
          </p>
          <div className={styles.flowStory}>
            <div>
              <p className={styles.eyebrow}>{flow.label}</p>
              <h3>{flow.headline}</h3>
            </div>
            <div>
              <p>{flow.body}</p>
              <a href={flow.link}>
                Open {flow.name} <ArrowUpRight size={17} />
              </a>
            </div>
          </div>
        </section>
        <section id="connections" className={styles.connections}>
          <motion.div {...reveal} className={styles.sectionHeading}>
            <p className={styles.eyebrow}>02 / CONNECT THE DOTS</p>
            <div>
              <h2>
                Your tools.
                <br />A wider field of action.
              </h2>
              <p>
                Extend the workspace with MCP connections.
                <br />
                Choose the context. Keep control of access.
              </p>
            </div>
          </motion.div>
          <div className={styles.network}>
            <div className={styles.connectorList}>
              {connectors.map((c, i) => (
                <button
                  key={c.id}
                  aria-pressed={connector === i}
                  onClick={() => setConnector(i)}
                >
                  <span className={styles.logoTile}>
                    <Image
                      src={`/plugin-logos/${c.id}.svg`}
                      alt=""
                      width="24"
                      height="24"
                      loading="lazy"
                    />
                  </span>
                  <span>
                    {c.name}
                    <small>{c.task}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
            <div className={styles.networkStage}>
              <svg
                viewBox="0 0 600 350"
                preserveAspectRatio="none"
                className={styles.paths}
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="rift-path">
                    <stop stopColor="#c6a7f5" />
                    <stop offset="1" stopColor="#ffcda8" />
                  </linearGradient>
                </defs>
                {[35, 91, 147, 203, 259, 315].map((y, i) => (
                  <path
                    key={y}
                    className={connector === i ? styles.pathActive : undefined}
                    d={`M0 ${y} H110 Q155 ${y} 175 175 H290 Q350 175 360 175 H600`}
                  />
                ))}
              </svg>
              <div className={styles.core}>
                <RiftLogo size={65} />
              </div>
              <div className={styles.connectionDetail} key={connector}>
                <span className={styles.eyebrow}>
                  MCP / {connectors[connector].name.toUpperCase()}
                </span>
                <h3>{connectors[connector].task}</h3>
                <p>{connectors[connector].description}</p>
                <a href="/plugins">
                  Explore connections <ArrowRight size={15} />
                </a>
              </div>
            </div>
          </div>
          <p className={styles.caption}>
            Connection examples from the RIFT catalog. Availability and
            authorization depend on the connector.
          </p>
        </section>
        <section id="models" className={styles.models}>
          <motion.div {...reveal}>
            <p className={styles.eyebrow}>03 / INTELLIGENCE, YOUR CHOICE</p>
            <h2>
              Different minds.
              <br />
              <span>Same momentum.</span>
            </h2>
            <p className={styles.modelIntro}>
              Choose your model without changing your workspace.
            </p>
            <div className={styles.modelList} aria-label="Model providers">
              {models.map((m, i) => (
                <button
                  key={m.id}
                  aria-pressed={model === i}
                  onClick={() => setModel(i)}
                >
                  <Image
                    src={`/brands/providers/${m.id}.svg`}
                    alt=""
                    width="30"
                    height="30"
                    loading="lazy"
                  />
                  {m.name}
                </button>
              ))}
            </div>
            <p className={styles.modelCopy} aria-live="polite">
              {models[model].copy}
            </p>
            <Link href="/">
              Explore models in RIFT <ArrowUpRight size={17} />
            </Link>
          </motion.div>
        </section>
        <section className={styles.closing}>
          <p className={styles.eyebrow}>THE NEXT THING STARTS HERE</p>
          <h2>
            Make room
            <br />
            for what’s next.
          </h2>
          <a className={styles.button} href="/signup">
            Open your workspace <ArrowUpRight size={18} />
          </a>
        </section>
      </main>
      <footer className={styles.footer}>
        <a className={styles.brand} href="/landing">
          <RiftLogo size={33} />
          RIFT
        </a>
        <span>A workspace for ideas in motion.</span>
        <div>
          <a href="/login">Log in</a>
          <a href="/pricing">Pricing</a>
          <a href="/privacy-policy">Privacy</a>
          <a href="/terms-of-service">Terms</a>
          <button
            className={styles.motionToggle}
            aria-pressed={motionPaused}
            onClick={() => setMotionPaused(!motionPaused)}
          >
            {motionPaused ? "Resume ambient motion" : "Pause ambient motion"}
          </button>
        </div>
        <span className={styles.footerWord} aria-hidden="true">
          RIFT
        </span>
      </footer>
    </div>
  );
}
