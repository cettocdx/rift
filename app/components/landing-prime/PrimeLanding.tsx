"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
  Plus,
  Pause,
  Play,
  X,
  Menu,
  Code2,
  Aperture,
  Shield,
  Command,
  Download,
} from "lucide-react";
import { RiftLogo } from "@/components/icons/rift-logo";
import styles from "./prime.module.css";

const Sculpture = dynamic(() => import("./PrimeSculpture"), { ssr: false });
const workspaces = [
  {
    id: "build",
    name: "Build",
    icon: Code2,
    title: "From a thought\nto a working thing.",
    description:
      "Give your ideas a place to become software. Work with your agent across code, files and terminal, with your project always in context.",
    image: "desktop-build.png",
    alt: "RIFT desktop Build workspace with its project and model controls",
    caption: "Build workspace · captured in the RIFT desktop app",
    href: "/",
    cta: "Open Build",
  },
  {
    id: "studio",
    name: "Studio",
    icon: Aperture,
    title: "Your vision.\nMade visible.",
    description:
      "Find a direction. Make an image. Shape a film. Bring image and video models into the same workspace as the rest of your ideas.",
    image: "desktop-studio.png",
    alt: "A ceramic sphere image generated in the actual RIFT Studio desktop interface",
    caption: "Studio · an actual image generation in the desktop app",
    href: "/studio",
    cta: "Open Studio",
  },
  {
    id: "hack",
    name: "Hack",
    icon: Shield,
    title: "Look closer.\nKnow more.",
    description:
      "Move from assumptions to evidence. Investigate your authorized systems with a dedicated security workbench, real tools and a clear record of the work.",
    image: "desktop-hack.png",
    alt: "RIFT Hack Workbench showing an actual review of a hypothetical configuration",
    caption: "Hack Workbench · actual review of a hypothetical configuration",
    href: "/hack",
    cta: "Open Hack Workbench",
  },
];
const questions = [
  [
    "What can I do with RIFT?",
    "Build software with an agent that can work across your project, generate images and video in Studio, and review authorized systems in Hack Workbench. Each discipline has its own workspace, inside the same application.",
  ],
  [
    "Can I choose my AI model?",
    "Build and Studio offer model selection for the task at hand. The available models and controls depend on your workspace and plan. Hack Workbench uses its configured security agent.",
  ],
  [
    "Does RIFT work with my existing projects?",
    "You can bring a project into Build, connect GitHub, and work with files, the terminal and project context. Available connections and execution environments depend on your setup.",
  ],
  [
    "Where can I use RIFT?",
    "RIFT is available on the web and as a desktop application. Visit the download page for current platform availability and installation instructions.",
  ],
];

