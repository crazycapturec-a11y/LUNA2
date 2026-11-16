import {
  extractInstagramCookie,
  instagramCookieHeader,
  instagramDocIds,
  parseInstagramPostTarget,
  shortcodeToMediaId,
  type InstagramAuthOptions,
} from './instagram';
import {
  INSTAGRAM_ANDROID_APP_ID,
  INSTAGRAM_ANDROID_UA,
  INSTAGRAM_ASBD_ID,
  INSTAGRAM_BROWSER_UA,
  INSTAGRAM_DOCUMENT_HEADERS,
  INSTAGRAM_WEB_APP_ID,
  instagramNavigationGet,
  readResponseText,
} from './instagram-http';
import {
  extractFromGraphqlPayload,
  extractStructuredInstagramMedia,
  parseInstagramPageTokens,
  parseInstagramSjsMedia,
  type InstagramResolvedMedia,
} from './instagram-media';

export type InstagramDirectStep =
  | 'api_media_info'
  | 'web_session'
  | 'graphql_shortcode'
  | 'graphql_polaris'
  | 'post_page'
  | 'mobile_media_info'
  | 'auth_post_page'
  | 'auth_graphql';

export type InstagramDirectAttempt = {
  step: InstagramDirectStep;
  authenticated: boolean;
  status: number | 'network_error';
  mediaFound: boolean;
};

export type InstagramDirectResult = {
  media: InstagramResolvedMedia | null;
  rateLimited: boolean;
  sessionInvalid: boolean;
  gated: boolean;
};

type AnonymousWebSession = {
  cookies: Record<string, string>;
  lsd: string;
  queryIds: Record<string, string>;
  expiresAt: number;
};

// Only harmless anonymous session cookies are ever accepted from homepage Set-Cookie.
const SAFE_ANON_COOKIES = new Set(['csrftoken', 'datr', 'ig_did', 'ig_nrcb', 'mid']);
const ANON_SESSION_TTL_MS = 5 * 60 * 1000;
const PER_REQUEST_TIMEOUT_MS = 4500;
const DIRECT_DEADLINE_MS = 18000;

let cachedAnonSession: AnonymousWebSession | null = null;

export function resetInstagramWebSessionCache(): void {
  cachedAnonSession = null;
}

function isMockedFetch(): boolean {
  return (
    typeof globalThis.fetch === 'function' &&
    typeof (globalThis.fetch as unknown as { mock?: unknown }).mock === 'object' &&
    (globalThis.fetch as unknown as { mock?: unknown }).mock !== null
  );
}

function mergeSafeAnonCookies(target: Record<string, string>, setCookies: string[]): void {
  for (const header of setCookies) {
    const first = header.split(';', 1)[0] || '';
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!SAFE_ANON_COOKIES.has(name)) continue;
    if (!value || !/^[^\s;\r\n]{1,256}$/.test(value)) continue;
    target[name] = value;
  }
}

