export type Platform = 'TikTok' | 'Instagram';

/** Extract a supported URL from either a link or a typical share message. */
export function findSupportedLink(input: string): { platform: Platform; url: string } | null {
  // Exclude brackets/parens that appear in Markdown like `[https://...](https://...)`
  const candidates = input.match(/https?:\/\/[^\s<>"'()\[\]]+/gi) ?? [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.replace(/[),.!?;\\]}'"`]+$/, '').replace(/^['"`]+/, ''));
      if (url.username || url.password || url.port) continue;
      const host = url.hostname.toLowerCase();
      let platform: Platform | null = null;
      if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) platform = 'TikTok';
      else if (['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am'].includes(host)) platform = 'Instagram';
      if (!platform) continue;
      // The TikTok and Instagram lookups both require HTTPS.
      url.protocol = 'https:';
      url.hash = '';
      return { platform, url: url.href };
    } catch {
      // A share message can contain more than one link.
    }
  }
  return null;
}
