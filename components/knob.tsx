"use client";

import { useRef, useState, type CSSProperties } from "react";

export function Knob({ label, value, defaultValue, onChange }: {
  label: string;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ pointer: number; x: number; y: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (next: number) => Math.max(0, Math.min(100, next));
  const finish = () => { drag.current = null; setDragging(false); };
  return <div
    className={`dial${dragging ? " dragging" : ""}`}
    role="slider"
    tabIndex={0}
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={value}
    aria-valuetext={`${value} percent`}
    aria-orientation="vertical"
    title={`${label}: drag up or right to increase. Hold Shift for fine control. Double-click to reset.`}
    style={{ "--rotation": `${value * 2.7 - 135}deg` } as CSSProperties}
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, value };
      setDragging(true);
    }}
    onPointerMove={(event) => {
      const active = drag.current;
      if (!active || active.pointer !== event.pointerId) return;
      const delta = active.y - event.clientY + event.clientX - active.x;
      active.value = clamp(active.value + delta * (event.shiftKey ? 0.1 : 0.5));
      active.x = event.clientX;
      active.y = event.clientY;
      onChange(Math.round(active.value));
    }}
    onPointerUp={(event) => {
      if (drag.current?.pointer !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      finish();
    }}
    onPointerCancel={finish}
    onLostPointerCapture={finish}
    onDoubleClick={() => onChange(defaultValue)}
    onKeyDown={(event) => {
      const delta: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
      if (event.key in delta || event.key === "Home" || event.key === "End") {
        event.preventDefault();
        onChange(event.key === "Home" ? 0 : event.key === "End" ? 100 : clamp(value + delta[event.key]));
      }
    }}
  ><span aria-hidden="true" /></div>;
}
