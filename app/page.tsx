/* eslint-disable @next/next/no-img-element */
'use client';

import { useState, useEffect } from 'react';
import { findSupportedLink, type Platform } from './lib/platform-url';

type MediaResult = { platform: Platform; worker?: boolean; title: string; author: string; thumbnail: string; downloads: { hd: string | null; sd: string | null; mp3: string | null }; isImage?: boolean; url: string };
type HistoryItem = Pick<MediaResult, 'platform' | 'title' | 'author' | 'thumbnail' | 'url'>;

const I18N: Record<string, Record<string, string>> = {
  en: { name: "English", navHow: "How it works", navFaq: "FAQ", badge: "100% free · No sign-up needed",
    heroTitle: 'Download TikTok, Instagram & YouTube. <span class="grad">Free.</span>',
    heroSub: "Paste a link, find available formats, and save media right from your browser.",
    placeholder: "Paste a TikTok, Instagram, or YouTube link here…", paste: "Paste", download: "Download",
    trust1: "No sign-up", trust2: "HD quality", trust3: "Works on any device",
    permission: "<strong>Please note:</strong> Only download videos you have permission to save.",
    howKicker: "Simple by design", howTitle: "How it works", howSub: "Three steps. No apps to install, no account to create.",
    featuresTitle: "Made to feel effortless", faqTitle: "Frequently asked questions"
  },
  es: { name: "Español", navHow: "Cómo funciona", navFaq: "Preguntas", badge: "100% gratis · Sin registro",
    heroTitle: 'Descarga videos de TikTok, Instagram y YouTube. <span class="grad">Gratis.</span>',
    heroSub: "Pega un enlace, toca Descargar y guárdalo en HD en segundos.",
    placeholder: "Pega un enlace aquí…", paste: "Pegar", download: "Descargar",
    trust1: "Sin registro", trust2: "Calidad HD", trust3: "En cualquier dispositivo",
    permission: "<strong>Nota:</strong> Descarga solo videos que tengas permiso para guardar.",
    howKicker: "Simple por diseño", howTitle: "Cómo funciona", howSub: "Tres pasos.",
    featuresTitle: "Hecho para ser fácil", faqTitle: "Preguntas frecuentes"
  },
  pt: { name: "Português", navHow: "Como funciona", navFaq: "Perguntas", badge: "100% grátis · Sem cadastro",
    heroTitle: 'Baixe vídeos do TikTok, Instagram e YouTube. <span class="grad">Grátis.</span>',
    heroSub: "Cole um link, toque em Baixar e salve em HD em segundos.",
    placeholder: "Cole aqui um link…", paste: "Colar", download: "Baixar",
    trust1: "Sem cadastro", trust2: "Qualidade HD", trust3: "Em qualquer dispositivo",
    permission: "<strong>Nota:</strong> Baixe apenas vídeos que você tem permissão para salvar.",
    howKicker: "Simples por natureza", howTitle: "Como funciona", howSub: "Três passos.",
    featuresTitle: "Feito para ser fácil", faqTitle: "Perguntas frequentes"
  },
  si: { name: "සිංහල", navHow: "ක්‍රියා කරන ආකාරය", navFaq: "නිතර ප්‍රශ්න", badge: "100% නොමිලේ · ලියාපදිංචිය අනවශ්‍යයි",
    heroTitle: 'TikTok, Instagram සහ YouTube වීඩියෝ බාගත කරන්න. <span class="grad">නොමිලේ.</span>',
    heroSub: "සබැඳිය අලවන්න, බාගත කරන්න තට්ටු කරන්න, තත්පර කිහිපයකින් HD වලින් සුරකින්න.",
    placeholder: "සබැඳිය මෙහි අලවන්න…", paste: "අලවන්න", download: "බාගත කරන්න",
    trust1: "ලියාපදිංචිය නැත", trust2: "HD තත්ත්වය", trust3: "ඕනෑම උපාංගයක ක්‍රියා කරයි",
    permission: "<strong>සටහන:</strong> ඔබට අවසර ඇති වීඩියෝ පමණක් බාගත කරන්න.",
    howKicker: "සරලයි", howTitle: "එය ක්‍රියා කරන්නේ කෙසේද", howSub: "පියවර තුනයි.",
    featuresTitle: "පහසුව සඳහා නිර්මාණය කර ඇත", faqTitle: "නිතර ප්‍රශ්න"
  }
};

