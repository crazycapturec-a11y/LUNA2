/* eslint-disable @next/next/no-img-element */
'use client';

import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Result state that handles both IG and TikTok
  const [result, setResult] = useState<{
    mediaUrl: string;
    mediaType: string;
    title: string;
    author: string;
    thumbnail: string;
    platform: 'instagram' | 'tiktok';
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setResult(null);

    const isInstagram = url.includes('instagram.com');
    const isTikTok = url.includes('tiktok.com');

    if (!isInstagram && !isTikTok) {
      setError('Please paste a valid Instagram or TikTok link.');
      setIsLoading(false);
      return;
    }

    try {
      if (isInstagram) {
        // --- INSTAGRAM BACKEND LOGIC ---
        const response = await fetch('/api/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch Instagram media.');

        setResult({
          mediaUrl: data.mediaUrl,
          mediaType: data.mediaType,
          title: 'Instagram Video',
          author: 'Instagram',
          thumbnail: '', // IG doesn't provide easy thumbnail here
          platform: 'instagram',
        });

      } else if (isTikTok) {
        // --- TIKTOK API LOGIC (from your HTML file) ---
        const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        
        if (data.code !== 0 || !data.data) throw new Error('Could not extract TikTok video.');
        
        let vUrl = data.data.hdplay || data.data.play;
        if (vUrl.indexOf('//') === 0) vUrl = 'https:' + vUrl;
        
        setResult({
          mediaUrl: vUrl,
          mediaType: 'video',
          title: data.data.title || 'TikTok Video',
          author: data.data.author?.unique_id || 'TikTok User',
          thumbnail: data.data.cover || '',
          platform: 'tiktok',
        });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Forces download via our Proxy
  const handleDownload = () => {
    if (!result) return;
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(result.mediaUrl)}`;
    window.location.href = proxyUrl;
  };

  const handleClear = () => {
    setUrl('');
    setResult(null);
    setError(null);
  };

  return (
    <main>
      <nav className="nav">
        <div className="brand"><span className="crest">👑</span><b>SaveClip</b></div>
        <span className="tag">IG & TikTok • No login</span>
      </nav>

      <header className="hero">
        <span className="eyebrow">Royal quality downloads</span>
        <h1>Save any <span className="gold">Video</span> in seconds</h1>
        <p className="lead">Paste a TikTok or Instagram link, tap one button, and it's on your device.</p>

        <div className="tool">
          <div className="tool-head">
            <span>Paste your link</span>
          </div>
          <form onSubmit={handleSubmit} className="field">
            <div className="input-wrap">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.tiktok.com/... or instagram.com/..."
                required
              />
            </div>
            <button type="submit" disabled={isLoading} className="btn btn-gold">
              {isLoading ? 'Extracting...' : 'Get Video'}
            </button>
          </form>
          <p className="hint">Works with public TikTok and Instagram links.</p>
        </div>
      </header>

      <div id="result">
        {error && (
          <div className="card">
            <div className="status bad">⚠️ Error</div>
            <div style={{ padding: '20px', color: 'var(--muted)' }}>{error}</div>
          </div>
        )}

        {result && (
          <div className="card">
            <div className="status ok">✅ Ready to download</div>
            <div className="result-body">
              {result.thumbnail ? (
                <img className="thumb" src={result.thumbnail} alt="Thumbnail" referrerPolicy="no-referrer" />
              ) : (
                <div className="thumb-ph">🎵</div>
              )}
              
              <div className="meta">
                <h2>{result.title}</h2>
                <p>@{result.author} · {result.platform === 'tiktok' ? 'TikTok' : 'Instagram'}</p>
                <div className="actions">
                  <button onClick={handleDownload} className="btn btn-gold">
                    ⬇️ Save to Device
                  </button>
                  <button onClick={handleClear} className="btn" style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--gold-light)' }}>
                    ↻ Another Link
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <footer style={{ marginTop: '70px', textAlign: 'center', color: 'var(--muted)', fontSize: '.88rem' }}>
        <span style={{ display: 'block', fontSize: '1.4rem', marginBottom: '6px' }}>👑</span>
        SaveClip is not affiliated with TikTok or Instagram.
      </footer>
    </main>
  );
}