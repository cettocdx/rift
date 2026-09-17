"use client";

import Image from "next/image";
import { useRef, useState, type KeyboardEvent } from "react";

import { F1Reveal } from "./F1Reveal";
import { STUDIO_OUTPUTS } from "./f1-content";
import {
  F1_BODY_CLASS,
  F1_CONTAINER_CLASS,
  F1_LABEL_CLASS,
  F1_SECTION_CLASS,
  F1_SECTION_TITLE_CLASS,
} from "./f1-design";

const MAIN_MEDIA_SIZES =
  "(max-width: 639px) calc(100vw - 40px), (max-width: 1023px) calc(100vw - 64px), (max-width: 1239px) calc(100vw - 440px), 800px";

function tabId(id: string) {
  return `studio-tab-${id}`;
}

function panelId(id: string) {
  return `studio-panel-${id}`;
}

export function F1StudioShowcase() {
  const [selectedId, setSelectedId] = useState(STUDIO_OUTPUTS[0].id);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected =
    STUDIO_OUTPUTS.find((item) => item.id === selectedId) ?? STUDIO_OUTPUTS[0];

  const selectAndFocus = (index: number) => {
    setSelectedId(STUDIO_OUTPUTS[index].id);
    tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | undefined;

    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + STUDIO_OUTPUTS.length) % STUDIO_OUTPUTS.length;
        break;
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % STUDIO_OUTPUTS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = STUDIO_OUTPUTS.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    selectAndFocus(nextIndex);
  };

  return (
    <section
      id="studio"
      aria-labelledby="studio-title"
      className={`scroll-mt-20 border-y border-border bg-[var(--surface)] ${F1_SECTION_CLASS}`}
    >
      <div className={F1_CONTAINER_CLASS}>
        <F1Reveal>
          <div className="grid gap-5 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <p className={F1_LABEL_CLASS}>Studio</p>
              <h2
                id="studio-title"
                className={`mt-4 max-w-[15ch] ${F1_SECTION_TITLE_CLASS}`}
              >
                The right model, inside the same workflow.
              </h2>
            </div>
            <p className={`${F1_BODY_CLASS} max-w-[55ch] lg:col-span-5`}>
              Compare visual references by the work they represent, then keep
              the selected model attached to the project.
            </p>
          </div>
        </F1Reveal>

        <F1Reveal className="mt-10">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div
              role="tablist"
              aria-label="Studio outputs"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-start-2 lg:row-start-1 lg:grid-cols-1"
            >
              {STUDIO_OUTPUTS.map((item, index) => {
                const active = item.id === selected.id;

                return (
                  <button
                    key={item.id}
                    ref={(node) => {
                      tabRefs.current[index] = node;
                    }}
                    id={tabId(item.id)}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls={panelId(item.id)}
                    tabIndex={active ? 0 : -1}
                    onClick={() => selectAndFocus(index)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                    className="group min-h-11 overflow-hidden rounded-[12px] border border-border bg-background text-left transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[var(--border-strong)] active:scale-[0.98] motion-reduce:active:scale-100 motion-reduce:transition-none focus-visible:outline-none aria-selected:border-[var(--primary)] aria-selected:bg-[#151210]"
                  >
                    <span className="grid min-h-[72px] grid-cols-[72px_minmax(0,1fr)] items-center gap-3 p-2.5">
                      <span className="aspect-video w-[72px] overflow-hidden rounded-[8px] border border-white/10 bg-black">
                        <Image
                          src={item.imageSrc}
                          alt=""
                          width={3840}
                          height={2160}
                          sizes="72px"
                          className="size-full object-cover"
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {item.label}
                        </span>
                        <span className="mt-1 block truncate font-mono text-[10px] uppercase tracking-[0.06em] text-foreground/50">
                          {item.modality} / {item.model}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="min-w-0 lg:col-start-1 lg:row-start-1">
              {STUDIO_OUTPUTS.map((item) => {
                const active = item.id === selected.id;
                const videoSrc =
                  item.modality === "Video" ? item.videoSrc : undefined;

                return (
                  <div
                    key={item.id}
                    id={panelId(item.id)}
                    role="tabpanel"
                    aria-labelledby={tabId(item.id)}
                    hidden={!active}
                    tabIndex={active && !videoSrc ? 0 : undefined}
                    className="overflow-hidden rounded-[16px] border border-border bg-background"
                  >
                    {active ? (
                      <>
                        <div className="aspect-video overflow-hidden bg-black">
                          {videoSrc ? (
                            <video
                              controls
                              muted
                              playsInline
                              preload="metadata"
                              poster={item.imageSrc}
                              aria-label={item.imageAlt}
                              className="size-full object-cover"
                            >
                              <source src={videoSrc} type="video/mp4" />
                            </video>
                          ) : (
                            <Image
                              src={item.imageSrc}
                              alt={item.imageAlt}
                              width={3840}
                              height={2160}
                              sizes={MAIN_MEDIA_SIZES}
                              className="size-full object-cover"
                            />
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-5 py-4">
                          <span className={F1_LABEL_CLASS}>
                            {item.modality}
                          </span>
                          <span className="text-[14px] font-medium">
                            {item.label}
                          </span>
                          <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.08em] text-foreground/50">
                            Reference media · {item.model}
                          </span>
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </F1Reveal>
      </div>
    </section>
  );
}