export function PrimeLanding() {
  const [active, setActive] = useState(1);
  const [menu, setMenu] = useState(false);
  const [paused, setPaused] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = workspaces[active];
  useEffect(() => {
    const nodes = root.current?.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!nodes) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-visible", "true");
            io.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 },
    );
    nodes.forEach((node) => io.observe(node));
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!menu) return;
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenu(false);
        menuButton.current?.focus();
      }
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [menu]);
  function changeTab(index: number, focus = false) {
    setActive(index);
    if (focus) tabs.current[index]?.focus();
  }
  return (
    <div ref={root} className={styles.page}>
      <a href="#prime-main" className={styles.skip}>
        Skip to content
      </a>
      <header className={styles.header}>
        <a href="/landing" aria-label="RIFT home" className={styles.brand}>
          <RiftLogo size={35} />
          <span>Rift</span>
          <span className={styles.brandDot}>®</span>
        </a>
        <nav className={styles.desktopNav} aria-label="Main navigation">
          <a href="#workspace">Workspace</a>
          <a href="#how-it-works">How it works</a>
          <a href="/pricing">
            Pricing <ArrowUpRight size={12} />
          </a>
        </nav>
        <div className={styles.headerActions}>
          <a className={styles.login} href="/login">
            Log in
          </a>
          <a className={styles.headerCta} href="/download">
            Get RIFT <ArrowUpRight size={16} />
          </a>
          <button
            ref={menuButton}
            className={styles.menuButton}
            aria-label={menu ? "Close navigation" : "Open navigation"}
            aria-expanded={menu}
            aria-controls="prime-mobile-nav"
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
        {menu && (
          <nav
            id="prime-mobile-nav"
            className={styles.mobileNav}
            aria-label="Mobile navigation"
            onClick={() => setMenu(false)}
          >
            <a href="#workspace">
              Workspace <ArrowUpRight />
            </a>
            <a href="#how-it-works">
              How it works <ArrowUpRight />
            </a>
            <a href="/pricing">
              Pricing <ArrowUpRight />
            </a>
            <a href="/login">
              Log in <ArrowUpRight />
            </a>
          </nav>
        )}
      </header>
      <main id="prime-main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.tinyMark} /> INTELLIGENCE, PUT TO WORK.
            </p>
            <h1 id="hero-title">
              <span>Your next idea.</span>
              <span>Already</span>
              <span className={styles.yellow}>in motion.</span>
            </h1>
            <p className={styles.heroDescription}>
              Build software. Create media. Test your systems.
              <br className={styles.desktopBreak} /> One AI workspace to take it
              all further.
            </p>
            <div className={styles.heroActions}>
              <a href="/download" className={styles.primary}>
                Get RIFT <ArrowUpRight size={20} />
              </a>
              <a href="#workspace" className={styles.textLink}>
                Meet your workspace <ArrowDown size={16} />
              </a>
            </div>
            <p className={styles.platformNote}>
              <Command size={13} /> On your desktop. In your browser.
            </p>
          </div>
          <div className={styles.heroArt}>
            <Sculpture paused={paused} />
            <div className={styles.artFoot}>
              <span>Made to move ideas forward.</span>
              <button
                onClick={() => setPaused(!paused)}
                aria-label={
                  paused ? "Resume sculpture motion" : "Pause sculpture motion"
                }
                aria-pressed={paused}
              >
                {paused ? <Play size={13} /> : <Pause size={13} />}
              </button>
            </div>
          </div>
          <div className={styles.heroBottom}>
            <span>ONE WORKSPACE. NO CEILING.</span>
            <div>
              <a href="#workspace" onClick={() => setActive(0)}>
                <Code2 /> Build
              </a>
              <i />
              <a href="#workspace" onClick={() => setActive(1)}>
                <Aperture /> Studio
              </a>
              <i />
              <a href="#workspace" onClick={() => setActive(2)}>
                <Shield /> Hack Workbench
              </a>
            </div>
            <a
              href="#workspace"
              className={styles.scrollLink}
              aria-label="Explore the workspace"
            >
              <ArrowDown size={18} />
            </a>
          </div>
        </section>

        <section id="workspace" className={styles.workspace}>
          <div className={styles.sectionIntro} data-reveal>
            <p className={styles.eyebrow}>THE ROOM TO DO MORE</p>
            <h2>
              Different disciplines.
              <br />
              <span>Same momentum.</span>
            </h2>
            <p>
              Your best work doesn’t fit in a chat box.
              <br />
              Give it a whole workspace.
            </p>
          </div>
          <div
            className={styles.workspaceTabs}
            role="tablist"
            aria-label="Explore RIFT workspaces"
            data-reveal
          >
            {workspaces.map((item, index) => (
              <button
                key={item.id}
                ref={(el) => {
                  tabs.current[index] = el;
                }}
                id={`tab-${item.id}`}
                role="tab"
                aria-selected={active === index}
                aria-controls="workspace-panel"
                tabIndex={active === index ? 0 : -1}
                onClick={() => changeTab(index)}
                onKeyDown={(event) => {
                  let next = index;
                  if (event.key === "ArrowRight") next = (index + 1) % 3;
                  else if (event.key === "ArrowLeft") next = (index + 2) % 3;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = 2;
                  else return;
                  event.preventDefault();
                  changeTab(next, true);
                }}
              >
                <item.icon size={19} />
                {item.name}
                <ArrowUpRight className={styles.tabArrow} size={18} />
              </button>
            ))}
          </div>
          <div
            id="workspace-panel"
            role="tabpanel"
            aria-labelledby={`tab-${current.id}`}
            tabIndex={0}
            className={styles.productPanel}
          >
            <div className={styles.productCopy} key={current.id}>
              <h3>{current.title}</h3>
              <p>{current.description}</p>
              <a href={current.href} className={styles.textLink}>
                {current.cta} <ArrowUpRight size={18} />
              </a>
              <span className={styles.productWord}>
                {current.name}
                <span>↗</span>
              </span>
            </div>
            <div className={styles.productVisual}>
              <div className={styles.screenshotWrap}>
                {workspaces.map((item, index) => (
                  <Image
                    key={item.id}
                    src={`/landing-prime/${item.image}`}
                    alt={item.alt}
                    width="1229"
                    height="768"
                    loading="lazy"
                    className={
                      index === active
                        ? styles.activeScreenshot
                        : styles.hiddenScreenshot
                    }
                  />
                ))}
              </div>
              <p className={styles.captureCaption}>
                <span className={styles.liveSquare} />
                {current.caption}
              </p>
            </div>
          </div>
        </section>

        <section id="how-it-works" className={styles.process}>
          <div className={styles.processHeading} data-reveal>
            <p className={styles.eyebrow}>LESS BETWEEN YOU AND THE WORK</p>
            <h2>
              Big ideas.
              <br />
              <span>Small distance.</span>
            </h2>
            <div className={styles.processSymbol}>
              <RiftLogo size={190} />
            </div>
          </div>
          <div className={styles.steps}>
            <article data-reveal>
              <span className={styles.stepNumber}>
                01 <ArrowRight />
              </span>
              <h3>Give it direction.</h3>
              <p>
                Start with what you want to do. Bring a brief, a repository or a
                question worth exploring.
              </p>
            </article>
            <article data-reveal>
              <span className={styles.stepNumber}>
                02 <ArrowRight />
              </span>
              <h3>Work through it.</h3>
              <p>
                Your agent uses the tools the task needs. Follow the work, shape
                the plan and keep moving.
              </p>
            </article>
            <article data-reveal>
              <span className={styles.stepNumber}>
                03 <ArrowUpRight />
              </span>
              <h3>Make it yours.</h3>
              <p>
                Review the code. Refine the image. Understand the finding. Take
                the next step with the result in hand.
              </p>
            </article>
          </div>
        </section>

        <section className={styles.choice}>
          <div data-reveal>
            <p className={styles.eyebrow}>YOUR WAY OF THINKING</p>
            <h2>
              Many minds.
              <br />
              One place.
            </h2>
          </div>
          <div className={styles.choiceRight} data-reveal>
            <p>
              Choose the model that fits the work.
              <br />
              Keep the workspace that fits you.
            </p>
            <div className={styles.modelList}>
              <span>
                <Image
                  src="/brands/providers/openai.svg"
                  width="24"
                  height="24"
                  alt=""
                />
                OpenAI
              </span>
              <span>
                <Image
                  src="/brands/providers/anthropic.svg"
                  width="24"
                  height="24"
                  alt=""
                />
                Anthropic
              </span>
              <span>
                <Image
                  src="/brands/providers/gemini.svg"
                  width="24"
                  height="24"
                  alt=""
                />
                Google
              </span>
            </div>
            <a href="/pricing" className={styles.textLink}>
              Find your plan <ArrowUpRight size={18} />
            </a>
            <small>Model availability varies by workspace and plan.</small>
          </div>
        </section>

        <section className={styles.faq}>
          <div data-reveal>
            <p className={styles.eyebrow}>A FEW THINGS, EXPLAINED</p>
            <h2>
              Before you
              <br />
              make your move.
            </h2>
          </div>
          <div className={styles.questions}>
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <Plus size={20} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className={styles.closing}>
          <div className={styles.closingTop}>
            <p className={styles.eyebrow}>YOU HAVE THE IDEA.</p>
            <span>
              Take it further. <ArrowDown size={15} />
            </span>
          </div>
          <div className={styles.closingMain} data-reveal>
            <h2>
              Let’s get
              <br />
              to work.
            </h2>
            <a
              href="/download"
              className={styles.bigCta}
              aria-label="Download RIFT"
            >
              <ArrowUpRight strokeWidth={1.1} />
            </a>
          </div>
          <div className={styles.closingBottom}>
            <a href="/download">
              <Download size={17} /> Get RIFT for desktop
            </a>
            <a href="/signup">
              Start in your browser <ArrowUpRight size={17} />
            </a>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <a href="/landing" className={styles.brand}>
          <RiftLogo size={29} />
          <span>Rift</span>
        </a>
        <p>Ideas deserve to go somewhere.</p>
        <div>
          <a href="/privacy-policy">Privacy</a>
          <a href="/terms-of-service">Terms</a>
          <span>© {new Date().getFullYear()} RIFT</span>
        </div>
      </footer>
    </div>
  );
}
