# Optional YouTube download worker (prototype)

This is an **optional, separately hosted** Node service. The website can keep
running on Vercel. When configured, it starts a worker job, polls for completion,
and sends the browser to a short-lived signed download URL on the worker. The
worker uses `yt-dlp` and `ffmpeg` to download separate tracks and combine them
into MP4. Vercel is not used to relay the resulting video.

This is a starting point, **not a proven fix for YouTube blocking**. The worker
still needs network access to YouTube. A cloud host's IP can receive the same
sign-in or bot check; public instances are not used by this worker. No YouTube
cookies or PO tokens are required or collected by this implementation. The
worker has not been verified against a real YouTube video or deployed from this
repository. Only process videos you are authorized to save.

## Before deploying

- Choose a separate host that supports a long-running Docker container, HTTPS,
  outbound YouTube access, at least one CPU, and sufficient temporary disk and
  bandwidth. Hosting and traffic may cost money. Confirm the host permits this
  use. A provider's request or bandwidth limits may also interrupt downloads.
- Run **one replica**. Jobs and signed links are stored in memory and local
  temporary storage; restarting the worker loses jobs, and multiple replicas will
  not share job state. Container crashes may leave temporary files; use ephemeral
  storage or a dedicated, quota-limited temporary filesystem and clean it up.
- This prototype limits concurrency to one active job, keeps at most three jobs,
  expires finished jobs after 15 minutes, and limits processing to 15 minutes.
  It requests videos up to one hour and asks yt-dlp to skip files above 500 MiB;
  YouTube may not provide size information before a download, so this is **not**
  a hard disk quota. Enforce one at the host/container level.
- The worker's job API requires a shared secret, but **LUNA's public job route is
  not user-authenticated or rate-limited**. Do not expose this prototype for
  general public use without adding authentication, distributed rate limits,
  abuse controls, monitoring, disk quotas and appropriate network protections.
  Signed download links are bearer links; anyone with one can download the file
  until expiry. Keep HTTPS enabled and avoid logging full URLs/query strings.

## Configuration

1. Deploy the Dockerfile in this directory to your chosen host using this
   directory as the Docker build context. Assign an HTTPS public origin such as
   `https://worker.example.com` (no path, query, credentials or trailing path).
2. Generate a long random secret **locally**, for example with
   `openssl rand -hex 32`. Never share it in chat or commit it.
3. Set these environment variables on the worker host:
   - `WORKER_PUBLIC_URL`: its HTTPS origin. Browser downloads go directly here.
   - `WORKER_SECRET`: the random secret, at least 32 bytes.
   - `PORT`: the host's assigned port, if different from 8080.
4. In the Vercel project's **Production** environment, set:
   - `YOUTUBE_WORKER_URL`: the same HTTPS origin.
   - `YOUTUBE_WORKER_SECRET`: the same secret as `WORKER_SECRET`.
5. Deploy the website changes and the worker, then test a video you are allowed
   to save. Environment changes require a new Vercel deployment. A preview is
   not proof the worker can download it. Do not share secrets or signed links.

If both Vercel variables are absent, the existing YouTube route remains in use.
If either is misconfigured, LUNA reports an error instead of silently falling
back. Worker errors deliberately avoid exposing URLs or extractor logs to users.
The worker logs only a coarse failure category, not the extractor's raw output.
Operators must monitor the host privately and update yt-dlp as YouTube changes.

## Local tests

Run `node --experimental-strip-types --test tests/*.test.mjs` on Node 22. The
worker test uses a fake extractor; it verifies authentication, job limits, status,
signed file access and error handling, **not** actual YouTube extraction or
FFmpeg muxing. A real end-to-end test requires a deployed worker with YouTube
access and a permitted test video.
