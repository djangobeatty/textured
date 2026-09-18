"use client";

import { useMemo, useSyncExternalStore } from "react";
import { readShareUrl } from "@/lib/share";
import { DEFAULT_PATCH, EXAMPLES } from "@/lib/semantic";

// A share URL initializes the instrument once per navigation. No browser globals
// during SSR, and no effect that renders once just to overwrite initial state.
const subscribe = () => () => {};
const browserUrl = () => window.location.href;
const serverUrl = () => "";

export function usePlayerLocation() {
  const url = useSyncExternalStore(subscribe, browserUrl, serverUrl);
  return useMemo(() => {
    const shared = url ? readShareUrl(url) : {};
    return {
      url,
      embedded: !!url && new URL(url).searchParams.get("embed") === "1",
      description: shared.description ?? EXAMPLES[0],
      patch: shared.patch ?? DEFAULT_PATCH,
      title: shared.patchTitle ?? EXAMPLES[0],
      source: shared.patch ? "shared" as const : "example" as const,
    };
  }, [url]);
}

export type PlayerLocation = ReturnType<typeof usePlayerLocation>;
