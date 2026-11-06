/* eslint-disable @next/next/no-img-element */
'use client';

import { useState, useEffect } from 'react';

const I18N: any = {
  en: { name: "English", navHow: "How it works", navFaq: "FAQ", badge: "100% free · No sign-up needed",
    heroTitle: 'Download TikTok, Instagram & YouTube. <span class="grad">Free.</span>',
    heroSub: "Paste a link, tap Download, and save it in HD in seconds — right from your browser, on any device.",
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
  const [platform, setPlatform] = useState<'TikTok' | 'Instagram' | 'YouTube'>('TikTok');
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
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
    const saved = localStorage.getItem('luna-history');
    if (saved) setHistory(JSON.parse(saved));
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3400);
  };

  const saveToHistory = (item: any) => {
    const newHist = [item, ...history.filter(h => h.url !== item.url)].slice(0, 4);
    setHistory(newHist);
    localStorage.setItem('luna-history', JSON.stringify(newHist));
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setUrl(text); setError(null); setShowSupport(false); showToast('Link pasted ✓'); }
    } catch (err) { setError('Tap and hold the bar to paste.'); }
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

    const isIG = url.includes('instagram.com');
    const isTT = url.includes('tiktok.com');
    const isYT = url.includes('youtube.com') || url.includes('youtu.be');

    if (platform === 'TikTok' && !isTT) {
      setError('That link is not a TikTok link.'); setIsLoading(false); setShowSupport(true); return;
    }
    if (platform === 'Instagram' && !isIG) {
      setError('That link is not an Instagram link.'); setIsLoading(false); setShowSupport(true); return;
    }
    if (platform === 'YouTube' && !isYT) {
      setError('That link is not a YouTube link.'); setIsLoading(false); setShowSupport(true); return;
    }

    try {
      if (platform === 'YouTube') {
        const res = await fetch(`/api/youtube/info?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch YouTube video.');
        
        const newResult = {
          platform: 'YouTube',
          title: data.title,
          author: data.author,
          thumbnail: data.thumbnail,
          url
        };
        setResult(newResult);
        saveToHistory(newResult);
      } else if (platform === 'Instagram') {
        const res = await fetch('/api/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch Instagram media.');
        
        const newResult = { platform: 'Instagram', title: 'Instagram Video', author: 'Instagram Creator', thumbnail: '', hdUrl: data.mediaUrl, sdUrl: data.mediaUrl, mp3Url: null, url };
        setResult(newResult);
        saveToHistory(newResult);
      } else {
        const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.code !== 0 || !data.data) throw new Error('Could not extract TikTok video.');
        
        let hd = data.data.hdplay || data.data.play;
        let sd = data.data.play;
        let music = data.data.music;
        if (hd.indexOf('//') === 0) hd = 'https:' + hd;
        if (sd.indexOf('//') === 0) sd = 'https:' + sd;
        if (music && music.indexOf('//') === 0) music = 'https:' + music;

        const newResult = { platform: 'TikTok', title: data.data.title || 'TikTok Video', author: data.data.author?.unique_id || 'TikTok User', thumbnail: data.data.cover || '', hdUrl: hd, sdUrl: sd, mp3Url: music, url };
        setResult(newResult);
        saveToHistory(newResult);
      }
    } catch (err: any) {
      setError(err.message);
      setShowSupport(true);
    } finally {
      setIsLoading(false);
    }
  };

  const downloadFile = async (mediaUrl: string | null, filename: string, label: string) => {
    if (!mediaUrl) return;
    setProgress({ show: true, label: `Preparing ${label}...`, pct: null });
    try {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(mediaUrl)}&filename=${filename}`;
      const resp = await fetch(proxyUrl);
      if (!resp.ok) throw new Error('Download failed');
      
      const total = +resp.headers.get('Content-Length')! || 0;
      if (!resp.body || !resp.body.getReader) { window.location.href = proxyUrl; return; }

      const reader = resp.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) {
          const pct = (received / total) * 100;
          setProgress({ show: true, label: `Downloading ${label}... ${pct.toFixed(0)}%`, pct });
        } else {
          setProgress({ show: true, label: `Downloading ${label}...`, pct: null });
        }
      }

      const blob = new Blob(chunks, { type: resp.headers.get('Content-Type') || 'application/octet-stream' });
      const objUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(objUrl);
      
      setProgress({ show: true, label: 'Saved ✓ Check your Downloads folder.', pct: 100 });
      showToast(`${label} download saved ✓`);
    } catch (err) {
      showToast('Download failed. Try again.');
    } finally {
      setTimeout(() => setProgress({ show: false, label: '', pct: 0 }), 2600);
    }
  };

  const handleYouTubeDownload = async () => {
    if (!result || !result.url) return;
    setProgress({ show: true, label: 'Fetching YouTube video link...', pct: null });
    try {
      const res = await fetch(`/api/youtube/download?url=${encodeURIComponent(result.url)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch');
      
      // Now download the direct video URL using our proxy
      downloadFile(data.mediaUrl, 'youtube-video.mp4', 'YouTube Video');
    } catch (err) {
      showToast('Failed to fetch YouTube video.');
      setProgress({ show: false, label: '', pct: 0 });
    }
  };

  const prep = platform === 'Instagram' ? 'an' : 'a';
  const placeholder = t.placeholder.replace('TikTok, Instagram, or YouTube', platform);
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
              <button className="lang-btn" onClick={() => setIsLangOpen(!isLangOpen)}>
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
          <span className="badge"><span className="dot"></span><span dangerouslySetInnerHTML={{__html: t.badge}} /></span>
          <h1 dangerouslySetInnerHTML={{__html: t.heroTitle}} />
          <p className="hero-sub">{t.heroSub}</p>

          <div className="platform-switch" role="group" aria-label="Choose platform">
            <button className={`platform-btn ${platform === 'TikTok' ? 'active' : ''}`} data-platform="TikTok" type="button" onClick={() => { setPlatform('TikTok'); setResult(null); setError(null); setShowSupport(false); }}>
              <span>TikTok</span><small>Videos</small>
            </button>
            <button className={`platform-btn ${platform === 'Instagram' ? 'active' : ''}`} data-platform="Instagram" type="button" onClick={() => { setPlatform('Instagram'); setResult(null); setError(null); setShowSupport(false); }}>
              <span>Instagram</span><small>Reels</small>
            </button>
            <button className={`platform-btn ${platform === 'YouTube' ? 'active' : ''}`} data-platform="YouTube" type="button" onClick={() => { setPlatform('YouTube'); setResult(null); setError(null); setShowSupport(false); }}>
              <span>YouTube</span><small>HD Video</small>
            </button>
          </div>
          <p className="platform-hint">{platform} selected — paste {prep} {platform} link below.</p>

          <form className="downloader" onSubmit={handleSubmit}>
            <div className="bar">
              <div className="field">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>
                <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={placeholder} />
                <button type="button" className="btn btn-paste" onClick={handlePaste}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="8" y="2.5" width="8" height="4" rx="1.5"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5v14A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5v-14A1.5 1.5 0 0 1 5.5 4H8"/></svg>
                  {t.paste}
                </button>
              </div>
              <button type="submit" className="btn btn-download" disabled={isLoading}>
                {isLoading ? 'Fetching...' : (
                  <>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13A1.5 1.5 0 0 0 20 19.5V17"/></svg>
                    {t.download}
                  </>
                )}
              </button>
            </div>
          </form>

          {error && <div className="msg error" style={{ display: 'block' }}>{error}</div>}
          {!error && result && <div className="msg ok" style={{ display: 'block' }}>Video found — choose your quality below.</div>}

          {showSupport && (
            <div className="support-card" style={{ display: 'flex' }}>
              <div><strong>Link isn’t working?</strong><p>Tap the WhatsApp logo and send us the link — we’ll help you.</p></div>
              <a className="wa-logo-btn" href={`https://wa.me/${WHATSAPP_NUM}?text=Hi%2C%20my%20LUNA%20link%20isn%27t%20working.%0ALink:%20${encodeURIComponent(url)}%0AError:%20${encodeURIComponent(error || '')}`} target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              </a>
            </div>
          )}

          <div className="trust" aria-label="Highlights">
            <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>{t.trust1}</span><span className="sep">·</span>
            <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>{t.trust2}</span><span className="sep">·</span>
            <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>{t.trust3}</span><span className="sep">·</span>
            <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>MP3 converter</span>
          </div>
          <p className="permission" dangerouslySetInnerHTML={{__html: t.permission}} />
          <p className="sample-line">No link handy? <button type="button" onClick={() => setUrl(sampleUrl)}>Try a sample {platform} video →</button></p>

          {isLoading && (
            <div className="skeleton show">
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
                    <button className="play-overlay" type="button">
                      <span className="play-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5Z"/></svg></span>
                    </button>
                  </div>
                </div>
                <div>
                  <div className="source"><span>{result.platform} Video</span></div>
                  <h3 className="r-title">{result.title}</h3>
                  <p className="r-author">@{result.author}</p>
                  
                  <div className="dl-actions">
                    {result.platform === 'YouTube' ? (
                      <button className="btn dl-btn primary" onClick={handleYouTubeDownload}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13A1.5 1.5 0 0 0 20 19.5V17"/></svg>
                        <span className="grow"><span className="label">Download Video</span><span className="sub">Highest Quality</span></span>
                        <span className="tag">MP4</span>
                      </button>
                    ) : (
                      <>
                        <button className="btn dl-btn primary" onClick={() => downloadFile(result.hdUrl, 'luna-hd.mp4', 'HD')}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13A1.5 1.5 0 0 0 20 19.5V17"/></svg>
                          <span className="grow"><span className="label">Download HD</span><span className="sub">No watermark</span></span>
                          <span className="tag">MP4</span>
                        </button>
                        <button className="btn dl-btn" onClick={() => downloadFile(result.sdUrl, 'luna-sd.mp4', 'SD')}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13A1.5 1.5 0 0 0 20 19.5V17"/></svg>
                          <span className="grow"><span className="label">Download SD</span><span className="sub">Smaller file</span></span>
                          <span className="tag">MP4</span>
                        </button>
                        {result.mp3Url && (
                          <button className="btn dl-btn" onClick={() => downloadFile(result.mp3Url, 'luna-audio.mp3', 'MP3')}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>
                            <span className="grow"><span className="label">Download MP3</span><span className="sub">Audio only</span></span>
                            <span className="tag">MP3</span>
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {progress.show && (
                    <div className="progress-wrap show" style={{ marginTop: '14px' }}>
                      <div className="progress-top"><span>{progress.label}</span></div>
                      <div className={`progress ${progress.pct === null ? 'indeterminate' : ''}`}>
                        <i style={{ width: progress.pct !== null ? `${progress.pct}%` : '35%' }}></i>
                      </div>
                    </div>
                  )}

                  <button className="again" onClick={() => { setResult(null); setUrl(''); setProgress({show: false, label: '', pct: 0}); }}>↺&nbsp; Download another video</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {history.length > 0 && (
          <section className="wrap" style={{ display: 'block' }}>
            <div className="section-row">
              <div><div className="kicker">On this device</div><h2 style={{ marginBottom: 0 }}>Recent downloads</h2></div>
              <button className="clear-hist" onClick={() => { setHistory([]); localStorage.removeItem('luna-history'); }}>Clear history</button>
            </div>
            <div className="history-grid">
              {history.map((item, i) => (
                <button key={i} className="hist-card" onClick={() => { setUrl(item.url); setResult(item); setPlatform(item.platform); window.scrollTo({top: 0, behavior: 'smooth'}); }}>
                  {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <div style={{ aspectRatio: '4/3', background: 'var(--bg-3)' }}></div>}
                  <div className="hc-body">
                    <div className="hc-title">{item.title}</div>
                    <div className="hc-meta">{item.platform} · {new Date().toLocaleDateString()}</div>
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
              <p>Tap <strong style={{color:'var(--text)'}}>Paste</strong> — LUNA finds the link even inside messy share text and fetches the video automatically.</p>
            </article>
            <article className="card">
              <div className="step-top"><span className="icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13A1.5 1.5 0 0 0 20 19.5V17"/></svg></span><span className="step-no">03</span></div>
              <h3>Download</h3>
              <p>Preview it, then choose <strong style={{color:'var(--text)'}}>HD</strong>, <strong style={{color:'var(--text)'}}>SD</strong> or <strong style={{color:'var(--text)'}}>MP3</strong>. The file saves straight to your device.</p>
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
            <article className="card"><span className="icon moon"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2Z"/></svg></span><h3>Fast</h3><p>Real links are fetched in seconds and streamed directly — watch live progress as your file downloads.</p></article>
            <article className="card"><span className="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9.5 5 2.5-5 2.5v-5Z" fill="currentColor" stroke="none"/></svg></span><h3>HD quality</h3><p>Best available quality up to 4K when the source offers it, with audio merged automatically when needed.</p></article>
            <article className="card"><span className="icon moon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 3c2.5 3.2 6 7.3 6 11a6 6 0 1 1-12 0c0-3.7 3.5-7.8 6-11Z"/><path d="m4 4 16 16"/></svg></span><h3>No watermark</h3><p>Clean downloads wherever the source makes a clean version available — every format is listed so you can choose.</p></article>
            <article className="card"><span className="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg></span><h3>MP3 converter</h3><p>Love the sound? Extract audio as a 320 kbps MP3 in one tap — great for sounds, speeches and music clips.</p></article>
            <article className="card"><span className="icon moon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg></span><h3>Works everywhere</h3><p>iPhone, Android, Windows, Mac — nothing to install. Add LUNA to your home screen and it behaves like an app.</p></article>
            <article className="card"><span className="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 3 5 5.8v5.4c0 4.6 3 7.9 7 9.3 4-1.4 7-4.7 7-9.3V5.8L12 3Z"/><path d="m9.2 11.8 2 2 3.6-3.9"/></svg></span><h3>Private by design</h3><p>No accounts, no passwords, no stored videos. History lives only in your browser.</p></article>
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
            <span className="chip"><strong>YouTube</strong></span><span className="chip"><strong>Facebook</strong></span>
            <span className="chip"><strong>X</strong> (Twitter)</span><span className="chip"><strong>Reddit</strong></span>
            <span className="chip"><strong>Vimeo</strong></span><span className="chip"><strong>Dailymotion</strong></span>
            <span className="chip"><strong>Twitch</strong> clips</span>
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
              { q: "Can I download private videos?", a: "No — LUNA only works with public videos, by design. Please respect creators." },
              { q: "Can I install LUNA like an app?", a: "Yes. On Android/Chrome tap 'Install LUNA' when it appears. On iPhone: Share → Add to Home Screen." }
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
              <div className="status-line"><span className="status-dot online"></span><span>Server online — real downloads ready</span></div>
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

      {toast && <div className="toast show" style={{ display: 'block' }}>{toast}</div>}

      {showPrivacy && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,12,.72)', backdropFilter: 'blur(6px)', zIndex: 100, display: 'grid', placeItems: 'center' }}>
          <div style={{ background: '#14182E', border: '1px solid var(--border-strong)', borderRadius: '24px', padding: '28px', maxWidth: '500px', width: '90%' }}>
            <h3 style={{ marginTop: 0 }}>Privacy</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>LUNA is designed to collect as little as possible. No accounts, no passwords, no stored videos. History lives only in your browser.</p>
            <button onClick={() => setShowPrivacy(false)} style={{ background: 'var(--moon)', color: '#1B1606', border: 0, padding: '12px', borderRadius: '12px', fontWeight: 800, width: '100%', marginTop: '18px', cursor: 'pointer' }}>Got it</button>
          </div>
        </div>
      )}
      {showTerms && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,12,.72)', backdropFilter: 'blur(6px)', zIndex: 100, display: 'grid', placeItems: 'center' }}>
          <div style={{ background: '#14182E', border: '1px solid var(--border-strong)', borderRadius: '24px', padding: '28px', maxWidth: '500px', width: '90%' }}>
            <h3 style={{ marginTop: 0 }}>Terms</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>Only download videos you own or have permission to save. Respect creators' copyright.</p>
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
