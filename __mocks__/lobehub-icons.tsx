import type { ComponentType } from "react";

/**
 * The vendor logo set, stubbed.
 *
 * @lobehub/icons ships ESM only, and under pnpm it resolves through
 * `.pnpm/@lobehub+icons@…/node_modules/@lobehub/icons`, which the
 * transformIgnorePatterns allowlist cannot address without matching pnpm's
 * internal layout. It arrived in the test graph when the signed-out home page
 * moved to the landing-v2 tree, so any render of `app/(chat)/page` loads it.
 *
 * Nothing under test asserts on the artwork — the vendor row is checked by
 * name — so a labelled placeholder is a truthful stand-in and keeps the real
 * package out of the transform path entirely.
 *
 * ── Why each export carries a `.Color` ──
 *
 * The real package hangs variants off the base mark: `Google.Color` is the
 * brand-coloured version, and the landing's renderer row uses it wherever a
 * vendor ships one. This mock exported bare components, so `Google.Color` was
 * `undefined` and every suite that touched the landing tree failed at module
 * scope with "Cannot read properties of undefined" — before a single test ran,
 * which is why it read as a broken import rather than a broken mock.
 *
 * The stand-in gives every vendor the same variants the real package hangs off
 * a mark, so a component may reach for one without the mock deciding which
 * vendors shipped colour artwork. That is the package's fact to state, not the
 * test double's, and a mock that mirrors only today's subset breaks again the
 * next time a component picks a different vendor's colour mark.
 */
type Mark = ComponentType<{ size?: number; className?: string }> & {
  Color: ComponentType<{ size?: number; className?: string }>;
  Avatar: ComponentType<{ size?: number; className?: string }>;
  Text: ComponentType<{ size?: number; className?: string }>;
};

const svg = (name: string) => {
  const Logo = ({
    size = 24,
    className,
  }: {
    size?: number;
    className?: string;
  }) => (
    <svg
      width={size}
      height={size}
      role="img"
      aria-label={name}
      className={className}
    />
  );
  Logo.displayName = `${name}Logo`;
  return Logo;
};

const logo = (name: string): Mark => {
  const Logo = svg(name) as Mark;
  Logo.Color = svg(`${name} colour`);
  Logo.Avatar = svg(`${name} avatar`);
  Logo.Text = svg(`${name} wordmark`);
  return Logo;
};

export const Alibaba = logo("Alibaba");
export const Claude = logo("Claude");
export const Hunyuan = logo("Hunyuan");
export const Anthropic = logo("Anthropic");
export const ByteDance = logo("ByteDance");
export const Flux = logo("Flux");
export const Google = logo("Google");
export const Gemini = logo("Gemini");
export const Grok = logo("Grok");
export const Hailuo = logo("Hailuo");
export const Kimi = logo("Kimi");
export const Kling = logo("Kling");
export const Minimax = logo("Minimax");
export const Moonshot = logo("Moonshot");
export const OpenAI = logo("OpenAI");
export const Qwen = logo("Qwen");
export const Runway = logo("Runway");
export const Sora = logo("Sora");
export const XAI = logo("XAI");
export const ZAI = logo("ZAI");
