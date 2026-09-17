"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Dedicated context for the chat composer text.
 *
 * The composer value changes on every keystroke. Keeping it inside the large
 * `GlobalState` context forced every `useGlobalState()` consumer (message list,
 * sidebars, tool handlers, etc.) to re-render on each character, which made
 * typing feel laggy.
 *
 * To fix that, the input is split into two contexts:
 *   - `InputValueContext`: the reactive string. Only components that actually
 *     display the value (the textarea and the submit button) subscribe to it.
 *   - `InputApiContext`: a stable object ({ setInput, clearInput, inputRef }).
 *     It never changes identity, so components that only need to read the value
 *     at submit time (chat.tsx, useChatHandlers) can subscribe without
 *     re-rendering on every keystroke — they read `inputRef.current` instead.
 *   - `InputHasTextContext`: the one derived fact the composer chrome actually
 *     needs — is there anything to send. It is a boolean, so React's `Object.is`
 *     check stops propagation on every keystroke that does not flip it: typing
 *     the 2nd through 200th character re-renders nothing outside the textarea.
 *     The send button used to receive the whole string as a prop from
 *     `ChatInput`, which had to subscribe to the value to pass it down — one
 *     subscription at the top of the tree that re-rendered the toolbar and its
 *     six selectors on every character, undoing most of what this split buys.
 */

interface InputApi {
  setInput: (value: string) => void;
  clearInput: () => void;
  /** Always holds the latest input value for non-reactive reads. */
  inputRef: React.MutableRefObject<string>;
}

const InputValueContext = createContext<string>("");
const InputHasTextContext = createContext<boolean>(false);
const InputApiContext = createContext<InputApi | null>(null);

export function InputProvider({ children }: { children: ReactNode }) {
  const [input, setInputState] = useState("");
  const inputRef = useRef("");

  const setInput = useCallback((value: string) => {
    inputRef.current = value;
    setInputState(value);
  }, []);

  const clearInput = useCallback(() => {
    inputRef.current = "";
    setInputState("");
  }, []);

  const api = useMemo<InputApi>(
    () => ({ setInput, clearInput, inputRef }),
    [setInput, clearInput],
  );

  const hasText = input.trim().length > 0;

  return (
    <InputApiContext.Provider value={api}>
      <InputValueContext.Provider value={input}>
        <InputHasTextContext.Provider value={hasText}>
          {children}
        </InputHasTextContext.Provider>
      </InputValueContext.Provider>
    </InputApiContext.Provider>
  );
}

/** Subscribe to the reactive composer value (re-renders on every keystroke). */
export function useInputValue(): string {
  return useContext(InputValueContext);
}

/**
 * Subscribe to whether the composer holds anything sendable. Re-renders only
 * when that flips — not on every keystroke.
 */
export function useInputHasText(): boolean {
  return useContext(InputHasTextContext);
}

/** Stable setters + ref. Does NOT re-render when the value changes. */
export function useInputApi(): InputApi {
  const ctx = useContext(InputApiContext);
  if (!ctx) {
    throw new Error("useInputApi must be used within an InputProvider");
  }
  return ctx;
}

/**
 * Convenience hook for components that need both the reactive value and the
 * setters. Subscribes to the value context, so it re-renders on each keystroke.
 */
export function useInput(): InputApi & { input: string } {
  return { input: useInputValue(), ...useInputApi() };
}
