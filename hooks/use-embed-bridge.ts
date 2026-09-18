"use client";

import { useEffect } from "react";

export function useEmbedBridge(embedded: boolean, url: string, pause: () => void) {
  useEffect(() => {
    if (!embedded || window.parent === window) return;
    const parentOrigin = new URL(url).searchParams.get("parentOrigin");
    if (!parentOrigin) return;
    try {
      const parent = new URL(parentOrigin);
      if (!["https:", "http:"].includes(parent.protocol) || parent.origin !== parentOrigin) return;
    } catch { return; }
    const instrument = document.querySelector("main.instrument");
    const resize = () => {
      if (instrument) window.parent.postMessage({ type: "textured:resize", height: instrument.getBoundingClientRect().height }, parentOrigin);
    };
    const connect = () => {
      window.parent.postMessage({ type: "textured:ready" }, parentOrigin);
      resize();
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      if (event.data?.type === "textured:connect") { connect(); return; }
      if (event.data?.type !== "textured:pause") return;
      pause();
    };
    window.addEventListener("message", receive);
    const observer = new ResizeObserver(resize);
    if (instrument) observer.observe(instrument);
    connect();
    return () => { window.removeEventListener("message", receive); observer.disconnect(); };
  }, [embedded, url, pause]);
}
