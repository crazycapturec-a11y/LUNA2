export type Platform = 'TikTok' | 'Instagram' | 'YouTube';

/** Extract a supported URL from either a link or a typical share message. */
export function findSupportedLink(input: string): { platform: Platform; url: string } | null {
  const candidates = input.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.replace(/[),.!?;\]}]+$/, ''));
      if (url.username || url.password || url.port) continue;
      const host = url.hostname.toLowerCase();
      let platform: Platform | null = null;
      if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) platform = 'TikTok';
      else if (['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am'].includes(host)) platform = 'Instagram';
      else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host)) platform = 'YouTube';
      if (!platform) continue;
      // The TikTok lookup requires HTTPS; Instagram also normalizes to HTTPS.
      if (platform !== 'YouTube') url.protocol = 'https:';
      url.hash = '';
      return { platform, url: url.href };
    } catch {
      // A share message can contain more than one link.
    }
  }
  return null;
}
