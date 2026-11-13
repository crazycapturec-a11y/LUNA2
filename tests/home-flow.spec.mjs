import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://test.local/' });
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
dom.window.scrollTo = () => {};
const React = await import('react');
const { render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const { default: Home } = await import('../app/page.tsx');

test('share text auto-selects its platform and the real lookup drives the steps', async (t) => {
  localStorage.clear();
  t.after(cleanup);
  let resolveRequest;
  const fetchMock = t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { resolveRequest = resolve; }));
  render(React.createElement(Home));
  const input = screen.getByRole('textbox', { name: 'Video link or share text' });
  fireEvent.change(input, { target: { value: 'Look at this https://vt.tiktok.com/ZSpC8nYxp/ 🎬' } });
  assert.ok(screen.getByText('TikTok link detected'));
  fireEvent.click(screen.getByRole('button', { name: 'Download', exact: true }));
  await waitFor(() => assert.equal(fetchMock.mock.callCount(), 1));
  assert.equal(fetchMock.mock.calls[0].arguments[0], '/api/tiktok/info?url=https%3A%2F%2Fvt.tiktok.com%2FZSpC8nYxp%2F');
  assert.equal(screen.getByText('Fetch').getAttribute('aria-current'), 'step');
  assert.equal(input.disabled, true);
  resolveRequest(Response.json({ title: 'Test video', author: 'creator', downloadUrls: { hd: '/api/proxy?url=valid', sd: null, mp3: null } }));
  await screen.findByRole('heading', { name: 'Test video' });
  assert.equal(screen.getByText('Download', { selector: 'li' }).getAttribute('aria-current'), 'step');
  assert.ok(screen.getByRole('button', { name: /Download HD/ }));
  assert.equal(screen.queryByRole('button', { name: /Download SD/ }), null);
  const stored = JSON.parse(localStorage.getItem('luna-history'));
  assert.equal(stored[0].url, 'https://vt.tiktok.com/ZSpC8nYxp/');
  assert.equal(stored[0].downloads, undefined);
});

test('switches platform from pasted URL and restores history without reusing expired download links', async (t) => {
  localStorage.setItem('luna-history', JSON.stringify([{ platform: 'Instagram', title: 'Old reel', url: 'https://www.instagram.com/reel/ABC123/', downloads: { hd: '/expired' } }]));
  t.after(cleanup);
  render(React.createElement(Home));
  fireEvent.click(screen.getByRole('button', { name: /Old reel/ }));
  assert.equal(screen.getByRole('button', { name: /Instagram Reels/ }).getAttribute('aria-pressed'), 'true');
  assert.equal(screen.queryByRole('button', { name: /Download Video/ }), null);
  assert.ok(screen.getByText(/fetch it again for fresh download links/i));
  const input = screen.getByRole('textbox', { name: 'Video link or share text' });
  fireEvent.change(input, { target: { value: 'https://youtu.be/cpUxjLKPkLI' } });
  assert.equal(screen.getByRole('button', { name: /YouTube HD Video/ }).getAttribute('aria-pressed'), 'true');
  assert.ok(screen.getByText('YouTube link detected'));
});

test('rejects deceptive links without making a lookup', async (t) => {
  localStorage.clear();
  t.after(cleanup);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected'); });
  render(React.createElement(Home));
  fireEvent.change(screen.getByRole('textbox', { name: 'Video link or share text' }), { target: { value: 'https://tiktok.com.evil.example/video' } });
  fireEvent.click(screen.getByRole('button', { name: 'Download', exact: true }));
  assert.ok(screen.getByRole('alert').textContent.includes('TikTok, Instagram or YouTube'));
  assert.equal(fetchMock.mock.callCount(), 0);
});
