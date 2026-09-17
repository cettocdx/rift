# Image viewer download identity

The expanded image viewer retained a raw URL snapshot independently of the file
receipt. A persisted image could therefore download an expired signed URL
instead of obtaining fresh authorization. If the receipt changed while the
viewer was open, the old image could remain visible with the new filename.

FilePartRenderer now tags viewer selection with its receipt identity. A replaced
or removed image is hidden synchronously; selection is then cleared so returning
to the earlier receipt does not reopen it. Matching viewers follow canonical URL
refreshes. The viewer delegates download to FilePartRenderer's existing durable
resolution and per-receipt download lock. Authorization rejection does not fall
back to the old address. A download already requested by the user can still
complete with its original filename after navigation.

Standalone URL-only ImageViewer callers retain their previous direct-download
behavior. This change does not infer a durable ID from arbitrary URLs or solve
the separate fileId-only cache freshness policy on later remounts.

## Validation

Eight integrated tests failed before the change. Final focused coverage passed
35 tests in six suites, including ten new cases using the real viewer and portal.
The cases cover fresh authorization, denial without fallback, replacement,
removal, return without reopening, canonical refresh, duplicate clicks, and
completion after navigation. Convex actions and download utility are mocked;
these cases do not prove real provider expiry or native disk writes.

Independent review found no actionable regression. Scoped lint passed. Browser download coverage passed eight Chromium/WebKit desktop/mobile cases.
It resolves a new URL after the viewer opens, compares actual downloaded bytes,
rejects authorization without fetching the old URL, retries an HTTP 403, and
preserves the draft and opener focus. The fixture explicitly permits only its
known image-resolution action; other backend calls remain rejected.
A fresh root run also passed 53 tests across three relevant component suites.
Whole release-gate and installed-native outcomes are recorded separately in the
external progress report after running them.

## Native picker observation

The installed app's file picker displayed a valid 299,647-byte test PNG but its
Open button remained disabled, including keyboard selection and list view. The
cancel action returned to the empty composer without an attachment.

ChatInput and HackerMode used `accept="*"`, which is not a valid file-type
specifier. The unfiltered fields now omit the attribute. See
[MDN accept](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/accept).
This is an HTML contract correction; the picker observation alone does not prove
that the attribute caused its disabled state. Repeat the same native selection
after updating the installed web build before assigning causality.
