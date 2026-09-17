"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type JSX } from "react";

/*
 * Nothing for the first 200ms.
 *
 * This is the `AuthLoading` fallback for the entire app and the Suspense
 * fallback for Studio and the chat routes — surfaces that usually resolve in
 * well under a frame budget's worth of network. Rendering the spinner
 * immediately meant most visits saw it flash on and off, which reads as a
 * stutter rather than as progress: the eye registers that *something*
 * happened but not what, so a fast load looks broken while a slow one looks
 * the same. Below this threshold the transition is perceived as instant, so
 * showing nothing is both more honest and calmer. Above it, the spinner
 * arrives and means what it says.
 */
const APPEAR_DELAY_MS = 200;

/*
 * Static classes, not `size-${size}`.
 *
 * The size was interpolated into the class name at runtime, which Tailwind
 * cannot see: `size-12` only existed in the stylesheet when some unrelated
 * file happened to spell it out, and the spinner silently fell back to
 * lucide's own 24px default when it did not. Spelling the three sizes out
 * makes them extractable, and the union type means a fourth one is a
 * compile error rather than an invisible no-op.
 */
const SIZE_CLASSES = {
  5: "size-5",
  6: "size-6",
  12: "size-12",
} as const;

interface LoadingProps {
  size?: keyof typeof SIZE_CLASSES;
}

export default function Loading({ size = 12 }: LoadingProps): JSX.Element {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), APPEAR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      className="flex size-full flex-col items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      {visible && (
        <LoaderCircle
          aria-hidden="true"
          className={`mt-4 ${SIZE_CLASSES[size]} animate-spin`}
        />
      )}
    </div>
  );
}
