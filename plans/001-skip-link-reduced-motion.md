# 001 — Skip link honours reduced motion

**Severity:** HIGH · **Category:** Accessibility · **Status:** DONE

## Finding

`app/components/landing-v2/MarketingPage.tsx:48` — the skip link animates with
`transition-transform` and no reduced-motion guard and no explicit duration.

It is the first focusable element on all six public pages (sign-in, pricing,
download, privacy, terms, refunds), so it is the first motion a keyboard user
meets. Everything else in `landing-v2` carries either `motion-reduce:` or a
`useReducedMotion()` branch; this is the only uncovered animation in the layer.

## Fix

Add the house guard and an explicit duration using the existing token:

```
transition-transform duration-150 motion-reduce:transition-none
```

`--duration-*` tokens already exist in `app/globals.css`; 150ms sits inside the
"UI under 300ms" rule and matches the other focus-state transitions in the file.

Do not remove the slide. It shows a keyboard user where focus went, which is the
whole point of a skip link; the defect is only that it cannot be turned off.

## Verification

- Tab into any of the six pages. The link slides down from above.
- Set System Settings → Accessibility → Display → Reduce motion. Tab again: the
  link appears in place with no travel, still visible and still focusable.
