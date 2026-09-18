"use client";

import { useEffect, useRef, useState } from "react";
import type { SynthEngine } from "@/lib/synth";

export function Scope({
  engine,
  playing,
}: {
  engine: SynthEngine | null;
  playing: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [peak, setPeak] = useState("−∞");
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let frame = 0,
      last = 0;
    const data = new Uint8Array(2048);
    const resize = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.round(r.width * dpr);
      el.height = Math.round(r.height * dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const render = (stamp: number) => {
      frame = requestAnimationFrame(render);
      const w = el.width,
        h = el.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = playing ? "#f06b3c" : "#787b72";
      ctx.lineWidth = 2 * (window.devicePixelRatio > 1 ? 1.5 : 1);
      ctx.beginPath();
      let amplitude = 0;
      if (engine?.analyser && playing) {
        engine.analyser.getByteTimeDomainData(data);
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          amplitude = Math.max(amplitude, Math.abs(v));
          const x = (i / (data.length - 1)) * w,
            y = h * 0.5 + v * h * 0.43;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
      }
      ctx.stroke();
      if (stamp - last > 250) {
        setPeak(
          amplitude > 0.0001 ? (20 * Math.log10(amplitude)).toFixed(1) : "−∞",
        );
        last = stamp;
      }
    };
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [engine, playing]);
  return (
    <>
      <div className="scope-head">
        <span className="eyebrow">Output</span>
        <output
          className={`standby ${playing ? "active" : ""}`}
          aria-label="Audio output level"
        >
          {playing ? `${peak} dBFS` : "Standby"}
        </output>
      </div>
      <div className="scope">
        <canvas ref={canvas} role="img" aria-label="Live audio waveform" />
        {!playing && <span className="scope-hint">Press play to listen</span>}
        <div className="scope-scale">
          <span>−1.0</span>
          <span>0</span>
          <span>+1.0</span>
        </div>
      </div>
    </>
  );
}
