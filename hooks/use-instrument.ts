"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserCheckRequest } from "@/components/browser-check";
import type { PlayerLocation } from "@/hooks/use-player-location";
import { EXAMPLES, validPatch, type Patch, type Dimension, type Interpretation } from "@/lib/semantic";
import { SynthEngine } from "@/lib/synth";
import type { Usage } from "@/lib/quota";

// In an iframe, use a separate partitioned, HttpOnly session cookie. The
// browser still talks only to the player's own API origin.
function embedHeaders(): Record<string, string> {
  return typeof window !== "undefined" && window.parent !== window && new URLSearchParams(location.search).get("embed") === "1"
    ? { "X-Textured-Embed": "1" } : {};
}

export function useInstrument(initial: PlayerLocation) {
  const [descriptionOverride, setDescription] = useState<string | null>(null);
  const description = descriptionOverride ?? initial.description;
  const [patchOverride, setPatch] = useState<Patch | null>(null);
  const patch = patchOverride ?? initial.patch;
  const [titleOverride, setPatchTitle] = useState<string | null>(null);
  const patchTitle = titleOverride ?? initial.title;
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(40);
  const [loading, setLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const turnstileKey = useRef<string | null>(null);
  const [browserCheck, setBrowserCheck] = useState<BrowserCheckRequest | null>(null);
  const [checkingBrowser, setCheckingBrowser] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Interpretation | null>(null);
  const [sourceOverride, setSource] = useState<"live" | "manual" | null>(null);
  const source = sourceOverride ?? initial.source;
  const engineRef = useRef<SynthEngine | null>(null);
  const [engine, setEngine] = useState<SynthEngine | null>(null);
  const patchRef = useRef(patch);
  const request = useRef<{ seq: number; abort: AbortController | null }>({
    seq: 0,
    abort: null,
  });
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastApplied = useRef(initial.source === "shared" ? initial.description : EXAMPLES[0]);
  const lastAttempted = useRef("");
  const playingRef = useRef(false);
  const usageRef = useRef<Usage | null>(null);
  const statusRequest = useRef<Promise<void> | null>(null);
  const updateUsage = useCallback((next: Usage) => {
    const previous = usageRef.current;
    if (previous && previous.resetsAt > next.resetsAt) return;
    const current = previous?.resetsAt === next.resetsAt && previous.limit === next.limit
      ? { ...next, remaining: Math.min(previous.remaining, next.remaining) }
      : next;
    usageRef.current = current;
    setUsage(current);
  }, []);
  const refreshUsage = useCallback(() => {
    if (statusRequest.current) return statusRequest.current;
    statusRequest.current = fetch("/api/interpret", { cache: "no-store", headers: embedHeaders() })
      .then(async (response) => {
        const data = await response.json() as { configured?: boolean; usage?: Usage; error?: string; turnstileSiteKey?: string | null };
        if (!response.ok || !data.usage) throw new Error(data.error || "Could not check today's allowance. Please try again.");
        turnstileKey.current = data.turnstileSiteKey ?? null;
        setConfigured(!!data.configured);
        updateUsage(data.usage);
      })
      .finally(() => { statusRequest.current = null; });
    return statusRequest.current;
  }, [updateUsage]);
  const quotaExhausted = usage?.remaining === 0;
  useEffect(() => {
    patchRef.current = patch;
  }, [patch]);
  useEffect(() => {
    lastApplied.current = initial.source === "shared" ? initial.description : EXAMPLES[0];
  }, [initial.description, initial.source]);
  useEffect(() => {
    const activeRequest = request.current;
    void refreshUsage().catch((error: Error) => setError(error.message));
    return () => {
      activeRequest.abort?.abort();
      engineRef.current?.close();
    };
  }, [refreshUsage]);
  useEffect(() => {
    const refresh = () => { void refreshUsage().catch(() => {}); };
    window.addEventListener("focus", refresh);
    const timer = usage ? setTimeout(refresh, Math.max(1000, Date.parse(usage.resetsAt) - Date.now() + 1000)) : null;
    return () => {
      window.removeEventListener("focus", refresh);
      if (timer) clearTimeout(timer);
    };
  }, [usage, refreshUsage]);
  const applyPatch = useCallback((p: Patch) => {
    patchRef.current = p;
    setPatch(p);
    engineRef.current?.update(p);
  }, []);
  const unlock = useCallback(async () => {
    if (!engineRef.current) {
      engineRef.current = new SynthEngine();
      setEngine(engineRef.current);
    }
    engineRef.current.onFailure = (message) => {
      setError(message);
      playingRef.current = false;
      setPlaying(false);
    };
    engineRef.current.update(patchRef.current);
    setAudioLoading(true);
    try { await engineRef.current.unlock(); }
    finally { setAudioLoading(false); }
    engineRef.current.setVolume(volume / 100);
    return engineRef.current;
  }, [volume]);
  const interpret = useCallback(
    async (text: string, autoplay = false) => {
      const brief = text.trim();
      if (!brief || brief.length > 400)
        throw new Error("Write a description between 1 and 400 characters.");
      if (debounce.current) clearTimeout(debounce.current);
      lastAttempted.current = brief;
      request.current.abort?.abort();
      const id = ++request.current.seq;
      const abort = new AbortController();
      request.current.abort = abort;
      setLoading(true);
      setCheckingBrowser(false);
      setError("");
      try {
        if (autoplay) await unlock();
        if (!usageRef.current || Date.now() >= Date.parse(usageRef.current.resetsAt)) await refreshUsage();
        if (usageRef.current?.remaining === 0) throw new Error("Today's description allowance is used up. It resets at 00:00 UTC. You can still play and adjust the controls.");
        let turnstileToken: string | undefined;
        if (turnstileKey.current) {
          setCheckingBrowser(true);
          try {
            turnstileToken = await new Promise<string>((resolve, reject) => setBrowserCheck({ id, siteKey: turnstileKey.current!, signal: abort.signal, resolve, reject }));
          } finally {
            setBrowserCheck(current => current?.id === id ? null : current);
            if (id === request.current.seq) setCheckingBrowser(false);
          }
        }
        if (abort.signal.aborted || id !== request.current.seq) return null;
        const send = () => fetch("/api/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...embedHeaders() },
          body: JSON.stringify({ description: brief, turnstileToken }),
          signal: abort.signal,
        });
        let response = await send();
        let data = (await response.json()) as Interpretation & {
          error?: string; code?: string; usage?: Usage;
        };
        if (response.status === 401 && data.code === "SESSION_REQUIRED" && !abort.signal.aborted) {
          await refreshUsage();
          response = await send();
          data = await response.json();
        }
        if (data.usage) updateUsage(data.usage);
        if (id !== request.current.seq) return null;
        if (response.status === 401 && data.code === "SESSION_REQUIRED" && embedHeaders()["X-Textured-Embed"])
          throw new Error("This browser could not save the session. Allow cookies for this player and retry. You can still play and adjust the controls.");
        if (!response.ok)
          throw new Error(data.error || "Could not interpret that sound.");
        if (!validPatch(data.patch))
          throw new Error("The sound settings were incomplete. Try again.");
        const next = data as Interpretation;
        applyPatch(next.patch);
        setPatchTitle(brief);
        setResult(next);
        setSource("live");
        lastApplied.current = brief;
        if (autoplay) {
          engineRef.current!.start();
          playingRef.current = true;
          setPlaying(true);
        }
        return next;
      } catch (e) {
        if (
          id === request.current.seq &&
          !(e instanceof Error && e.name === "AbortError")
        ) {
          const message =
            e instanceof Error ? e.message : "Something went wrong. Try again.";
          setError(message);
          throw new Error(message);
        }
        return null;
      } finally {
        if (id === request.current.seq) setLoading(false);
      }
    },
    [applyPatch, unlock, refreshUsage, updateUsage],
  );
  useEffect(() => {
    if (
      loading ||
      !playing ||
      !configured ||
      quotaExhausted ||
      !description.trim() ||
      description.trim() === lastApplied.current ||
      description.trim() === lastAttempted.current
    )
      return;
    debounce.current = setTimeout(() => {
      void interpret(description).catch(() => {});
    }, 850);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [description, playing, configured, interpret, loading, quotaExhausted]);
  const editDescription = useCallback((text: string) => {
    request.current.abort?.abort();
    request.current.seq++;
    lastAttempted.current = "";
    setLoading(false);
    setCheckingBrowser(false);
    setError("");
    setDescription(text);
  }, []);
  const pause = useCallback(() => {
    request.current.abort?.abort();
    request.current.seq++;
    if (debounce.current) clearTimeout(debounce.current);
    engineRef.current?.stop();
    playingRef.current = false;
    setPlaying(false);
    setLoading(false);
    setCheckingBrowser(false);
  }, []);
  const togglePlay = async () => {
    try {
      if (playingRef.current) {
        pause();
      } else {
        const synth = await unlock();
        synth.start();
        playingRef.current = true;
        setPlaying(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audio could not start.");
    }
  };
  const manualPatch = (updates: Partial<Patch>) => {
    request.current.abort?.abort();
    request.current.seq++;
    if (debounce.current) clearTimeout(debounce.current);
    lastApplied.current = description.trim();
    lastAttempted.current = description.trim();
    setLoading(false);
    setCheckingBrowser(false);
    setError("");
    applyPatch({ ...patchRef.current, ...updates });
    setSource("manual");
  };
  const manual = (key: Dimension, value: number) => manualPatch({ [key]: value / 100 });
  const chooseExample = (text: string) => {
    editDescription(text);
    void interpret(text, playingRef.current).catch(() => {});
  };
  const changeVolume = (value: number) => {
    setVolume(value);
    engineRef.current?.setVolume(value / 100);
  };
  return {
    description, patch, patchTitle, source, result, playing, volume, engine,
    loading, audioLoading, configured, browserCheck, checkingBrowser, usage,
    quotaExhausted, error, interpret, editDescription, togglePlay, pause,
    manualPatch, manual, chooseExample, changeVolume,
  };
}

export type Instrument = ReturnType<typeof useInstrument>;
