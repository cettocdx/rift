# E2E Testing Setup

This directory contains end-to-end tests for RIFT using Playwright.

## Test Suites

### Authentication Tests

The authentication e2e tests cover all major authentication flows including login, logout, session management, and account settings.

### Chat Functionality Tests

The chat e2e tests cover core chat features, file attachments, Agent mode operations, and tier-based restrictions.

### Test Structure

```
e2e/
├── chat-free.spec.ts               # Free tier simple chat tests
├── chat-files-pro.spec.ts         # File attachments (Pro/Ultra)
├── chat-agent.spec.ts             # Agent mode operations (all tiers, cloud sandbox Pro/Ultra)
├── constants.ts                   # Centralized timeouts and test data
├── page-objects/
│   ├── BasePage.ts                # Base page object class
│   ├── ChatComponent.ts           # Chat UI interactions
│   ├── ChatPage.ts                # Chat page wrapper
│   ├── ChatModeSelector.ts        # Ask/Agent mode switcher
│   ├── FileAttachment.ts          # File upload handling
│   ├── HomePage.ts                # Home page interactions
│   ├── SidebarComponent.ts        # Sidebar interactions and chat history
│   ├── SettingsDialog.ts          # Settings dialog interactions
│   ├── UpgradeDialog.ts            # Upgrade prompts
│   ├── UserMenuComponent.ts       # User menu interactions
│   └── index.ts                   # Page object exports
├── resource/
│   ├── image.png                  # Test image (duck/mallard)
│   ├── secret.txt                 # Test file with "bazinga"
│   └── secret.pdf                 # Test PDF with "hippo"
├── fixtures/
│   └── auth.ts                    # Auth helpers and session caching
├── helpers/
│   ├── mock-handlers.ts           # Mock handlers for API calls
│   └── test-helpers.ts            # Common test helper functions
└── setup/
    └── auth.setup.ts              # Authentication setup for test users
```

### Test Coverage

#### Chat Functionality Tests

**Free Tier Simple Chat:**

- Handle multiple messages in conversation
- Verify chat title is automatically generated
- Verify chat appears in sidebar with title
- Compare sidebar title with header title
- Verify title consistency across UI

**Basic Chat (All Tiers):**

- Send message and receive AI response
- Show streaming indicator during response
- Display messages in chat history
- Stop generation mid-response

**File Attachments (Pro/Ultra):**

- Attach text file and verify AI reads content (secret.txt → "bazinga")
- Attach image and verify AI recognizes content (image.png → "duck")
- Attach PDF and verify AI reads content (secret.pdf → "hippo")
- Attach multiple files at once
- Remove attached files
- Send message with file attachment

**Agent Mode:**

- Switch between Ask and Agent modes
- Generate markdown description from image
- Resize image to 100x100px
- Perform file operations (read/write)
- Handle multiple operations in sequence
- Free users: local sandbox only, auto model enforced
- Paid users: cloud sandbox + custom model selection

**Free Tier Restrictions:**

- Show upgrade popover when attempting file attachment
- Show connect dialog when switching to Agent mode without local sandbox
- Cloud sandbox gated behind Pro badge
- Allow text-only messages in Ask mode

**Chat Title Management:**

- Auto-generate titles from first user message
- Display titles in sidebar chat history
- Display titles in chat header
- Verify title consistency between sidebar and header

#### Authentication Tests

**Login Flow**

- Display sign in/sign up buttons when not authenticated
- Successfully sign in with valid credentials (free, pro, ultra tiers)
- Redirect to login when accessing protected routes

#### Logout Flow

- Log out from user menu
- Log out from settings security tab

#### Session Management

- Session persistence after page refresh
- Session caching for faster re-authentication

#### Settings Dialog

- Open settings dialog from user menu
- Navigate between settings tabs (Personalization, Security, Data Controls, Agents, Account)

#### Security Tab

- Display MFA toggle
- Display logout all devices button

#### Account Tab