function formatCookieMap(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function parseInstagramJson(text: string): unknown {
  const cleaned = text.replace(/^\s*for\s*\(\s*;\s*;\s*\)\s*;\s*/, '').trim();
  if (!cleaned || (cleaned[0] !== '{' && cleaned[0] !== '[')) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function isLoginOrRootRedirect(location: string): boolean {
  if (!location) return false;
  try {
    const resolved = new URL(location, 'https://www.instagram.com');
    const path = resolved.pathname.toLowerCase();
    return (
      path === '/' ||
      path.startsWith('/accounts/login') ||
      path.startsWith('/challenge') ||
      path.startsWith('/checkpoint')
    );
  } catch {
    return false;
  }
}

function isJsonSessionRejected(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const rec = parsed as Record<string, unknown>;
  if (rec.require_login === true) return true;
  const msg = typeof rec.message === 'string' ? rec.message.toLowerCase() : '';
  return (
    msg === 'login_required' ||
    msg === 'checkpoint_required' ||
    msg === 'challenge_required' ||
    msg === 'useragent mismatch' ||
    (!msg.includes('please wait a few minutes') && msg.includes('session'))
  );
}

function webApiHeaders(
  referer: string,
  cookieHeader: string,
  lsd = '',
  friendlyName = '',
  csrfOverride = '',
): Record<string, string> {
  const csrf = extractInstagramCookie(cookieHeader, 'csrftoken') || csrfOverride;
  const headers: Record<string, string> = {
    'User-Agent': INSTAGRAM_BROWSER_UA,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Origin: 'https://www.instagram.com',
    Referer: referer,
    'X-IG-App-ID': INSTAGRAM_WEB_APP_ID,
    'X-ASBD-ID': INSTAGRAM_ASBD_ID,
    'X-IG-WWW-Claim': '0',
    'X-Requested-With': 'XMLHttpRequest',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  };
  if (csrf) headers['X-CSRFToken'] = csrf;
  if (lsd) headers['X-FB-LSD'] = lsd;
  if (friendlyName) headers['X-FB-Friendly-Name'] = friendlyName;
  if (cookieHeader) headers.Cookie = cookieHeader;
  return headers;
}

function stepSignal(deadline: AbortSignal, ms = PER_REQUEST_TIMEOUT_MS): AbortSignal {
  return AbortSignal.any([deadline, AbortSignal.timeout(ms)]);
}

function getResponseSetCookies(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === 'function') {
    const list = extended.getSetCookie();
    if (list.length > 0) return list;
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

async function acquireAnonymousWebSession(
  deadline: AbortSignal,
  onAttempt?: (attempt: InstagramDirectAttempt) => void,
): Promise<{ session: AnonymousWebSession | null; rateLimited: boolean }> {
  const useCache = !isMockedFetch();
  if (useCache && cachedAnonSession && cachedAnonSession.expiresAt > Date.now()) {
    return { session: cachedAnonSession, rateLimited: false };
  }
  if (deadline.aborted) return { session: null, rateLimited: false };

  try {
    const response = await instagramNavigationGet('https://www.instagram.com/', {
      headers: { ...INSTAGRAM_DOCUMENT_HEADERS },
      redirect: 'manual',
      signal: stepSignal(deadline),
    });

    const cookies: Record<string, string> = {};
    mergeSafeAnonCookies(cookies, response.setCookies);

    if (response.status === 429) {
      onAttempt?.({ step: 'web_session', authenticated: false, status: 429, mediaFound: false });
      await response.cancel();
      return { session: null, rateLimited: true };
    }

    if (!response.ok) {
      onAttempt?.({ step: 'web_session', authenticated: false, status: response.status, mediaFound: false });
      await response.cancel();
      return { session: null, rateLimited: false };
    }

    const html = await response.readText();
    onAttempt?.({ step: 'web_session', authenticated: false, status: response.status, mediaFound: false });
    if (!html) return { session: null, rateLimited: false };

    const tokens = parseInstagramPageTokens(html);
    const session: AnonymousWebSession = {
      cookies,
      lsd: tokens.lsd,
      queryIds: tokens.queryIds,
      expiresAt: Date.now() + ANON_SESSION_TTL_MS,
    };
    if (useCache && (session.lsd || Object.keys(session.cookies).length > 0)) {
      cachedAnonSession = session;
    }
    return { session, rateLimited: false };
  } catch {
    onAttempt?.({ step: 'web_session', authenticated: false, status: 'network_error', mediaFound: false });
    return { session: null, rateLimited: false };
  }
}

async function refreshAnonCsrfViaRuling(
  session: AnonymousWebSession,
  mediaId: string,
  referer: string,
  deadline: AbortSignal,
): Promise<boolean> {
  if (deadline.aborted) return false;
  try {
    const cookieHeader = formatCookieMap(session.cookies);
    const url = `https://www.instagram.com/api/v1/web/get_ruling_for_content/?content_type=MEDIA&target_id=${encodeURIComponent(mediaId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: webApiHeaders(referer, cookieHeader, session.lsd),
      redirect: 'error',
      cache: 'no-store',
      signal: stepSignal(deadline, 3000),
    });
    mergeSafeAnonCookies(session.cookies, getResponseSetCookies(response.headers));
    const rateLimited = response.status === 429;
    await response.body?.cancel().catch(() => {});
    return rateLimited;
  } catch {
    return false;
  }
}

async function postGraphql(params: {
  step: InstagramDirectStep;
  authenticated: boolean;
  docId: string;
  friendlyName: string;
  variables: Record<string, unknown>;
  lsd: string;
  cookieHeader: string;
  csrfOverride?: string;
  referer: string;
  shortcode: string;
  videoOnly: boolean;
  mediaId: string | null;
  deadline: AbortSignal;
  onAttempt?: (attempt: InstagramDirectAttempt) => void;
}): Promise<{
  media: InstagramResolvedMedia | null;
  rateLimited: boolean;
  gated: boolean;
  loginRequired: boolean;
  docIdFailed: boolean;
  authRejected: boolean;
}> {
  if (params.deadline.aborted) {
    return { media: null, rateLimited: false, gated: false, loginRequired: false, docIdFailed: false, authRejected: false };
  }
  try {
    const body = new URLSearchParams({
      lsd: params.lsd,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: params.friendlyName,
      server_timestamps: 'true',
      doc_id: params.docId,
      variables: JSON.stringify(params.variables),
    });
    const headers: Record<string, string> = {
      ...webApiHeaders(params.referer, params.cookieHeader, params.lsd, params.friendlyName, params.csrfOverride),
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    const response = await fetch('https://www.instagram.com/api/graphql', {
      method: 'POST',
      headers,
      body,
      // Never follow redirects (especially important when authenticated).
      redirect: 'error',
      cache: 'no-store',
      signal: stepSignal(params.deadline),
    });

    if (response.status === 429) {
      params.onAttempt?.({
        step: params.step,
        authenticated: params.authenticated,
        status: 429,
        mediaFound: false,
      });
      await response.body?.cancel().catch(() => {});
      return { media: null, rateLimited: true, gated: false, loginRequired: false, docIdFailed: false, authRejected: false };
    }

    const text = await readResponseText(response);
    const parsed = text ? parseInstagramJson(text) : null;

    if (!response.ok || !parsed) {
      params.onAttempt?.({
        step: params.step,
        authenticated: params.authenticated,
        status: response.status,
        mediaFound: false,
      });
      const loginRequired = parsed ? isJsonSessionRejected(parsed) : false;
      const authRejected = response.status === 401 || response.status === 403 || loginRequired;
      return {
        media: null,
        rateLimited: false,
        gated: false,
        loginRequired,
        docIdFailed: response.status === 400 || (!parsed && response.ok),
        authRejected,
      };
    }

    const extracted = extractFromGraphqlPayload(parsed, params.shortcode, params.videoOnly, params.mediaId);
    params.onAttempt?.({
      step: params.step,
      authenticated: params.authenticated,
      status: response.status,
      mediaFound: Boolean(extracted.media),
    });
    return {
      media: extracted.media,
      rateLimited: false,
      gated: extracted.gated,
      loginRequired: extracted.loginRequired,
      docIdFailed: extracted.docIdFailed,
      authRejected: extracted.loginRequired,
    };
  } catch {
    params.onAttempt?.({
      step: params.step,
      authenticated: params.authenticated,
      status: 'network_error',
      mediaFound: false,
    });
    return { media: null, rateLimited: false, gated: false, loginRequired: false, docIdFailed: false, authRejected: false };
  }
}

function findLearnedQueryId(queryIds: Record<string, string>, pattern: RegExp): string {
  for (const [name, id] of Object.entries(queryIds)) {
    if (pattern.test(name) && /^\d{10,25}$/.test(id)) return id;
  }
  return '';
}

/**
 * Direct first-party Instagram lookup supporting 2026 web GraphQL (`lsd` + `doc_id`),
 * Polaris `data-sjs` post pages, REST `api/v1/media/{pk}/info/`, and mobile API.
 * User session cookies are sent ONLY to `https://www.instagram.com` and NEVER follow redirects.
 */
export async function fetchInstagramDirect(
  url: string,
  auth: InstagramAuthOptions = {},
  onAttempt?: (attempt: InstagramDirectAttempt) => void,
): Promise<InstagramDirectResult> {
  const target = parseInstagramPostTarget(url);
  if (!target) {
    return { media: null, rateLimited: false, sessionInvalid: false, gated: false };
  }

  const deadline = AbortSignal.timeout(DIRECT_DEADLINE_MS);
  const sessionCookie = instagramCookieHeader(auth);
  const mediaId = shortcodeToMediaId(target.shortcode);
  const { shortcodeDocIds, polarisDocId } = instagramDocIds();

  let sessionInvalid = false;
  let gated = false;

  // Step 1: Authenticated web REST `/api/v1/media/{pk}/info/` (fastest logged-in route).
  if (sessionCookie && mediaId && !deadline.aborted) {
    try {
      const response = await fetch(`https://www.instagram.com/api/v1/media/${mediaId}/info/`, {
        method: 'GET',
        headers: webApiHeaders(target.url, sessionCookie),
        // Manual redirect so we can detect login redirects without ever forwarding cookies.
        redirect: 'manual',
        cache: 'no-store',
        signal: stepSignal(deadline),
      });

      if (response.status === 429) {
        onAttempt?.({ step: 'api_media_info', authenticated: true, status: 429, mediaFound: false });
        await response.body?.cancel().catch(() => {});
        return { media: null, rateLimited: true, sessionInvalid: false, gated: false };
      }

      if (response.status >= 300 && response.status < 400) {
        if (isLoginOrRootRedirect(response.headers.get('location') || '')) {
          sessionInvalid = true;
        }
        onAttempt?.({ step: 'api_media_info', authenticated: true, status: response.status, mediaFound: false });
        await response.body?.cancel().catch(() => {});
      } else {
        const text = await readResponseText(response);
        const parsed = text ? parseInstagramJson(text) : null;
        const looksLikeHtmlLogin = Boolean(response.ok && !parsed && text && /<html|<!doctype/i.test(text));
        if (response.status === 401 || (parsed && isJsonSessionRejected(parsed)) || looksLikeHtmlLogin) {
          sessionInvalid = true;
        }
        const extracted = response.ok && parsed
          ? extractFromGraphqlPayload(parsed, target.shortcode, target.videoOnly, mediaId)
          : null;
        onAttempt?.({
          step: 'api_media_info',
          authenticated: true,
          status: response.status,
          mediaFound: Boolean(extracted?.media),
        });
        if (extracted?.media) {
          return { media: extracted.media, rateLimited: false, sessionInvalid: false, gated: false };
        }
      }
    } catch {
      onAttempt?.({ step: 'api_media_info', authenticated: true, status: 'network_error', mediaFound: false });
    }
  }

  // Step 2: Anonymous logged-out web session + `/api/graphql` (shortcode + Polaris media_id).
  const anonResult = await acquireAnonymousWebSession(deadline, onAttempt);
  if (anonResult.rateLimited) {
    return { media: null, rateLimited: true, sessionInvalid, gated };
  }
  const anon = anonResult.session;
  let triedPolarisDocId = '';

  if (anon?.lsd && !deadline.aborted) {
    const learnedShortcodeId = findLearnedQueryId(
      anon.queryIds,
      /PolarisPostActionLoadPostQuery|PolarisPostRootQuery/i,
    );
    const candidateShortcodeIds = learnedShortcodeId && !shortcodeDocIds.includes(learnedShortcodeId)
      ? [learnedShortcodeId, ...shortcodeDocIds]
      : shortcodeDocIds;

    // 2a. Shortcode GraphQL query -> data.xdt_api__v1__media__shortcode__web_info.items[0]
    for (let i = 0; i < candidateShortcodeIds.length && !deadline.aborted; i++) {
      const res = await postGraphql({
        step: 'graphql_shortcode',
        authenticated: false,
        docId: candidateShortcodeIds[i],
        friendlyName: 'PolarisPostActionLoadPostQueryQuery',
        variables: {
          shortcode: target.shortcode,
          __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
        },
        lsd: anon.lsd,
        cookieHeader: formatCookieMap(anon.cookies),
        referer: target.url,
        shortcode: target.shortcode,
        videoOnly: target.videoOnly,
        mediaId,
        deadline,
        onAttempt,
      });
      if (res.rateLimited) {
        return { media: null, rateLimited: true, sessionInvalid, gated };
      }
      if (res.media) {
        return { media: res.media, rateLimited: false, sessionInvalid, gated: false };
      }
      if (res.authRejected && cachedAnonSession === anon) {
        cachedAnonSession = null;
      }
      if (res.gated) gated = true;
      // Only try fallback shortcode doc_id if the primary persisted query errored/rotated.
      if (!res.docIdFailed) break;
    }

    // 2b. Polaris media-id query -> data.xig_polaris_media.if_not_gated_logged_out
    if (mediaId && !deadline.aborted) {
      if (!anon.cookies.csrftoken) {
        const rulingLimited = await refreshAnonCsrfViaRuling(anon, mediaId, target.url, deadline);
        if (rulingLimited) {
          return { media: null, rateLimited: true, sessionInvalid, gated };
        }
      }
      const learnedPolarisId = findLearnedQueryId(
        anon.queryIds,
        /PolarisLoggedOutDesktopWWWPostRootContentQuery/i,
      );
      triedPolarisDocId = learnedPolarisId || polarisDocId;
      const polarisRes = await postGraphql({
        step: 'graphql_polaris',
        authenticated: false,
        docId: triedPolarisDocId,
        friendlyName: 'PolarisLoggedOutDesktopWWWPostRootContentQuery',
        variables: { media_id: mediaId },
        lsd: anon.lsd,
        cookieHeader: formatCookieMap(anon.cookies),
        referer: target.url,
        shortcode: target.shortcode,
        videoOnly: target.videoOnly,
        mediaId,
        deadline,
        onAttempt,
      });
      if (polarisRes.rateLimited) {
        return { media: null, rateLimited: true, sessionInvalid, gated };
      }
      if (polarisRes.media) {
        return { media: polarisRes.media, rateLimited: false, sessionInvalid, gated: false };
      }
      if (polarisRes.gated) gated = true;
    }
  }

  // Step 3: Anonymous permalink HTML (`/p/{shortcode}/`) -> parses `<script data-sjs>` Polaris data
  // and recovers automatically if the page advertises a freshly rotated GraphQL queryID.
  if (!deadline.aborted) {
    try {
      const headers: Record<string, string> = { ...INSTAGRAM_DOCUMENT_HEADERS };
      const anonCookie = anon ? formatCookieMap(anon.cookies) : '';
      if (anonCookie) headers.Cookie = anonCookie;

      const response = await instagramNavigationGet(target.url, {
        headers,
        redirect: 'error',
        signal: stepSignal(deadline),
      });

      if (response.status === 429) {
        onAttempt?.({ step: 'post_page', authenticated: false, status: 429, mediaFound: false });
        await response.cancel();
        return { media: null, rateLimited: true, sessionInvalid, gated };
      }

      if (!response.ok) {
        onAttempt?.({ step: 'post_page', authenticated: false, status: response.status, mediaFound: false });
        await response.cancel();
      } else {
        const pageCookies: Record<string, string> = { ...(anon?.cookies || {}) };
        mergeSafeAnonCookies(pageCookies, response.setCookies);
        const html = await response.readText();
        const sjs = html
          ? parseInstagramSjsMedia(html, target.shortcode, target.videoOnly, mediaId)
          : { media: null, gated: false };
        onAttempt?.({
          step: 'post_page',
          authenticated: false,
          status: response.status,
          mediaFound: Boolean(sjs.media),
        });
        if (sjs.media) {
          return { media: sjs.media, rateLimited: false, sessionInvalid, gated: false };
        }
        if (sjs.gated) gated = true;

        // If the page exposed LSD (e.g. when homepage redirected) or a fresh queryID, try it.
        if (html && !deadline.aborted) {
          const pageTokens = parseInstagramPageTokens(html);
          const effectiveLsd = pageTokens.lsd || anon?.lsd || '';

          if (!anon?.lsd && pageTokens.lsd) {
            const freshShortcodeId =
              findLearnedQueryId(pageTokens.queryIds, /PolarisPostActionLoadPostQuery|PolarisPostRootQuery/i) ||
              shortcodeDocIds[0];
            const scRetry = await postGraphql({
              step: 'graphql_shortcode',
              authenticated: false,
              docId: freshShortcodeId,
              friendlyName: 'PolarisPostActionLoadPostQueryQuery',
              variables: {
                shortcode: target.shortcode,
                __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
              },
              lsd: pageTokens.lsd,
              cookieHeader: formatCookieMap(pageCookies),
              referer: target.url,
              shortcode: target.shortcode,
              videoOnly: target.videoOnly,
              mediaId,
              deadline,
              onAttempt,
            });
            if (scRetry.rateLimited) {
              return { media: null, rateLimited: true, sessionInvalid, gated };
            }
            if (scRetry.media) {
              return { media: scRetry.media, rateLimited: false, sessionInvalid, gated: false };
            }
            if (scRetry.gated) gated = true;
          }

          const freshPolarisId = findLearnedQueryId(
            pageTokens.queryIds,
            /PolarisLoggedOutDesktopWWWPostRootContentQuery/i,
          );
          const candidateId = freshPolarisId || (!triedPolarisDocId ? polarisDocId : '');
          if (mediaId && effectiveLsd && candidateId && candidateId !== triedPolarisDocId && !deadline.aborted) {
            const retryRes = await postGraphql({
              step: 'graphql_polaris',
              authenticated: false,
              docId: candidateId,
              friendlyName: 'PolarisLoggedOutDesktopWWWPostRootContentQuery',
              variables: { media_id: mediaId },
              lsd: effectiveLsd,
              cookieHeader: formatCookieMap(pageCookies),
              referer: target.url,
              shortcode: target.shortcode,
              videoOnly: target.videoOnly,
              mediaId,
              deadline,
              onAttempt,
            });
            if (retryRes.rateLimited) {
              return { media: null, rateLimited: true, sessionInvalid, gated };
            }
            if (retryRes.media) {
              return { media: retryRes.media, rateLimited: false, sessionInvalid, gated: false };
            }
            if (retryRes.gated) gated = true;
          }
        }
      }
    } catch {
      onAttempt?.({ step: 'post_page', authenticated: false, status: 'network_error', mediaFound: false });
    }
  }

  // Step 4: Anonymous Android app API (no user cookies; only contacts i.instagram.com).
  if (mediaId && !deadline.aborted) {
    try {
      const response = await fetch(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, {
        method: 'GET',
        headers: {
          'User-Agent': INSTAGRAM_ANDROID_UA,
          Accept: '*/*',
          'Accept-Language': 'en-US',
          'X-IG-App-ID': INSTAGRAM_ANDROID_APP_ID,
          'X-IG-App-Locale': 'en_US',
          'X-IG-Device-Locale': 'en_US',
          'X-IG-Mapped-Locale': 'en_US',
          'X-FB-HTTP-Engine': 'Liger',
        },
        redirect: 'error',
        cache: 'no-store',
        signal: stepSignal(deadline, 3500),
      });

      if (response.status === 429) {
        onAttempt?.({ step: 'mobile_media_info', authenticated: false, status: 429, mediaFound: false });
        await response.body?.cancel().catch(() => {});
        return { media: null, rateLimited: true, sessionInvalid, gated };
      }

      if (!response.ok) {
        onAttempt?.({
          step: 'mobile_media_info',
          authenticated: false,
          status: response.status,
          mediaFound: false,
        });
        await response.body?.cancel().catch(() => {});
      } else {
        const text = await readResponseText(response);
        const parsed = text ? parseInstagramJson(text) : null;
        let media: InstagramResolvedMedia | null = null;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const items = (parsed as Record<string, unknown>).items;
          if (Array.isArray(items) && items.length > 0) {
            media = extractStructuredInstagramMedia(items[0], target.shortcode, target.videoOnly, mediaId);
          }
        }
        onAttempt?.({
          step: 'mobile_media_info',
          authenticated: false,
          status: response.status,
          mediaFound: Boolean(media),
        });
        if (media) {
          return { media, rateLimited: false, sessionInvalid, gated: false };
        }
      }
    } catch {
      onAttempt?.({ step: 'mobile_media_info', authenticated: false, status: 'network_error', mediaFound: false });
    }
  }

  // Step 5: Authenticated permalink `data-sjs` + session-matched `/api/graphql`
  // (ONLY when a server session is configured AND was not rejected earlier; never follows redirects).
  if (sessionCookie && !sessionInvalid && !deadline.aborted) {
    let authLsd = '';
    let authCsrf = '';
    let authLearnedShortcodeId = '';
    try {
      const response = await instagramNavigationGet(target.url, {
        headers: { ...INSTAGRAM_DOCUMENT_HEADERS, Cookie: sessionCookie },
        // Manual redirect so login redirects are detected without ever forwarding cookies.
        redirect: 'manual',
        signal: stepSignal(deadline),
      });

      if (response.status === 429) {
        onAttempt?.({ step: 'auth_post_page', authenticated: true, status: 429, mediaFound: false });
        await response.cancel();
        return { media: null, rateLimited: true, sessionInvalid, gated };
      }

      if (response.status >= 300 && response.status < 400) {
        if (isLoginOrRootRedirect(response.location)) sessionInvalid = true;
        onAttempt?.({ step: 'auth_post_page', authenticated: true, status: response.status, mediaFound: false });
        await response.cancel();
      } else if (!response.ok) {
        onAttempt?.({ step: 'auth_post_page', authenticated: true, status: response.status, mediaFound: false });
        await response.cancel();
      } else {
        const pageSetCookies: Record<string, string> = {};
        mergeSafeAnonCookies(pageSetCookies, response.setCookies);
        authCsrf = pageSetCookies.csrftoken || '';
        const html = await response.readText();
        const sjs = html
          ? parseInstagramSjsMedia(html, target.shortcode, target.videoOnly, mediaId)
          : { media: null, gated: false };
        onAttempt?.({
          step: 'auth_post_page',
          authenticated: true,
          status: response.status,
          mediaFound: Boolean(sjs.media),
        });
        if (sjs.media) {
          return { media: sjs.media, rateLimited: false, sessionInvalid: false, gated: false };
        }
        if (html) {
          const tokens = parseInstagramPageTokens(html);
          authLsd = tokens.lsd;
          authLearnedShortcodeId = findLearnedQueryId(
            tokens.queryIds,
            /PolarisPostActionLoadPostQuery|PolarisPostRootQuery/i,
          );
        }
      }
    } catch {
      onAttempt?.({ step: 'auth_post_page', authenticated: true, status: 'network_error', mediaFound: false });
    }

    if (authLsd && !sessionInvalid && !deadline.aborted) {
      const authGql = await postGraphql({
        step: 'auth_graphql',
        authenticated: true,
        docId: authLearnedShortcodeId || shortcodeDocIds[0],
        friendlyName: 'PolarisPostActionLoadPostQueryQuery',
        variables: {
          shortcode: target.shortcode,
          __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
        },
        lsd: authLsd,
        cookieHeader: sessionCookie,
        csrfOverride: authCsrf,
        referer: target.url,
        shortcode: target.shortcode,
        videoOnly: target.videoOnly,
        mediaId,
        deadline,
        onAttempt,
      });
      if (authGql.rateLimited) {
        return { media: null, rateLimited: true, sessionInvalid, gated };
      }
      if (authGql.media) {
        return { media: authGql.media, rateLimited: false, sessionInvalid: false, gated: false };
      }
      if (authGql.loginRequired) sessionInvalid = true;
      if (authGql.gated) gated = true;
    }
  }

  return { media: null, rateLimited: false, sessionInvalid, gated };
}