export default function Home() {
  const [platform, setPlatform] = useState<Platform>('TikTok');
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MediaResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showSupport, setShowSupport] = useState(false);
  const [lang, setLang] = useState('en');
  const [isLangOpen, setIsLangOpen] = useState(false);
  
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showContact, setShowContact] = useState(false);
  
  const [toast, setToast] = useState<string | null>(null);
  const [progress, setProgress] = useState<{show: boolean, label: string, pct: number | null}>({ show: false, label: '', pct: 0 });

  const WHATSAPP_NUM = "94742108549";
  const t = I18N[lang];

  useEffect(() => {
    const sky = document.getElementById('sky');
    if (sky && sky.children.length < 5) {
      for (let i = 0; i < 110; i++) {
        const s = document.createElement('span');
        s.className = 'star';
        const size = Math.random() * 2.2 + 0.8;
        s.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${size}px;height:${size}px;--d:${(Math.random() * 3.5 + 2).toFixed(1)}s;animation-delay:${(Math.random() * 3).toFixed(1)}s`;
        sky.appendChild(s);
      }
    }
    try {
      const saved = localStorage.getItem('luna-history');
      const parsed = saved ? JSON.parse(saved) : [];
      // Browser storage is only available after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Array.isArray(parsed)) setHistory(parsed.filter(item => item && typeof item.url === 'string' && findSupportedLink(item.url)).slice(0, 4));
    } catch { /* History is optional when browser storage is unavailable. */ }
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3400);
  };

  const saveToHistory = (item: MediaResult) => {
    const { url, title, author, thumbnail, platform } = item;
    const newHist = [{ url, title, author, thumbnail, platform }, ...history.filter(h => h.url !== item.url)].slice(0, 4);
    setHistory(newHist);
    try { localStorage.setItem('luna-history', JSON.stringify(newHist)); } catch { /* Continue without persistent history. */ }
  };

  const updateUrl = (value: string) => {
    setUrl(value);
    const detected = findSupportedLink(value);
    if (detected) setPlatform(detected.platform);
    setResult(null);
    setError(null);
    setShowSupport(false);
  };

  const selectPlatform = (next: Platform) => {
    const detected = findSupportedLink(url);
    if (detected && detected.platform !== next) setUrl('');
    setPlatform(next);
    setResult(null);
    setError(null);
    setShowSupport(false);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { updateUrl(text); showToast('Link pasted ✓'); }
    } catch { setError('Tap and hold the bar to paste.'); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setResult(null);
    setShowSupport(false);

    if (!url.trim()) {
      setError('Please paste a link first.');
      setIsLoading(false);
      return;
    }

    const link = findSupportedLink(url);
    if (!link) {
      setError('Please enter a TikTok, Instagram or YouTube link.');
      setIsLoading(false);
      setShowSupport(true);
      return;
    }
    // Use the detected platform and extracted URL, not the surrounding share text.
    const { platform, url: cleanUrl } = link;
    setPlatform(platform);
    setUrl(cleanUrl);
    try {
      if (platform === 'YouTube') {
        const res = await fetch(`/api/youtube/info?url=${encodeURIComponent(cleanUrl)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch YouTube video.');

        const newResult: MediaResult = {
          platform: 'YouTube',
          worker: data.worker === true,
          title: data.title,
          author: data.author,
          thumbnail: data.thumbnail,
          // YouTube stream URLs are IP-bound and expire, so all downloads go through
          // our own API, which resolves + streams the file server-side.
          downloads: {
            hd: `/api/youtube/download?url=${encodeURIComponent(data.url || cleanUrl)}&kind=video`,
            sd: null,
            mp3: null,
          },
          url: cleanUrl,
        };
        setResult(newResult);
        saveToHistory(newResult);
        if (data.warning) showToast('Preview ready — the download may need a retry.');
      } else if (platform === 'Instagram') {
        const res = await fetch('/api/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cleanUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch Instagram media.');

        const fileBase = `luna-instagram-${Date.now()}`;
        const ext = data.extension === 'jpg' ? 'jpg' : 'mp4';
        const downloadUrl = `/api/proxy?url=${encodeURIComponent(data.mediaUrl)}&kind=${ext === 'jpg' ? 'image' : 'video'}&filename=${fileBase}.${ext}`;

        const newResult: MediaResult = {
          platform: 'Instagram',
          title: data.title || 'Instagram Video',
          author: data.author || 'Instagram Creator',
          thumbnail: data.thumbnail || '',
          downloads: { hd: downloadUrl, sd: null, mp3: null },
          isImage: ext === 'jpg',
          url: cleanUrl,
        };
        setResult(newResult);
        saveToHistory(newResult);
      } else {
        // Metadata is resolved server-side (tikwm has no CORS headers, so the old
        // direct browser call could preview nothing but also block every download).
        const res = await fetch(`/api/tiktok/info?url=${encodeURIComponent(cleanUrl)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not extract TikTok video.');

        const newResult: MediaResult = {
          platform: 'TikTok',
          title: data.title || 'TikTok Video',
          author: data.author || 'TikTok User',
          thumbnail: data.thumbnail || '',
          downloads: {
            hd: data.downloadUrls?.hd || null,
            sd: data.downloadUrls?.sd || null,
            mp3: data.downloadUrls?.mp3 || null,
          },
          url: cleanUrl,
        };
        setResult(newResult);
        saveToHistory(newResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setShowSupport(true);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Streams a file from one of our own API routes and saves it to the device.
   *
   * Why not just `window.open(mediaUrl)`: CDN links have no CORS headers, YouTube
   * links are IP-bound, and a plain navigation opens a video player instead of
   * saving a file. Our API routes reply with Content-Disposition: attachment, and
   * we pull the bytes here so the user gets real progress + real error messages.
   */
  const downloadFile = async (downloadUrl: string | null, filename: string, label: string) => {
    if (!downloadUrl) {
      showToast(`${label} is not available for this video.`);
      return;
    }

    if (progress.show) return; // one download at a time
    setProgress({ show: true, label: `Preparing ${label}…`, pct: null });

    const saveBlob = (blob: Blob, fallbackName: string) => {
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = fallbackName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking too early cancels the save in Safari / older Chrome.
      setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
    };

    try {
      const resp = await fetch(downloadUrl);
      const contentType = resp.headers.get('content-type') || '';

      // A JSON body means the API answered with an error (expired link, 403, …).
      if (!resp.ok || contentType.includes('application/json')) {
        let message = 'Download failed. Please fetch the video again.';
        try {
          const data = await resp.json();
          if (data?.error) message = data.error;
        } catch {
          /* keep the generic message */
        }
        throw new Error(message);
      }

      const disposition = resp.headers.get('content-disposition') || '';
      const nameMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
      const serverName = nameMatch ? decodeURIComponent(nameMatch[1]) : '';
      const finalName = serverName || filename;

      const total = Number(resp.headers.get('content-length')) || 0;

      // Very large files are handed to the browser's own downloader so we never
      // blow up mobile memory holding a whole video in a Blob.
      if (total > 250 * 1024 * 1024) {
        window.location.href = downloadUrl;
        setProgress({ show: true, label: 'Handed to your browser — saving…', pct: 100 });
        showToast(`${label} download started ✓`);
        return;
      }

      if (!resp.body || !resp.body.getReader) {
        // Ancient browser: let the attachment header do the work.
        window.location.href = downloadUrl;
        showToast(`${label} download started ✓`);
        return;
      }

      const reader = resp.body.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value as unknown as BlobPart);
          received += value.length;
          if (total > 0) {
            const pct = Math.min(99, (received / total) * 100);
            setProgress({ show: true, label: `Downloading ${label}… ${pct.toFixed(0)}%`, pct });
          } else {
            setProgress({ show: true, label: `Downloading ${label}… ${(received / 1048576).toFixed(1)} MB`, pct: null });
          }
        }
      }

      if (received === 0) throw new Error('The video file came back empty. Try again.');

      saveBlob(new Blob(chunks, { type: contentType || 'application/octet-stream' }), finalName);

      setProgress({ show: true, label: 'Download started — check your Downloads folder.', pct: 100 });
      showToast(`${label} download started ✓`);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Download failed. Try again.';
      setProgress({ show: false, label: '', pct: 0 });
      showToast(message);
      setError(message);
      setShowSupport(true);
    } finally {
      // Small delay so "Saved ✓" stays readable; errors clear earlier above.
      setTimeout(() => setProgress({ show: false, label: '', pct: 0 }), 3200);
    }
  };

  const startWorkerDownload = async (videoUrl: string) => {
    if (progress.show) return;
    setError(null);
    setProgress({ show: true, label: 'Preparing video and audio — this may take several minutes…', pct: null });
    try {
      const created = await fetch('/api/youtube/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: videoUrl }),
      });
      const job = await created.json();
      if (!created.ok) throw new Error(job.error || 'Could not start the download.');
      const deadline = Date.now() + 16 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const response = await fetch(`/api/youtube/jobs?id=${encodeURIComponent(job.id)}`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not check the download.');
        if (data.status === 'failed') throw new Error(data.error || 'The download could not be prepared.');
        if (data.status === 'ready' && data.downloadUrl) {
          setProgress({ show: true, label: 'Ready — handing the file to your browser…', pct: 100 });
          window.location.assign(data.downloadUrl);
          showToast('Download handed to your browser.');
          return;
        }
      }
      throw new Error('Preparing the download took too long. Please try again.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Download failed. Please try again.';
      setError(message);
      setShowSupport(true);
      showToast(message);
    } finally {
      setTimeout(() => setProgress({ show: false, label: '', pct: 0 }), 3200);
    }
  };

  const startDownload = (quality: 'hd' | 'sd' | 'mp3') => {
    if (!result?.downloads) {
      showToast('Download link missing — fetch the video again.');
      return;
    }
    if (result.platform === 'YouTube' && result.worker && quality === 'hd') {
      void startWorkerDownload(result.url);
      return;
    }
    const label = quality === 'mp3' ? 'MP3' : quality.toUpperCase();
    const ext = quality === 'mp3' ? 'mp3' : result.isImage ? 'jpg' : 'mp4';
    const safeTitle = String(result.title || 'luna-video').replace(/[^\w-]+/g, '-').slice(0, 40) || 'luna-video';
    downloadFile(result.downloads[quality], `luna-${safeTitle}-${quality}.${ext}`, label);
  };

  const prep = platform === 'Instagram' ? 'an' : 'a';
  const placeholder = t.placeholder.replace('TikTok, Instagram, or YouTube', platform);
  const detectedLink = findSupportedLink(url);
  const step = result ? 3 : isLoading ? 2 : 1;
  const sampleUrl = platform === 'Instagram' ? 'https://www.instagram.com/reel/DfEUfYFsFVS/' : platform === 'YouTube' ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : 'https://www.tiktok.com/@tiktok/video/7106594312292453675';

  return (
    <>
      <div className="sky" id="sky" aria-hidden="true">
        <div className="moon-halo"></div>
        <svg className="moon-big" viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M78 58.5A34 34 0 1 1 41.5 22 27 27 0 0 0 78 58.5Z" fill="#FFE9A8"/></svg>
      </div>

      <header>
        <div className="wrap nav">
          <a className="logo" href="#" aria-label="LUNA home">
            <span className="crescent" aria-hidden="true"><svg width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M20.2 14.2A8.5 8.5 0 1 1 9.8 3.8a7 7 0 1 0 10.4 10.4Z" fill="#FFE9A8"/></svg></span>
            <span>LUNA<small>Video saver</small></span>
          </a>
          <nav className="nav-links" aria-label="Main">
            <a href="#how">{t.navHow}</a>
            <a href="#supported" className="hide-sm">Supported</a>
            <a href="#faq" className="hide-sm">{t.navFaq}</a>
            
            <div className="lang" style={{ position: 'relative' }}>
              <button className="lang-btn" type="button" aria-expanded={isLangOpen} aria-label="Choose language" onClick={() => setIsLangOpen(!isLangOpen)}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z"/></svg>
                <span>{t.name}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              {isLangOpen && (
                <div className="lang-menu" style={{ display: 'block' }}>
                  <button className={lang === 'en' ? 'active' : ''} onClick={() => { setLang('en'); setIsLangOpen(false); }}>English <span className="code">EN</span></button>
                  <button className={lang === 'es' ? 'active' : ''} onClick={() => { setLang('es'); setIsLangOpen(false); }}>Español <span className="code">ES</span></button>
                  <button className={lang === 'pt' ? 'active' : ''} onClick={() => { setLang('pt'); setIsLangOpen(false); }}>Português <span className="code">PT</span></button>
                  <button className={lang === 'si' ? 'active' : ''} onClick={() => { setLang('si'); setIsLangOpen(false); }}>සිංහල <span className="code">SI</span></button>
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      <main>
        <div className="wrap hero">
          <div className="hero-art" aria-hidden="true">
            <div className="hero-phone">
              <div className="hero-phone-screen">
                <span className="hero-phone-notch" />
                <span className="hero-phone-symbol"><svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M20.2 14.2A8.5 8.5 0 1 1 9.8 3.8a7 7 0 1 0 10.4 10.4Z" fill="currentColor"/></svg></span>
                <span className="hero-phone-caption">YOUR VIDEO, YOUR WAY</span>
                <span className="hero-phone-line"><i /></span>
                <span className="hero-phone-wordmark">LUNA</span>
              </div>
            </div>
            <span className="hero-float hero-float-first">✓ No sign-up</span>
            <span className="hero-float hero-float-second">♪ Formats vary</span>
          </div>
          <span className="badge"><span className="dot"></span><span dangerouslySetInnerHTML={{__html: t.badge}} /></span>
          <h1 dangerouslySetInnerHTML={{__html: t.heroTitle}} />
          <p className="hero-sub">{t.heroSub}</p>

          <div className="platform-switch" role="group" aria-label="Choose platform">
            <button className={`platform-btn ${platform === 'TikTok' ? 'active' : ''}`} data-platform="TikTok" type="button" disabled={isLoading || progress.show} aria-pressed={platform === 'TikTok'} onClick={() => selectPlatform('TikTok')}>
              <span>TikTok</span><small>Videos</small>
            </button>
            <button className={`platform-btn ${platform === 'Instagram' ? 'active' : ''}`} data-platform="Instagram" type="button" disabled={isLoading || progress.show} aria-pressed={platform === 'Instagram'} onClick={() => selectPlatform('Instagram')}>
              <span>Instagram</span><small>Reels</small>
            </button>
            <button className={`platform-btn ${platform === 'YouTube' ? 'active' : ''}`} data-platform="YouTube" type="button" disabled={isLoading || progress.show} aria-pressed={platform === 'YouTube'} onClick={() => selectPlatform('YouTube')}>
              <span>YouTube</span><small>HD Video</small>
            </button>
          </div>
          <p className="platform-hint">{detectedLink ? `${detectedLink.platform} link detected` : `${platform} selected — paste ${prep} ${platform} link below.`}</p>
          <ol className="flow-steps" aria-label="Download steps">
            {['Paste', 'Fetch', 'Download'].map((label, index) => (
              <li key={label} className={`${step === index + 1 ? 'current' : ''} ${step > index + 1 ? 'done' : ''}`} aria-current={step === index + 1 ? 'step' : undefined}>
                <span aria-hidden="true">{step > index + 1 ? '✓' : index + 1}</span>{label}
              </li>
            ))}
          </ol>

          <form className="downloader" onSubmit={handleSubmit}>
            <div className="bar">
              <div className={`field ${detectedLink ? 'valid' : ''}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>
                <input type="text" inputMode="url" autoComplete="off" aria-label="Video link or share text" value={url} onChange={(e) => updateUrl(e.target.value)} placeholder={placeholder} disabled={isLoading || progress.show} />
                <button type="button" className="btn btn-paste" onClick={handlePaste} disabled={isLoading || progress.show}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="8" y="2.5" width="8" height="4" rx="1.5"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5v14A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5v-14A1.5 1.5 0 0 1 5.5 4H8"/></svg>
                  {t.paste}
                </button>
              </div>
              <button type="submit" className={`btn btn-download ${detectedLink ? 'ready' : ''}`} disabled={isLoading || progress.show}>
                {isLoading ? 'Fetching...' : (
                  <>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13A1.5 1.5 0 0 0 20 19.5V17"/></svg>
                    {t.download}
                  </>
                )}
              </button>
            </div>
          </form>

          {error && <div className="msg error" role="alert">{error}</div>}
          {!error && result && <div className="msg ok" role="status">✓ Link ready — choose an available format below.</div>}

          {showSupport && (
            <div className="support-card" style={{ display: 'flex' }}>
              <div><strong>Link isn’t working?</strong><p>Tap the WhatsApp logo and send us the link — we’ll help you.</p></div>
              <a className="wa-logo-btn" aria-label="Contact LUNA support on WhatsApp" href={`https://wa.me/${WHATSAPP_NUM}?text=Hi%2C%20my%20LUNA%20link%20isn%27t%20working.%0ALink:%20${encodeURIComponent(url)}%0AError:%20${encodeURIComponent(error || '')}`} target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              </a>
            </div>
          )}

          <div className="trust" aria-label="Highlights">
            <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>{t.trust1}</span><span className="sep">·</span>
            <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>{t.trust2}</span><span className="sep">·</span>
            <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>{t.trust3}</span><span className="sep">·</span>
            <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>Audio when available</span>
          </div>
          <p className="permission" dangerouslySetInnerHTML={{__html: t.permission}} />
          <p className="sample-line">No link handy? <button type="button" onClick={() => updateUrl(sampleUrl)} disabled={isLoading || progress.show}>Try a sample {platform} video →</button></p>

          {isLoading && (
            <div className="skeleton show" role="status" aria-label="Fetching media details">
              <div className="sk sk-thumb"></div>
              <div className="sk-lines">
                <div className="sk sk-line w40"></div><div className="sk sk-line w70"></div><div className="sk sk-line w55"></div>
                <div className="sk sk-btn"></div><div className="sk sk-btn"></div>
              </div>
            </div>
          )}

          {result && !isLoading && (
            <div className="result show">
              <div className="result-card">
                <div>
                  <div className="preview-box" style={{ aspectRatio: '9/16' }}>
                    {result.thumbnail ? <img className="cover" src={result.thumbnail} alt="Cover" /> : <div style={{ background: 'var(--bg-3)', width: '100%', height: '100%' }}></div>}
                    <span className="preview-label">Cover image</span>
                  </div>
                </div>
                <div>
                  <div className="source"><span>{result.platform} {result.isImage ? 'Photo' : 'Video'}</span></div>
                  <h3 className="r-title">{result.title}</h3>
                  <p className="r-author">@{result.author}</p>
                  
                  <div className="dl-actions">
                    {result.platform === 'YouTube' ? (
                      <button className="btn dl-btn primary" onClick={() => startDownload('hd')} disabled={progress.show}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13A1.5 1.5 0 0 0 20 19.5V17"/></svg>
                        <span className="grow"><span className="label">Download Video</span><span className="sub">Available format</span></span>
                        <span className="tag">MP4</span>
                      </button>
                    ) : (
                      <>
                        <button className="btn dl-btn primary" onClick={() => startDownload('hd')} disabled={progress.show}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13A1.5 1.5 0 0 0 20 19.5V17"/></svg>
                          <span className="grow">
                            <span className="label">
                              {result.platform === 'Instagram'
                                ? result.isImage ? 'Download Photo' : 'Download Video'
                                : 'Download HD'}
                            </span>
                            <span className="sub">
                              {result.platform === 'Instagram'
                                ? result.isImage ? 'Full size' : 'Best quality'
                                : 'Available video'}
                            </span>
                          </span>
                          <span className="tag">{result.isImage ? 'JPG' : 'MP4'}</span>
                        </button>
                        {result.downloads?.sd && (
                        <button className="btn dl-btn" onClick={() => startDownload('sd')} disabled={progress.show}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13A1.5 1.5 0 0 0 20 19.5V17"/></svg>
                          <span className="grow"><span className="label">Download SD</span><span className="sub">Smaller file</span></span>
                          <span className="tag">MP4</span>
                        </button>
                        )}
                        {result.downloads?.mp3 && (
                          <button className="btn dl-btn" onClick={() => startDownload('mp3')} disabled={progress.show}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>
                            <span className="grow"><span className="label">Download MP3</span><span className="sub">Audio only</span></span>
                            <span className="tag">MP3</span>
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {progress.show && (
                    <div className="progress-wrap show" role="status" aria-live="polite" style={{ marginTop: '14px' }}>
                      <div className="progress-top"><span>{progress.label}</span></div>
                      <div className={`progress ${progress.pct === null ? 'indeterminate' : ''}`}>
                        <i style={{ width: progress.pct !== null ? `${progress.pct}%` : '35%' }}></i>
                      </div>
                    </div>
                  )}

                  <button className="again" disabled={progress.show} onClick={() => { updateUrl(''); setProgress({show: false, label: '', pct: 0}); }}>↺&nbsp; Download another video</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {history.length > 0 && (
          <section className="wrap" style={{ display: 'block' }}>
            <div className="section-row">
              <div><div className="kicker">On this device</div><h2 style={{ marginBottom: 0 }}>Recent downloads</h2></div>
              <button className="clear-hist" onClick={() => { setHistory([]); try { localStorage.removeItem('luna-history'); } catch { /* Storage is optional. */ } }}>Clear history</button>
            </div>
            <div className="history-grid">
              {history.map((item, i) => (
                <button key={i} className="hist-card" disabled={isLoading || progress.show} onClick={() => { updateUrl(item.url); showToast('Link restored — fetch it again for fresh download links.'); window.scrollTo({top: 0, behavior: 'smooth'}); }}>
                  {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <div style={{ aspectRatio: '4/3', background: 'var(--bg-3)' }}></div>}
                  <div className="hc-body">
                    <div className="hc-title">{item.title}</div>
                    <div className="hc-meta">{item.platform} · Tap to fetch again</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section id="how" className="wrap">
          <div className="section-head">
            <div className="kicker" dangerouslySetInnerHTML={{__html: t.howKicker}} />
            <h2 dangerouslySetInnerHTML={{__html: t.howTitle}} />
            <p dangerouslySetInnerHTML={{__html: t.howSub}} />
          </div>
          <div className="steps">
            <article className="card">
              <div className="step-top"><span className="icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/></svg></span><span className="step-no">01</span></div>
              <h3>Copy the link</h3>
              <p>Open the app, tap <strong style={{color:'var(--text)'}}>Share</strong> on the video, then choose <strong style={{color:'var(--text)'}}>Copy link</strong>.</p>
            </article>
            <article className="card">
              <div className="step-top"><span className="icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="8" y="2.5" width="8" height="4" rx="1.5"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5v14A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5v-14A1.5 1.5 0 0 1 5.5 4H8"/><path d="M9 12h6M9 16h4"/></svg></span><span className="step-no">02</span></div>
              <h3>Paste it in LUNA</h3>
              <p>Tap <strong style={{color:'var(--text)'}}>Paste</strong> — LUNA detects the platform and finds the link even inside a share message. Then tap Download.</p>
            </article>
            <article className="card">
              <div className="step-top"><span className="icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13A1.5 1.5 0 0 0 20 19.5V17"/></svg></span><span className="step-no">03</span></div>
              <h3>Download</h3>
              <p>Choose one of the available download formats and save it to your device.</p>
            </article>
          </div>
        </section>

        <section className="wrap">
          <div className="section-head">
            <div className="kicker">Why LUNA</div>
            <h2 dangerouslySetInnerHTML={{__html: t.featuresTitle}} />
            <p>Everything you need, nothing in your way.</p>
          </div>
          <div className="features">
            <article className="card"><span className="icon moon"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2Z"/></svg></span><h3>Fast</h3><p>See progress as available media downloads to your device.</p></article>
            <article className="card"><span className="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9.5 5 2.5-5 2.5v-5Z" fill="currentColor" stroke="none"/></svg></span><h3>HD quality</h3><p>Choose from the formats made available by the source.</p></article>
            <article className="card"><span className="icon moon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 3c2.5 3.2 6 7.3 6 11a6 6 0 1 1-12 0c0-3.7 3.5-7.8 6-11Z"/><path d="m4 4 16 16"/></svg></span><h3>No watermark</h3><p>Clean downloads when the source provides a version without a watermark.</p></article>
            <article className="card"><span className="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg></span><h3>MP3 converter</h3><p>Download audio when an audio format is available for the link.</p></article>
            <article className="card"><span className="icon moon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg></span><h3>Works everywhere</h3><p>Use LUNA from your browser on mobile or desktop.</p></article>
            <article className="card"><span className="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 3 5 5.8v5.4c0 4.6 3 7.9 7 9.3 4-1.4 7-4.7 7-9.3V5.8L12 3Z"/><path d="m9.2 11.8 2 2 3.6-3.9"/></svg></span><h3>Private by design</h3><p>No LUNA account is needed. Link history stays in your browser; links may be sent to lookup services.</p></article>
          </div>
        </section>

        <section id="supported" className="wrap">
          <div className="section-head">
            <div className="kicker">One bar, many places</div>
            <h2>Supported sites</h2>
            <p>Built for TikTok, Instagram & YouTube.</p>
          </div>
          <div className="supported-grid">
            <span className="chip"><strong>TikTok</strong></span><span className="chip"><strong>Instagram</strong></span>
            <span className="chip"><strong>YouTube</strong></span>
          </div>
          <p style={{ textAlign: 'center', color: 'var(--faint)', fontSize: '.85rem', marginTop: '18px' }}>All names above are trademarks of their respective owners. LUNA is not affiliated with any of them.</p>
        </section>

        <section id="faq" className="wrap">
          <div className="section-head">
            <div className="kicker">Good to know</div>
            <h2 dangerouslySetInnerHTML={{__html: t.faqTitle}} />
            <p>Quick answers to the things people ask most.</p>
          </div>
          <div className="faq">
            {[
              { q: "Is LUNA really free?", a: "Yes — free, with no sign-up, no app install and no daily limits. It runs entirely in your browser plus a small open backend you can even host yourself." },
              { q: "Is it safe?", a: "Yes. LUNA never asks for your TikTok or Instagram password — any site that does is a red flag. We also don't store downloaded videos." },
              { q: "Where are my files saved?", a: "Your device's default download location. On Android that's usually Downloads or your gallery; on iPhone check the Files app → Downloads." },
              { q: "Why did my YouTube link fail?", a: "YouTube has strict bot protection. If it fails, try a different video, or contact us via WhatsApp." },
              { q: "Can I download private videos?", a: "Availability depends on the source and server configuration. Only download media you have permission to save." },
              { q: "Can I install LUNA like an app?", a: "You can add LUNA to your home screen using your browser’s Share or menu options." }
            ].map((item, i) => (
              <div key={i} className={`faq-item ${openFaq === i ? 'open' : ''}`}>
                <button className="faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  {item.q}<span className="chev"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m6 9 6 6 6-6"/></svg></span>
                </button>
                <div className="faq-a" style={{ maxHeight: openFaq === i ? '250px' : '0px' }}>
                  <p>{item.a}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="cta">
            <h2>Ready when you are 🌙</h2>
            <p>Your next favourite video is one paste away. Free, in HD, no sign-up.</p>
            <div className="cta-btns">
              <button className="btn btn-top" onClick={() => window.scrollTo({top:0, behavior:'smooth'})}>↑&nbsp; Paste a link</button>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <div className="footer-grid">
            <div>
              <a className="logo" href="#"><span className="crescent"><svg width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M20.2 14.2A8.5 8.5 0 1 1 9.8 3.8a7 7 0 1 0 10.4 10.4Z" fill="#FFE9A8"/></svg></span><span>LUNA</span></a>
              <p className="footer-note">A simple, free way to save TikTok, Instagram and YouTube videos in HD — plus MP3s.</p>
              <div className="status-line"><span className="status-dot online"></span><span>Downloads depend on source availability</span></div>
            </div>
            <nav className="footer-links">
              <button onClick={() => setShowPrivacy(true)}>Privacy</button>
              <button onClick={() => setShowTerms(true)}>Terms</button>
              <button onClick={() => setShowContact(true)}>Contact</button>
            </nav>
          </div>
          <div className="legal">
            <span>© 2024 LUNA. All rights reserved.</span>
            <span>LUNA is not affiliated with TikTok, Instagram, YouTube or any platform listed.</span>
          </div>
        </div>
      </footer>

      {toast && <div className="toast show" role="status">{toast}</div>}

      {showPrivacy && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,12,.72)', backdropFilter: 'blur(6px)', zIndex: 100, display: 'grid', placeItems: 'center' }}>
          <div style={{ background: '#14182E', border: '1px solid var(--border-strong)', borderRadius: '24px', padding: '28px', maxWidth: '500px', width: '90%' }}>
            <h3 style={{ marginTop: 0 }}>Privacy</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>LUNA is designed to collect as little as possible. No LUNA account is needed. Link history stays in your browser; links may be sent to lookup services.</p>
            <button onClick={() => setShowPrivacy(false)} style={{ background: 'var(--moon)', color: '#1B1606', border: 0, padding: '12px', borderRadius: '12px', fontWeight: 800, width: '100%', marginTop: '18px', cursor: 'pointer' }}>Got it</button>
          </div>
        </div>
      )}
      {showTerms && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,12,.72)', backdropFilter: 'blur(6px)', zIndex: 100, display: 'grid', placeItems: 'center' }}>
          <div style={{ background: '#14182E', border: '1px solid var(--border-strong)', borderRadius: '24px', padding: '28px', maxWidth: '500px', width: '90%' }}>
            <h3 style={{ marginTop: 0 }}>Terms</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>Only download videos you own or have permission to save. Respect creators&apos; copyright.</p>
            <button onClick={() => setShowTerms(false)} style={{ background: 'var(--moon)', color: '#1B1606', border: 0, padding: '12px', borderRadius: '12px', fontWeight: 800, width: '100%', marginTop: '18px', cursor: 'pointer' }}>Got it</button>
          </div>
        </div>
      )}
      {showContact && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,12,.72)', backdropFilter: 'blur(6px)', zIndex: 100, display: 'grid', placeItems: 'center' }}>
          <div style={{ background: '#14182E', border: '1px solid var(--border-strong)', borderRadius: '24px', padding: '28px', maxWidth: '500px', width: '90%', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0 }}>Contact</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>For a link that isn’t working, message us on WhatsApp and send us the video link:</p>
            <a href={`https://wa.me/${WHATSAPP_NUM}`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', background: '#25D366', color: '#fff', padding: '12px 24px', borderRadius: '50px', fontWeight: 'bold', textDecoration: 'none', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              Chat on WhatsApp
            </a>
            <button onClick={() => setShowContact(false)} style={{ background: 'var(--moon)', color: '#1B1606', border: 0, padding: '12px', borderRadius: '12px', fontWeight: 800, width: '100%', marginTop: '18px', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
