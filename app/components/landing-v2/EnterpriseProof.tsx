import { F1Reveal } from "./F1Reveal";
import { ENTERPRISE_CONTROLS } from "./f1-content";
import {
  F1_BODY_CLASS,
  F1_CONTAINER_CLASS,
  F1_LABEL_CLASS,
  F1_SECTION_CLASS,
  F1_SECTION_TITLE_CLASS,
} from "./f1-design";

export function EnterpriseProof() {
  return (
    <section
      id="enterprise"
      aria-labelledby="enterprise-title"
      className={`scroll-mt-20 border-y border-border bg-[var(--surface)] ${F1_SECTION_CLASS}`}
    >
      <div className={F1_CONTAINER_CLASS}>
        <F1Reveal>
          <p className={F1_LABEL_CLASS}>Control</p>
          <h2
            id="enterprise-title"
            className={`mt-4 max-w-[15ch] text-balance ${F1_SECTION_TITLE_CLASS}`}
          >
            Built for work that has to hold up.
          </h2>
        </F1Reveal>

        <div className="mt-10 border-y border-border">
          {ENTERPRISE_CONTROLS.map((item, index) => (
            <F1Reveal
              key={item.title}
              delay={index * 0.05}
              className="border-b border-border last:border-b-0"
            >
              <div className="grid gap-3 py-6 md:grid-cols-[1fr_1.4fr] md:gap-10">
                <h3 className="text-[17px] font-medium tracking-[-0.01em]">
                  {item.title}
                </h3>
                <p className={F1_BODY_CLASS}>{item.body}</p>
              </div>
            </F1Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
