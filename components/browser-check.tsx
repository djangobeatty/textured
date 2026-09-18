'use client';

import { useEffect, useRef } from 'react';

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  execute: (id: string) => void;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }
let scriptLoad: Promise<Turnstile> | null = null;
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(new Error('The browser check could not load. Please try again.')); }, 15000);
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => { clearTimeout(timer); if (window.turnstile) resolve(window.turnstile); else reject(new Error('The browser check could not load.')); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('The browser check could not load. Please try again.')); };
    document.querySelector('head')!.appendChild(script);
  }).catch(error => { scriptLoad = null; throw error; });
  return scriptLoad;
}

export type BrowserCheckRequest = { id: number; siteKey: string; signal: AbortSignal; resolve: (token: string) => void; reject: (error: Error) => void };

// One fresh widget/token per submitted description. Re-rendering removes any
// expired token; aborting an edit cancels its pending verification too.
export function BrowserCheck({ request }: { request: BrowserCheckRequest | null }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!request) return;
    let active = true;
    let settled = false;
    let widget: string | undefined;
    let api: Turnstile | undefined;
    const finish = (error?: Error, token?: string) => {
      if (!active || settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) request.reject(error); else request.resolve(token!);
    };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('The browser check timed out. Please try again.')), 120000);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    else void loadTurnstile().then(loaded => {
      if (!active || settled || !container.current) return;
      api = loaded;
      widget = api.render(container.current, {
        sitekey: request.siteKey, action: 'interpret', theme: 'light', size: 'flexible',
        execution: 'execute', appearance: 'interaction-only', 'response-field': false,
        callback: (token: string) => finish(undefined, token),
        'error-callback': () => { finish(new Error('The browser check failed. Please try again.')); return true; },
        'expired-callback': () => finish(new Error('The browser check expired. Please try again.')),
        'timeout-callback': () => finish(new Error('The browser check timed out. Please try again.')),
      });
      api.execute(widget);
    }).catch(error => finish(error));
    return () => {
      finish(new DOMException('Cancelled', 'AbortError'));
      active = false;
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', abort);
      if (widget !== undefined) api?.remove(widget);
    };
  }, [request]);
  return <div className="browser-check" ref={container} />;
}
