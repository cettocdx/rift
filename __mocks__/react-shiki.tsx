import React from "react";

// Simple mock for react-shiki
export const ShikiCode = ({ children }: { children?: React.ReactNode }) => {
  return <code data-testid="shiki-code">{children}</code>;
};

export const isInlineCode = () => false;

export default ShikiCode;

export const useShikiHighlighter = (code: string) => (
  <code data-testid="shiki-code">{code}</code>
);
