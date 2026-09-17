# Rift effort selector

The requested direction is a smooth, distinctive gradient control with a stronger power-up state at Extra High. The existing model-aware effort selection remains the source of truth.

- Compact gradient-edged trigger and a 304 px aurora popover, with the canonical Rift mark.
- Teal, blue and violet energy track. Extra High and Max introduce a warm peach highlight, a lit thumb, gradient label and a one-time 280 ms light sweep.
- Native range input preserves keyboard, pointer and touch interaction; supported levels, endpoint values and model-default reset are unchanged.
- No repeating animation. Pointer dragging is immediate; keyboard and reduced-motion modes suppress decorative movement. Keyboard focus is drawn around the thumb.
- Effects are clipped to their own layer so they cannot create overflow or scroll the popover during keyboard navigation.

Validation: eight existing effort/model-selection tests passed; ESLint and TypeScript passed. Live Chrome checks covered light/dark, direct pointer selection, Arrow keys, Home/End and zero popover scroll overflow at Extra High. QA restored the original Low effort and light theme; no agent request was sent.
