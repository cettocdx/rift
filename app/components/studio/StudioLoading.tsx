import styles from "./StudioDiscovery.module.css";

/** Same layout at route, purpose-preparation, and lazy-chat boundaries. */
export function StudioLoading() {
  return (
    <div
      data-rift-empty-stage
      data-testid="studio-loading"
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground"
      role="status"
      aria-label="Opening Studio"
      aria-busy="true"
    >
      <div
        aria-hidden="true"
        className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-start px-4 pb-10 pt-7 sm:px-6"
      >
        <div
          data-rift-empty-content
          className="rift-studio-start flex w-full max-w-full flex-col items-center sm:max-w-[1080px]"
        >
          <div className="w-full text-center">
            <div className="pro-empty-hero">
              <div className={`${styles.caption} mb-2`}>
                <div className={`${styles.skeleton} mx-auto h-[1.5em] w-20`} />
              </div>
              <div className={styles.title}>
                <div
                  className={`${styles.skeleton} mx-auto h-[1.35em] w-[min(320px,80%)]`}
                />
              </div>
              <div className={`${styles.body} mt-2`}>
                <div
                  className={`${styles.skeleton} mx-auto h-[1.5em] w-[min(370px,90%)]`}
                />
              </div>
            </div>
          </div>
          <div className="hidden w-full md:block">
            <div
              data-ui="composer-region"
              data-centered="true"
              className="relative min-w-0 px-3 sm:px-4"
            >
              <div
                data-ui="composer-column"
                className="mx-auto w-full min-w-0 max-w-[640px]"
              >
                <div
                  data-ui="composer-shell"
                  className="rift-composer min-h-[106px] rounded-2xl border border-border-strong bg-background p-4"
                >
                  <div className={`${styles.skeleton} h-3 w-2/5`} />
                  <div className="mt-9 flex items-center justify-between">
                    <div className={`${styles.skeleton} h-5 w-12`} />
                    <div className={`${styles.skeleton} h-5 w-28`} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="rift-studio-discovery w-full">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className={styles.title}>
                  <div className={`${styles.skeleton} h-[1.35em] w-52`} />
                </div>
                <div className={`${styles.label} mt-1`}>
                  <div
                    className={`${styles.skeleton} h-[1.5em] w-60 max-w-full`}
                  />
                </div>
              </div>
              <div
                className={`${styles.label} flex gap-1 rounded-lg bg-muted/70 p-0.5`}
              >
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    className={`${styles.skeleton} h-[calc(1.5em+12px)] w-16`}
                  />
                ))}
              </div>
            </div>
            <div
              data-ui="studio-discovery-grid"
              className={`${styles.stageGrid} overflow-hidden rounded-2xl border bg-background`}
            >
              <div className={`${styles.referenceStage} bg-muted/40`} />
              <div className="flex min-w-0 flex-col border-t p-5 md:border-l md:border-t-0">
                <div className="mb-4 flex items-center gap-2.5">
                  <div className={`${styles.skeleton} size-9 shrink-0`} />
                  <div className="min-w-0 flex-1">
                    <div className={styles.caption}>
                      <div
                        className={`${styles.skeleton} h-[1.5em] w-24 max-w-full`}
                      />
                    </div>
                    <div className={`${styles.body} mt-0.5`}>
                      <div
                        className={`${styles.skeleton} h-[1.5em] w-32 max-w-full`}
                      />
                    </div>
                  </div>
                </div>
                <div className={styles.label}>
                  <div className={`${styles.skeleton} h-[3em] w-full`} />
                </div>
                <div className="my-4 divide-y border-y">
                  {[0, 1, 2, 3, 4].map((index) => (
                    <div
                      key={index}
                      className={`${styles.label} flex justify-between gap-3 py-2.5`}
                    >
                      <div className={`${styles.skeleton} h-[1.5em] w-16`} />
                      <div className={`${styles.skeleton} h-[1.5em] w-20`} />
                    </div>
                  ))}
                </div>
                <div className={styles.caption}>
                  <div className={`${styles.skeleton} h-[1.5em] w-28`} />
                </div>
                <div className={`${styles.skeleton} mt-4 min-h-9 w-full`} />
              </div>
            </div>
            <div className="mb-8 mt-4 flex gap-2 overflow-hidden pb-2">
              {[0, 1, 2, 3, 4].map((index) => (
                <div
                  key={index}
                  className={`${styles.modelCard} flex shrink-0 items-center gap-2.5 rounded-xl border p-2`}
                >
                  <div className={`${styles.skeleton} size-11 shrink-0`} />
                  <div className={`${styles.skeleton} h-3 w-full`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
