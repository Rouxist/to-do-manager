# To-Do Manger

To migrate my to-do management from Notion to lighter method.

## Deploy from GitHub to Vercel

1. Push the files above to your GitHub repository, including `dist/index.html` and `package-lock.json`.
2. Import the repository into Vercel.
3. Select **Other** as the framework preset. Keep the root directory at the repository root. The checked-in `vercel.json` sets the build command to `npm run build` and output directory to `dist`.
4. Add the environment variables below in Vercel Project Settings. Set them for each environment you intend to use (Production, and Preview if needed).
5. Deploy. Open the Vercel URL. The page tries your remembered login first. If needed, enter `NOTES_TOKEN` once to sign in for 90 days, load notes, and enable saving.

| Variable               | Value                                                 |
| ---------------------- | ----------------------------------------------------- |
| `R2_PUBLIC_URL`        | Your public HTTPS Markdown file URL                   |
| `R2_ACCOUNT_ID`        | Your Cloudflare account ID                            |
| `R2_ACCESS_KEY_ID`     | An R2 S3 API access key ID                            |
| `R2_SECRET_ACCESS_KEY` | Its matching secret access key                        |
| `R2_BUCKET`            | bucket-name                                           |
| `R2_OBJECT_KEY`        | `dir/to/to-do-manger-backup.md`                       |
| `NOTES_TOKEN`          | A separate random app token of at least 32 characters |

The app token protects app endpoints, not the external R2 public URL itself. To prevent direct unauthenticated downloads, disable the bucket's public access in Cloudflare and switch loading to authenticated R2 API reads; the app cannot change the bucket's access settings on its own.

## Remember login for 90 days

After entering `NOTES_TOKEN`, this browser stays signed in for a fixed 90 days, including after a normal browser restart. The browser holds a signed `todo_session` cookie with `HttpOnly`, `SameSite=Strict`, `Path=/`, and a 90-day `Max-Age`. HTTPS deployments also set `Secure`. Local HTTP development is permitted only on loopback hosts.

The raw token is sent once to `POST /api/session`, checked against the existing environment variable, and then cleared from the input. It is not stored in JavaScript memory, browser storage, or the session cookie. The cookie contains a signed expiration and a random identifier. No additional environment variable, database, or package is required. Changing `NOTES_TOKEN` invalidates previously issued sessions. Reading or saving does not extend the expiry.

The page tries the cookie before showing the token prompt. Missing or expired authorization asks for `NOTES_TOKEN`; reauthentication retries the interrupted operation and keeps unsaved edits. Both authenticated R2 API reads and URL-based loads accept the cookie. The existing bearer-token API remains supported for external clients.

Use **Log out** to clear this browser's cookie and the notes currently displayed. If there are unsaved changes, the app asks before discarding them. Logout is local to this browser; rotating `NOTES_TOKEN` invalidates all sessions. Other open tabs lose server access on their next request.

Someone using your unlocked browser profile can use its remembered login. Other browser profiles or devices must sign in separately. Site-data clearing or private-browsing cleanup can end the remembered login early. Cookies are scoped to the hostname, not its port: keep using the same local address (`127.0.0.1` or `localhost`), and use your HTTPS Vercel address for deployment.

The backend rejects cross-origin login/logout requests and cookie-authenticated writes. Login, logout, and notes responses are marked `Cache-Control: no-store`. Notes remain in R2 and page memory, not persistent browser storage. The external public R2 URL is still readable directly unless you separately disable public access in Cloudflare.

The test suite includes session expiry, cookie flags, tampering, token rotation, cookie-based API access, origin checks, unsaved edits during reauthentication, logout cancellation/failure, and simulated reopening with a remembered login:

```sh
npm test
npm run build
```

For a manual browser check, enter the token, close and reopen the browser, then open the same app address. Notes should load without another prompt. After **Log out**, reopening should require the token again. Merely loading or logging out does not change the R2 file.

Research appears to the right of Chores below the planning panels (stacked below on small screens). It supports Markdown and the same save/export and duplication shortcuts. Older backups load with Research empty; the next save includes it.

In any Markdown editor, **Option + Up/Down** moves the current line (or selected lines) above/below the neighboring line. **Option + Shift + Up/Down** duplicates it above/below. On Windows/Linux, use Alt in place of Option.

**Cmd + Z** undoes edits, including moving, duplicating, and indenting lines; **Cmd + Shift + Z** redoes them. On Windows/Linux, use Ctrl in place of Cmd. Each panel keeps up to 200 undo steps; loading notes or logging out clears the history.

## R2 file versions on Vercel

The editor loads notes directly from the authenticated R2 API (`GET /api/notes`), using the same bucket and key as saving. The backend returns the storage ETag as `X-R2-Version` as well as the standard `ETag`. The editor uses `X-R2-Version` for conditional saves so intermediary compression or page-cache ETag changes do not affect R2 version checks. Stale versions still reject writes to protect newer notes.

The protected `?source=public` endpoint remains available for compatibility, but the editor no longer uses it for initial loading. `R2_PUBLIC_URL` is no longer needed for the normal editor workflow. After deploying this fix, export any unsaved edits before refreshing the page; the refreshed app must load the new version header before saving.
