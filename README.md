This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## How downloads work (and why they used to fail)

The UI could show a preview thumbnail while every download button silently did
nothing, because the browser was being pointed straight at a third-party CDN URL:

| Platform | Old behaviour | Problem | Now |
| --- | --- | --- | --- |
| TikTok | `fetch('https://www.tikwm.com/api/…')` in the browser | tikwm sends no CORS headers, so the request was blocked before any media URL existed | `/api/tiktok/info` resolves metadata server-side; media is relayed by `/api/proxy` |
| Instagram | direct `cdninstagram.com` URL | CDN answers without CORS / with a different content type, so `fetch` → `Blob` failed | `/api/download` returns a normalised URL and the file is relayed by `/api/proxy` as an attachment |
| YouTube | cobalt API + `window.open(googlevideoUrl)` | `googlevideo` URLs are IP-bound, expire, and send no CORS headers — a navigation opens a player or a 403, never a save | `youtubei.js` resolves the stream server-side and `/api/youtube/download` streams the bytes back with `Content-Disposition: attachment` |

Every download request now goes through this app's own origin, streams the file
(or falls back to a native browser save for files over 250 MB) and reports real
progress and real errors instead of failing silently.

### Optional environment variables

See `.env.example`. YouTube may require sign-in or block requests from a hosting
provider's IP address, even for public videos. The app tries alternative clients
and public instances, but these can also be blocked or unavailable. A preview
alone does not guarantee that a download will work. For deployment troubleshooting,
check the server logs and YouTube's response. The optional `YT_PO_TOKEN`,
`YT_VISITOR_DATA`, and `YT_COOKIE` settings depend on the YouTube session and do
not guarantee access; never share their values or commit them to the repository.
For Instagram, set either `IG_SESSION_ID` (only the `sessionid` value) or
`IG_COOKIES` (a complete Cookie header containing `sessionid`, and optionally
`csrftoken` and `ds_user_id`). `IG_COOKIES` takes precedence when both are set.
A full cookie header pasted into the older `IG_SESSION_ID` setting is also
accepted for compatibility. Set secrets only in the hosting dashboard, never in
chat or Git; Vercel environment changes require a new deployment. Cookies are
account credentials and expire or can be blocked, so they do not guarantee a
working download. A shared server session may allow visitors to request media
visible to that account; restrict access and use an account with appropriate
permissions rather than exposing a personal account's session publicly. When no
Instagram session is configured, LUNA may send the normalized post link (but no
Instagram cookies) to SnapInsta as a fallback. Public third-party services can be
unavailable or reject requests.

The pinned `ultra-igdl` version has a small local patch to prevent unhandled
promise rejections on network errors. Install with `npm ci` and keep lifecycle
scripts enabled so `patch-package` applies `patches/ultra-igdl+1.0.3.patch`.

An optional separately hosted YouTube worker is available as a prototype; see
[`services/youtube-worker/README.md`](services/youtube-worker/README.md) for its
security limits, deployment requirements, and unverified end-to-end status.
