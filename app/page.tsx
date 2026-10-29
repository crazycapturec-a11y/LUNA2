/* eslint-disable @next/next/no-img-element */
'use client';

import { useState, useEffect, useRef } from 'react';

export default function Home() {
  const [platform, setPlatform] = useState<'TikTok' | 'Instagram'>('TikTok');
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showSupport, setShowSupport] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showContact, setShowContact] = useState(false);

  // YOUR WHATSAPP NUMBER
  const WHATSAPP_NUM = "94742108549";

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

  const saveToHistory = (item: any) => {
    const newHist = [item, ...history.filter(h => h.url !== item.url)].slice(0, 4);
    setHistory(newHist);
    localStorage.setItem('luna-history', JSON.stringify(newHist));
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setUrl(text); setError(null); setShowSupport(false); }
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

    if (platform === 'TikTok' && !isTT) {
      setError('That link is not a TikTok link. Switch to Instagram or paste a TikTok link.');
      setIsLoading(false);
      setShowSupport(true);
      return;
    }

    if (platform === 'Instagram' && !isIG) {
      setError('That link is not an Instagram link. Switch to TikTok or paste an Instagram link.');
      setIsLoading(false);
      setShowSupport(true);
      return;
    }

    try {
      if (platform === 'Instagram') {
        const res = await fetch('/api/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch.');
        
        const newResult = {
          platform: 'Instagram',
          title: 'Instagram Video',
          author: 'Instagram Creator',
          thumbnail: '',
          hdUrl: data.mediaUrl,
          sdUrl: data.mediaUrl,
          mp3Url: null,
          url
        };
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

        const newResult = {
          platform: 'TikTok',
          title: data.data.title || 'TikTok Video',
          author: data.data.author?.unique_id || 'TikTok User',
          thumbnail: data.data.cover || '',
          hdUrl: hd,
          sdUrl: sd,
          mp3Url: music,
          url
        };
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

  const handleDownload = (mediaUrl: string | null, filename: string) => {
    if (!mediaUrl) return;
    window.location.href = `/api/proxy?url=${encodeURIComponent(mediaUrl)}&filename=${filename}`;
  };

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
            <a href="#how">How it works</a>
            <a href="#faq" className="hide-sm">FAQ</a>
          </nav>
        </div>
      </header>

      <main>
        <div className="wrap hero">
          <span className="badge"><span className="dot"></span>100% free · No sign-up needed</span>
          <h1>Download TikTok &amp; Instagram videos. <span className="grad">Free.</span></h1>
          <p className="hero-sub">Paste a link, tap Download, and save it in HD in seconds — right from your browser, on any device. MP3 included.</p>

          <div className="platform-switch" role="group" aria-label="Choose TikTok or Instagram">
            <button className={`platform-btn ${platform === 'TikTok' ? 'active' : ''}`} type="button" onClick={() => { setPlatform('TikTok'); setResult(null); setError(null); setShowSupport(false); }}>
              <span>TikTok</span><small>Videos</small>
            </button>
            <button className={`platform-btn ${platform === 'Instagram' ? 'active' : ''}`} type="button" onClick={() => { setPlatform('Instagram'); setResult(null); setError(null); setShowSupport(false); }}>
              <span>Instagram</span><small>Reels &amp; Videos</small>
            </button>
          </div>
          <p className="platform-hint">{platform} selected — paste a {platform} link below.</p>

          <form className="downloader" onSubmit={handleSubmit}>
            <div className="bar">
              <div className="field">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>
                <input 
                  type="text" 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={`Paste a ${platform} link here…`} 
                />
                <button type="button" className="btn btn-paste" onClick={handlePaste}>Paste</button>
              </div>
              <button type="submit" className="btn btn-download" disabled={isLoading}>
                {isLoading ? 'Fetching...' : 'Download'}
              </button>
            </div>
          </form>

          {error && <div className="msg error" style={{ display: 'block' }}>{error}</div>}
          {!error && result && <div className="msg ok" style={{ display: 'block' }}>Video found — choose your quality below.</div>}

          {showSupport && (
            <div className="support-card" style={{ display: 'flex' }}>
              <div>
                <strong>Link isn’t working?</strong>
                <p>Tap the WhatsApp logo and send us the link — we’ll help you.</p>
              </div>
              <a className="wa-logo-btn" href={`https://wa.me/${WHATSAPP_NUM}?text=Hi%2C%20my%20LUNA%20link%20isn%27t%20working.%0ALink:%20${encodeURIComponent(url)}%0AError:%20${encodeURIComponent(error || '')}`} target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp" title="Chat on WhatsApp">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              </a>
            </div>
          )}

          <div className="trust">
            <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>No sign-up</span><span className="sep">·</span>
            <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>HD quality</span><span className="sep">·</span>
            <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>Works on any device</span><span className="sep">·</span>
            <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>MP3 converter</span>
          </div>
          <p className="permission"><strong>Please note:</strong> Only download videos you have permission to save.</p>

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
                    <button className="btn dl-btn primary" onClick={() => handleDownload(result.hdUrl, 'luna-hd.mp4')}>
                      <span className="grow"><span className="label">Download HD</span><span className="sub">No watermark</span></span>
                      <span className="tag">MP4</span>
                    </button>
                    <button className="btn dl-btn" onClick={() => handleDownload(result.sdUrl, 'luna-sd.mp4')}>
                      <span className="grow"><span className="label">Download SD</span><span className="sub">Smaller file</span></span>
                      <span className="tag">MP4</span>
                    </button>
                    {result.mp3Url && (
                      <button className="btn dl-btn" onClick={() => handleDownload(result.mp3Url, 'luna-audio.mp3')}>
                        <span className="grow"><span className="label">Download MP3</span><span className="sub">Audio only</span></span>
                        <span className="tag">MP3</span>
                      </button>
                    )}
                  </div>
                  <button className="again" onClick={() => { setResult(null); setUrl(''); }}>↺&nbsp; Download another video</button>
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
          <div className="section-head"><div className="kicker">Simple by design</div><h2>How it works</h2></div>
          <div className="steps">
            <article className="card"><div className="step-top"><span className="icon">📋</span><span className="step-no">01</span></div><h3>Copy the link</h3><p>Open TikTok or Instagram, tap Share on the video, then choose Copy link.</p></article>
            <article className="card"><div className="step-top"><span className="icon">📥</span><span className="step-no">02</span></div><h3>Paste it in LUNA</h3><p>Tap Paste — LUNA finds the link and fetches the video automatically.</p></article>
            <article className="card"><div className="step-top"><span className="icon">✨</span><span className="step-no">03</span></div><h3>Download</h3><p>Preview it, then choose HD, SD or MP3. The file saves straight to your device.</p></article>
          </div>
        </section>

        <section id="faq" className="wrap">
          <div className="section-head"><div className="kicker">Good to know</div><h2>Frequently asked questions</h2></div>
          <div className="faq">
            {[
              { q: "Is LUNA really free?", a: "Yes — free, with no sign-up, no app install and no daily limits." },
              { q: "Is it safe?", a: "Yes. LUNA never asks for your TikTok or Instagram password. Files stream directly and are not stored on our server." },
              { q: "Where are my files saved?", a: "Your device's default download location (usually the Downloads folder or Gallery)." },
              { q: "Can I download private videos?", a: "No. LUNA only works with public videos, by design." }
            ].map((item, i) => (
              <div key={i} className={`faq-item ${openFaq === i ? 'open' : ''}`}>
                <button className="faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  {item.q}<span className="chev"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m6 9 6 6 6-6"/></svg></span>
                </button>
                <div className="faq-a" style={{ maxHeight: openFaq === i ? '200px' : '0px' }}>
                  <p>{item.a}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <div className="footer-grid">
            <div>
              <a className="logo" href="#"><span className="crescent"><svg width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M20.2 14.2A8.5 8.5 0 1 1 9.8 3.8a7 7 0 1 0 10.4 10.4Z" fill="#FFE9A8"/></svg></span><span>LUNA</span></a>
              <p className="footer-note">A simple, free way to save TikTok and Instagram videos in HD. Only download videos you have permission to save.</p>
            </div>
            <nav className="footer-links">
              <button onClick={() => setShowPrivacy(true)}>Privacy</button>
              <button onClick={() => setShowTerms(true)}>Terms</button>
              <button onClick={() => setShowContact(true)}>Contact</button>
            </nav>
          </div>
          <div className="legal">
            <span>© 2024 LUNA. All rights reserved.</span>
            <span>LUNA is not affiliated with TikTok or Instagram.</span>
          </div>
        </div>
      </footer>

      {/* MODALS */}
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
            <p style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>Only download videos you own or have permission to save. Respect creators' copyright. LUNA does not host any videos.</p>
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
