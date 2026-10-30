import { NextResponse } from "next/server";
import { ultraigdl } from "ultra-igdl";

/**
 * Instagram increasingly refuses to expose Reel MP4 URLs to logged-out
 * requests. ultra-igdl can use the site owner's Instagram session, but only
 * when it is explicitly passed in — the library does NOT read these env vars
 * by itself in a Next.js route. Configure ONE of these in the host's
 * Environment Variables (never commit real values):
 *
 *   INSTAGRAM_COOKIES=sessionid=...; csrftoken=...; ds_user_id=...
 *   INSTAGRAM_SESSION_ID=...
 */
function instagramSession() {
  const cookies = process.env.INSTAGRAM_COOKIES?.trim() || undefined;
  const sessionId = process.env.INSTAGRAM_SESSION_ID?.trim() || undefined;
  return { cookies, sessionId, configured: Boolean(cookies || sessionId) };
}

function normalizeInstagramUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(/https?:\/\/[^\s<>"']+/i);
  const candidate = (match ? match[0] : raw.trim()).replace(/[).,;!?"']+$/, "");
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    const host = parsed.hostname.toLowerCase();
    if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return null;

    // Tracking parameters such as ?rpxt=... can confuse extractors.
    let path = parsed.pathname;
    if (!path.endsWith("/")) path += "/";
    return `https://www.instagram.com${path}`;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = instagramSession();

  try {
    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    const cleanUrl = normalizeInstagramUrl(body?.url);

    if (!cleanUrl) {
      return NextResponse.json(
        { success: false, code: "INVALID_INSTAGRAM_URL", error: "Please provide a valid Instagram link." },
        { status: 400 },
      );
    }

    const ig = new ultraigdl({
      cookies: session.cookies,
      sessionId: session.sessionId,
    });

    const result = await ig.download(cleanUrl);

    if (result.code !== 200) {
      const upstreamMessage =
        ("message" in result ? result.message : undefined) ?? "Media not found";
      const requiresSession =
        /INSTAGRAM_SESSION_ID|INSTAGRAM_COOKIES|requires .*session/i.test(upstreamMessage);
      const sessionExpired = /session expired/i.test(upstreamMessage);

      if (requiresSession || sessionExpired) {
        // Enough detail for the site owner's server logs, without ever
        // printing the cookie/session values themselves.
        console.error("[LUNA Instagram]", {
          code: session.configured ? "INSTAGRAM_SESSION_EXPIRED" : "INSTAGRAM_SESSION_REQUIRED",
          sessionConfigured: session.configured,
          url: cleanUrl,
          upstream: upstreamMessage,
        });

        return NextResponse.json(
          {
            success: false,
            code: session.configured ? "INSTAGRAM_SESSION_EXPIRED" : "INSTAGRAM_SESSION_REQUIRED",
            error:
              "Instagram is blocking this Reel for logged-out downloads right now. Please try again later, or tap the WhatsApp logo and send us the link.",
          },
          { status: 503 },
        );
      }

      console.error("[LUNA Instagram]", {
        code: result.code,
        sessionConfigured: session.configured,
        url: cleanUrl,
        upstream: upstreamMessage,
      });

      return NextResponse.json(
        {
          success: false,
          code: "INSTAGRAM_MEDIA_NOT_FOUND",
          error:
            "We couldn't fetch that Instagram video. It may be private, deleted, or temporarily blocked by Instagram.",
        },
        { status: result.code >= 400 && result.code < 500 ? result.code : 502 },
      );
    }

    const media = "media" in result ? result.media : [];
    const selected = media.find((m) => m.type === "video") ?? media[0];

    if (!selected?.url) {
      return NextResponse.json(
        {
          success: false,
          code: "INSTAGRAM_MEDIA_NOT_FOUND",
          error: "We found the post, but Instagram did not provide a downloadable video.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      mediaUrl: selected.url,
      mediaType: selected.type || "video",
      thumbnail: selected.thumbnail || "",
      caption: "caption" in result ? result.caption || "" : "",
      username: "username" in result ? result.username || "" : "",
      duration: selected.duration,
    });
  } catch (error) {
    console.error("[LUNA Instagram] SERVER ERROR:", error);
    return NextResponse.json(
      {
        success: false,
        code: "INSTAGRAM_SERVER_ERROR",
        error: "Something went wrong while contacting Instagram. Please try again.",
      },
      { status: 500 },
    );
  }
}
