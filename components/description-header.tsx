"use client";

import { useEffect, useRef, useState } from "react";
import { Link as LinkIcon } from "lucide-react";
import { shareBase, shareUrl } from "@/lib/share";

export function DescriptionHeader({ description }: { description: string }) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const share = async () => {
    const url = shareUrl(shareBase(location.href, window.parent !== window), description);
    if (timer.current) clearTimeout(timer.current);
    setCopied(false);
    setFallback("");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2200);
    } catch {
      setFallback(url);
    }
  };
  return <>
    <div className="composer-heading">
      <div className="section-heading"><span className="section-number">01</span><span>Start with words</span></div>
      <div className="share-tools">
      <button className="share-button" onClick={() => void share()} aria-live="polite">
        <LinkIcon size={16} /> {copied ? "Link copied" : "Share this sound"}
      </button>
      </div>
    </div>
    {fallback && <div className="share-fallback">
      <p role="status">Couldn’t copy automatically. Select and copy this link:</p>
      <input aria-label="Share link" type="text" value={fallback} readOnly autoFocus
        onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} />
    </div>}
  </>;
}
