# Mobile navigation and reduced visible viewport

The existing chat shell matrix passed 52 cases (four desktop-only exclusions) but never opened navigation while the visual viewport was reduced. The added check reproduced a production layout defect in WebKit: with visible top 40px and height 400px, the navigation drawer still spanned approximately 0–844px. Its fixed outer scrim and explicit 100dvh height ignored the shell's reported visual bounds.

The drawer now positions inside the relative ProChatLayout shell and fills that shell's height. ChatViewport continues to own measured visual viewport height and offset; no keyboard height is guessed. Safe-area padding and existing focus/body-lock lifecycle are retained.

The expanded visual-viewport scenario passes eight Chromium/WebKit projects, including 360/390/430px coarse-pointer layouts and desktop exclusions of mobile behavior. It checks the drawer bounds at 40–440px, empty-frame focus, removal at 900px, reappearance on returning to mobile, Escape dismissal, body overflow restoration, draft preservation, and Send reachability through the existing bounded composer scroller. Widening resets the available scroll geometry; the test waits for the restored 400px shell and reveals Send through its actual user-scrollable surface rather than assuming its old position remains visible.

Eighteen ProChatLayout unit tests pass. The browser fixture imports the real shell, viewport observer, question and composer controls, but Sidebar service contents remain isolated. These results do not establish real navigation-item/footer coverage, authenticated route acceptance, physical keyboard behavior or native-device parity. The available browser connector reported User unavailable; no authenticated storage-state export was available, and that coverage remains outstanding.

## Follow-up: real sidebar and agent editor

The next fixture revision renders production Sidebar, SidebarHeader, GitHub navigation and UserNav instead of a placeholder. Authentication, database and router boundaries remain offline fixtures. This exposed two additional defects in a 400px visible viewport: expanding More pushed the account footer outside the available area, and the mobile close control exceeded its 30px header row. Mobile header/navigation/history now share one scroller above the fixed account footer, and the header row accommodates the 44px control. Desktop scrolling retains its previous layout.

The real-sidebar matrix passed 52 Chromium/WebKit cases with four desktop exclusions. Coverage includes navigation dispatch and dismissal, GitHub repository entry, Google-shaped avatar failure fallback, keyboard opener focus restoration, viewport changes, draft preservation and reachable Send. Four focused unit suites passed 77 tests. These checks do not prove live Google or GitHub authentication.

The actual AgentProfileDialog also exceeded a reduced visible viewport. Its fixture previously replaced that dialog with null; that replacement was removed before reproducing the failure. The dialog now follows the measured visual viewport from its first portal mount, keeps its footer visible and uses a compact native section selector on mobile. Step announcements remain in the accessibility tree. Omitted Input types now explicitly use text, allowing the existing mobile 16px input rule to apply and avoid small text/focus zoom. Desktop density is unchanged.

Review additionally displayed a duplicate @ in the mention and internal model IDs. It now shows the saved mention exactly and the model's display name (or Workspace default). The existing save-flow unit test reproduced the incorrect mention before the fix.

Twenty agent-profile browser cases passed across Chromium/WebKit 360/390/430px and desktop, with eight non-mobile exclusions of the reduced-viewport test. Two targeted unit suites passed 14 tests. A follow-up run of Runs, Tasks, Agents and Appearance in both themes, plus the profile cases, passed 38 checks with two desktop exclusions. The reduced viewport is simulated, not a physical phone keyboard; authenticated routing and native-device acceptance remain outstanding.
