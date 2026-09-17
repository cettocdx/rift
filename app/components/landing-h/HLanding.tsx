import { HClose } from "./HClose";
import { HCode } from "./HCode";
import { HFooter } from "./HFooter";
import { HHero } from "./HHero";
import { HMission } from "./HMission";
import { HNav } from "./HNav";
import { HProducts } from "./HProducts";
import { HReceipt } from "./HReceipt";
import { HSpecs } from "./HSpecs";
import { HTicker } from "./HTicker";
import { H_TOKENS } from "./h-system";

/**
 * The Hermeus-register landing, built from scratch and separate from every
 * other landing in this repo. Bright industrial where /landing/x is near-black:
 * a light grey ground, square controls, restrained Geist display type, uppercase
 * labels, an ink-only accent, and a real 4K machine film — a levitating
 * plasma-core compute unit turning on a studio ground, not a web app.
 *
 * The spine: the machine (hero), the thesis (mission), the workstation itself
 * as three gradient cards and its live product spread across a bento
 * (products), the dark gradient proof (code), the transcribed bill and its live
 * artifact (receipt), the spec sheet, and a pixel-mark close on a dark
 * gradient.
 */
export function HLanding() {
  return (
    <div
      style={H_TOKENS}
      className="min-h-full bg-[var(--h-ground)] text-[var(--h-ink)] antialiased"
    >
      <HTicker />
      <HNav />
      <main>
        <HHero />
        <HMission />
        <HProducts />
        <HCode />
        <HReceipt />
        <HSpecs />
        <HClose />
      </main>
      <HFooter />
    </div>
  );
}
