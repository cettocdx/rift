import { RiftLogo } from "./rift-logo";

/** Compatibility export for older entry screens. */
export function RIFTSVG({
  theme,
  scale = 1,
}: {
  theme: "dark" | "light";
  scale?: number;
}) {
  return (
    <RiftLogo size={189 * scale} color={theme === "dark" ? "#fff" : "#000"} />
  );
}