- Display delete account button
- Open delete account dialog
- Show delete account confirmation inputs

#### UI State Tests

- Show subscription badge for each tier
- Show upgrade button for free tier users

### Authentication setup

RIFT uses Convex Auth. Follow [authenticated setup](setup/README.md) for existing,
email-verified test accounts, exact deployment/origin configuration, and private
storage state. There are no default credentials or automatic account-provisioning
scripts in this checkout.

```sh
pnpm test:e2e:setup
```

This command signs in the three configured test accounts through the real UI and
verifies identity and live subscription tier. It does not create accounts or
change billing. Discovery alone is not evidence of passing acceptance tests.

For mobile navigation and layout without submitting model requests, use the
[separate mobile acceptance suite](mobile-acceptance/README.md). The legacy suites
below include real model requests and account/chat mutations; their fixtures and
coverage need live validation before being used as a release gate.

### Running Tests

Run all e2e tests:

```bash
pnpm test:e2e
```

Run with UI mode (recommended for development):

```bash
pnpm test:e2e:ui
```

Run in headed mode (see browser):

```bash
pnpm test:e2e:headed
```

Run in debug mode:

```bash
pnpm test:e2e:debug
```

Run specific browser:

```bash
pnpm test:e2e:chromium
pnpm test:e2e:firefox
pnpm test:e2e:webkit
```

Run mobile tests:

```bash
pnpm test:e2e:mobile
```

Run specific test suite:

```bash
pnpm test:e2e e2e/chat-free.spec.ts
pnpm test:e2e e2e/chat-files-pro.spec.ts
pnpm test:e2e e2e/chat-agent.spec.ts
```

### Test Constants

All timeout values and test data are centralized in `e2e/constants.ts`:

**Timeout Constants:**

- `TIMEOUTS.SHORT` (15000ms) - UI element visibility, quick checks
- `TIMEOUTS.MEDIUM` (30000ms) - Message rendering, file uploads
- `TIMEOUTS.LONG` (60000ms) - AI response streaming
- `TIMEOUTS.AGENT` (90000ms) - Agent mode operations
- `TIMEOUTS.AGENT_LONG` (120000ms) - Complex agent operations (image processing)
- `TIMEOUTS.STOP_BUTTON_CHECK` (5000ms) - Quick check if streaming is active

**Test Data:**

- `TEST_DATA.RESOURCES` - Paths to test files (image, text, PDF)
- `TEST_DATA.SECRETS` - Expected content in test files
- `TEST_DATA.MESSAGES` - Common test messages

Always use these constants instead of magic numbers for timeouts.

### Session reuse

Setup restores complete cookies and origin storage in an isolated browser context.
It verifies the real Convex identity and live tier before accepting cached state.
Invalid state receives one clean login attempt; no time-based cache or cookie-only
success check is used. See [setup details](setup/README.md).

### Adding Test IDs

All authentication-related components have `data-testid` attributes:

**Header:**

- `sign-in-button` - Desktop sign in button
- `sign-up-button` - Desktop sign up button
- `sign-in-button-mobile` - Mobile sign in button
- `sign-up-button-mobile` - Mobile sign up button

**SidebarUserNav:**

- `user-menu-button` - User menu trigger (expanded)
- `user-menu-button-collapsed` - User menu trigger (collapsed)
- `user-avatar` - User avatar
- `user-email` - User email display
- `subscription-badge` - Subscription tier badge
- `settings-button` - Settings menu item
- `logout-button` - Logout menu item
- `upgrade-button-collapsed` - Upgrade button (collapsed sidebar)
- `upgrade-menu-item` - Upgrade menu item

**SettingsDialog:**

- `settings-dialog` - Settings dialog container
- `settings-tab-personalization` - Personalization tab
- `settings-tab-security` - Security tab
- `settings-tab-data-controls` - Data controls tab
- `settings-tab-agents` - Agents tab
- `settings-tab-account` - Account tab
- `settings-tab-team` - Team tab (team tier only)

**SecurityTab:**

