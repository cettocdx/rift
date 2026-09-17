# RIFT local runner

The `rift-cli` package connects a computer to RIFT so Build can execute commands on it.

## Connect

Requires Node.js 18 or later. Open [Settings → Workbench](https://riftsys.app/settings/workbench), choose your terminal shell, and click **Copy connect command**. This retrieves your existing private connection token; it does not rotate it. Paste the command into a terminal on the computer you want to use.

The command uses the download served by the same RIFT app and includes its Convex backend URL. The install form is:

```sh
npx --yes 'https://riftsys.app/downloads/rift-cli.tgz' --token 'YOUR_TOKEN' --convex-url 'YOUR_APP_CONVEX_URL'
```

Use the command copied from Settings for the correct backend and current download version. This repository’s package name is `rift-cli`; the old `@rift/local` npm install instructions are not supported. Keep the token private and do not paste the connection command into a chat or issue.

Once the runner registers, select it under **Local runner** in Settings or the Build execution target selector. An unavailable local target does not fall back to Cloud. Disconnect closes only the chosen connection; selecting another target is a separate action.

## Options

| Option             | Description                                                       |
| ------------------ | ----------------------------------------------------------------- |
| `--token TOKEN`    | Private token retrieved by authenticated RIFT Settings (required) |
| `--name NAME`      | Optional connection name fallback (default: hostname)             |
| `--convex-url URL` | Backend URL for the same app where the token was obtained         |
| `--help`, `-h`     | Show help                                                         |

For development, Settings copies the current app origin’s download and `NEXT_PUBLIC_CONVEX_URL`. Do not omit the backend override when testing another deployment. The source can also be run with `pnpm exec tsx packages/local/src/index.ts` followed by the same arguments; this avoids using an older packaged download during local testing.

## Scope and lifetime

Commands run directly on the host OS without sandbox isolation. This runner has shell and filesystem access under the account that started it. The desktop file picker is a separate, narrower capability limited to explicitly shared files and folders.

Keep the runner terminal open while working. It exits after one idle hour without active commands or open PTY sessions; the idle hour starts after work finishes. A connection loss after a command was accepted can leave its result uncertain, so the agent must not blindly replay that command.

## License

MIT
