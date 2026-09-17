# GitHub repository sidebar

Update, 13 September: the configuration-presence check below did not prove a valid OAuth app. Live testing found GitHub returned 404 for the configured client. See [the connection repair and current verification bounds](../performance/2026-09-13-github-repository-workflow.md).

The chat sidebar now has a GitHub connection, a paginated repository list,
filtering of loaded repositories, refresh and recoverable listing errors.
Opening a repository verifies current GitHub access server-side and atomically
creates/reuses an owned Build project by GitHub repository ID. Existing project
conversation history is reused. Clicking does not submit a task.

Repository metadata is loaded through the owned project boundary into native
and long-running agent context. The agent inspects/reuses or clones the selected
repository when work starts, preserving uncommitted changes. Cloud uses RIFT's
existing GitHub credential injection; local execution uses local git credentials.
Tokens never enter the sidebar DTO or prompt. API calls use a fixed GitHub host,
reject redirects and sanitize upstream failures. OAuth configuration is present
in the active preview environment; user consent is still required to connect.

Verification: 60 backend/runtime tests, 32 sidebar/navigation tests and 12 real
component browser fixtures passed. Browser coverage includes desktop and 360px
Chromium/WebKit, light/dark, keyboard activation, overflow, filtering, duplicate
page rows, initial failure and page-two retry. Fixtures use simulated API/auth
boundaries; they do not prove a live private-repo clone or OAuth consent roundtrip.

API reference: https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user