- `mfa-toggle` - MFA enable/disable toggle
- `logout-button-device` - Log out this device button
- `logout-button-all` - Log out all devices button

**AccountTab:**

- `delete-account-button` - Delete account button

**DeleteAccountDialog:**

- `delete-account-dialog` - Delete account dialog
- `email-confirmation` - Email confirmation input
- `delete-phrase-input` - "DELETE" confirmation input
- `delete-button` - Final delete button

**Chat Components:**

- `chat-input` - Chat message input
- `send-button` - Send message button
- `message` - Message container
- `assistant-message` - AI assistant message
- `message-content` - Message text content
- `streaming` - Streaming indicator
- `attached-file` - Attached file preview (non-images)
- `messages-container` - Container for all messages

**Chat Modes:**

- Ask/Agent mode dropdown with role="button"
- Cloud sandbox option displays "Pro" badge for free users

**Sidebar:**

- `sidebar-toggle` - Toggle button to expand/collapse sidebar
- `subscription-badge` - Subscription tier badge
- Chat items use `aria-label="Open chat: {title}"` format

### Page Objects

The test suite uses a Page Object Model pattern for maintainability:

**ChatComponent** - Main chat interactions:

- `sendMessage()` - Send a message
- `waitForResponse()` - Wait for AI response
- `getChatHeaderTitle()` - Get title from chat header
- `getMessageCount()` - Get number of messages
- `expectStreamingVisible()` - Verify streaming indicator
- `switchToAgentMode()` / `switchToAskMode()` - Change chat mode

**SidebarComponent** - Sidebar and chat history:

- `expandIfCollapsed()` - Expand sidebar if needed
- `getAllChatItems()` - Get all chat items in sidebar
- `getChatCount()` - Get count of chats
- `findChatByTitle()` - Find chat by title
- `expectChatWithTitle()` - Verify chat appears with title

**FileAttachment** - File upload handling:

- `attachFile()` - Attach a single file
- `attachFiles()` - Attach multiple files
- `waitForUploadComplete()` - Wait for upload to finish

**Test Helpers** (`helpers/test-helpers.ts`):

- `setupChat()` - Common setup for chat tests
- `sendAndWaitForResponse()` - Send message and wait for response
- `attachTestFile()` - Attach test file by type (image/text/pdf)
- `sendMessageWithFileAndVerifyContent()` - Send message with file and verify AI reads it

### Best Practices

1. **Use test IDs for selectors**: Always prefer `getByTestId()` over CSS selectors
2. **Use constants for timeouts**: Never use magic numbers, always use `TIMEOUTS.*` constants
3. **Wait for elements**: Use Playwright's auto-waiting, don't add arbitrary timeouts
4. **Use page objects**: Encapsulate UI interactions in page object classes
5. **Use test helpers**: Reuse common test patterns via helper functions
6. **Clean up**: Use isolated browser contexts; keep private storage state out of version control
7. **Handle rate limits**: Use session caching, don't bypass it unless testing login flow specifically
8. **Test real flows**: Authenticated acceptance uses the real Convex session; synthetic harness checks are reported separately
9. **Verify state**: Always verify both visual state (UI) and logical state (URLs, cookies)
10. **Compare titles**: When testing chat titles, compare sidebar and header titles for consistency

### Troubleshooting

**"Authentication failed" errors:**

- Check existing Convex Auth accounts and deployment configuration using [setup instructions](setup/README.md)
- Verify `.env.e2e` has correct credentials
- Check the actual Convex Auth error and account verification state; do not bypass authentication

**"Element not found" errors:**

- Verify test IDs are correct and in the code
- Check if element is in viewport (may need to scroll)
- Ensure page has loaded (wait for navigation)

**Session not persisting:**

- Clear browser cache/cookies between tests
- Verify cookies are being set (check devtools)
- Check cookie domain and path settings

**Tests timing out:**

- Increase timeout in `playwright.config.ts`
- Check network conditions
- Verify the configured Convex deployment is reachable
