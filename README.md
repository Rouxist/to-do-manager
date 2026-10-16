# To-Do Manger

To migrate my to-do management from Notion to lighter method.

## Deploy from GitHub to Vercel

1. Push the files above to your GitHub repository, including `dist/index.html` and `package-lock.json`.
2. Import the repository into Vercel.
3. Select **Other** as the framework preset. Keep the root directory at the repository root. The checked-in `vercel.json` sets the build command to `npm run build` and output directory to `dist`.
4. Add the environment variables below in Vercel Project Settings. Set them for each environment you intend to use (Production, and Preview if needed).
5. Deploy. Open the Vercel URL. Notes load from the configured public Markdown URL automatically, and **Save to R2 ⌥S** becomes available. The first save asks for `NOTES_TOKEN`.

| Variable               | Value                                                 |
| ---------------------- | ----------------------------------------------------- |
| `R2_PUBLIC_URL`        | Your public HTTPS Markdown file URL                   |
| `R2_ACCOUNT_ID`        | Your Cloudflare account ID                            |
| `R2_ACCESS_KEY_ID`     | An R2 S3 API access key ID                            |
| `R2_SECRET_ACCESS_KEY` | Its matching secret access key                        |
| `R2_BUCKET`            | bucket-name                                           |
| `R2_OBJECT_KEY`        | `dir/to/to-do-manger-backup.md`                       |
| `NOTES_TOKEN`          | A separate random app token of at least 32 characters |
