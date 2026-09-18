import { readSharedPatch, type Patch } from "./semantic";

export function shareUrl(base: string, description: string): string {
  const current = new URL(base);
  // Share only the scene and sound; never forward unrelated query parameters.
  const url = new URL(current.origin);
  url.pathname = current.pathname;
  url.searchParams.set("sound", description.slice(0, 400));
  return url.toString();
}

export function readShareUrl(value: string): { description?: string; patchTitle?: string; patch?: Patch } {
  const url = new URL(value);
  const sound = url.searchParams.get("sound");
  const description = sound && sound.trim() && sound.length <= 400 ? sound : undefined;
  const result: { description?: string; patchTitle?: string; patch?: Patch } = { description };
  try {
    const encoded = new URLSearchParams(url.hash.slice(1)).get("patch");
    if (!encoded || encoded.length >= 8000) return result;
    const data = JSON.parse(encoded);
    const patch = readSharedPatch(data.patch);
    if ([1, 2, 3].includes(data.v) && typeof data.description === "string" && data.description.length <= 400 && patch)
      return { description: description ?? data.description, patchTitle: data.description, patch };
  } catch { /* A damaged saved patch must not prevent prefilling the scene. */ }
  return result;
}

// The loader supplies only its host's origin/path. A standalone player ignores
// embedding metadata, and an iframe cannot nominate an unrelated share origin.
export function shareBase(playerUrl: string, inFrame: boolean): string {
  const player = new URL(playerUrl);
  if (inFrame && player.searchParams.get("embed") === "1") {
    try {
      const host = new URL(player.searchParams.get("shareBase") ?? "");
      if (["http:", "https:"].includes(host.protocol) && !host.username && !host.password && host.origin === player.searchParams.get("parentOrigin")) {
        host.search = "";
        host.hash = "";
        return host.href;
      }
    } catch { /* Invalid metadata falls back to the standalone player. */ }
  }
  return player.href;
}
