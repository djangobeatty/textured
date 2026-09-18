// Embedded players cannot depend on third-party cookies. Keep their anonymous
// quota token inside the player origin, scoped to the containing page's origin.
// Never send it to the parent page or include it in a share URL.
export function createBrowserSession() {
  const embedded = window.parent !== window && new URLSearchParams(window.location.search).get("embed") === "1";
  const parentOrigin = new URLSearchParams(window.location.search).get("parentOrigin") ?? "";
  const storageKey = `textured:embed-session:${parentOrigin}`;
  let token: string | null = null;
  const validToken = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (embedded) {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (validToken(stored)) token = stored;
    } catch { /* Restricted storage still permits a session for this page visit. */ }
  }
  return {
    headers(): Record<string, string> {
      if (!embedded) return {};
      return { "X-Textured-Embed": "1", ...(token ? { "X-Textured-Session": token } : {}) };
    },
    accept(value: unknown) {
      if (!embedded || !validToken(value)) return;
      token = value;
      try { window.localStorage.setItem(storageKey, token); }
      catch { /* Retain the token in memory if the browser blocks storage. */ }
    },
  };
}
