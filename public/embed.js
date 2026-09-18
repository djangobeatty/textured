(() => {
  "use strict";
  const script = document.currentScript;
  if (!script || script.dataset.loaded) return;
  script.dataset.loaded = "true";

  const player = new URL(script.dataset.player || "/", script.src);
  if (!["https:", "http:"].includes(player.protocol)) return;
  player.searchParams.set("embed", "1");
  player.searchParams.set("parentOrigin", location.origin);
  const page = new URL(location.href);
  const shareBase = new URL(page.origin);
  shareBase.pathname = page.pathname;
  player.searchParams.set("shareBase", shareBase.href);
  const sound = page.searchParams.get("sound") ?? script.dataset.sound;
  if (sound && sound.trim() && sound.length <= 400) player.searchParams.set("sound", sound);
  const inline = script.dataset.mode !== "button";
  const host = document.createElement("div");
  host.className = "textured-embed";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host{display:block;color-scheme:light;font-family:system-ui,sans-serif}
    button,a{font:inherit}button{cursor:pointer}
    .launch{background:#d64b24;color:#fffaf5;border:1px solid #b63b1b;border-radius:8px;padding:13px 20px;font-weight:650;font-size:16px}
    button:focus-visible,a:focus-visible{outline:2px solid #d64b24;outline-offset:4px}
    dialog{box-sizing:border-box;width:min(1080px,calc(100vw - 24px));height:min(940px,calc(100dvh - 24px));max-width:none;max-height:none;padding:0;border:1px solid #c7c6bd;border-radius:12px;background:#e8e7e0;color:#282925;overflow:hidden}
    dialog::backdrop{background:#000a;backdrop-filter:blur(5px)}
    .panel{box-sizing:border-box;display:flex;flex-direction:column;min-height:0;height:100%;background:#e8e7e0;color:#282925}
    .inline{height:auto;border:1px solid #c7c6bd;border-radius:12px;overflow:hidden}
    .bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;font-size:14px;border-bottom:1px solid #c7c6bd}
    .bar span{font-weight:650}.close{border:1px solid #555d48;border-radius:5px;background:transparent;color:inherit;padding:5px 10px;font-size:14px}
    .actions{display:flex;gap:16px;align-items:center}iframe{display:block;flex:1;width:100%;min-height:0;border:0;background:#e8e7e0}
    .notice{margin:0;padding:12px 16px;font-size:14px;line-height:1.5;color:#62645b}.notice[hidden],.retry[hidden]{display:none}
    .retry{align-self:flex-start;margin:0 16px 16px;border:1px solid #b63b1b;border-radius:5px;padding:8px 12px;background:#d64b24;color:#fffaf5;font-size:14px}
  `;
  shadow.append(style);
  const panel = document.createElement("div");
  panel.className = inline ? "panel inline" : "panel";
  const bar = document.createElement("div");
  bar.className = "bar";
  const title = document.createElement("span");
  title.textContent = "Textured";
  const actions = document.createElement("div");
  actions.className = "actions";
  bar.append(title, actions);
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  notice.textContent = "Loading the instrument…";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "retry";
  retry.textContent = "Retry loading";
  retry.hidden = true;
  if (!inline) panel.append(bar);
  panel.append(notice, retry);
  let frame;
  let ready = false;
  let timer;
  const load = () => {
    clearTimeout(timer);
    ready = false;
    notice.hidden = false;
    notice.textContent = "Loading the instrument…";
    retry.hidden = true;
    if (!frame) {
      frame = document.createElement("iframe");
      frame.title = "Textured synthesiser";
      frame.allow = "autoplay; clipboard-write";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      if (inline) { frame.style.flex = "none"; frame.style.height = "850px"; }
      frame.addEventListener("load", () => {
        frame.contentWindow?.postMessage({ type: "textured:connect" }, player.origin);
      });
      frame.src = player.href;
      panel.append(frame);
    } else {
      frame.src = player.href;
    }
    timer = setTimeout(() => {
      if (ready) return;
      notice.textContent = "The player is taking longer than expected. Please retry loading.";
      retry.hidden = false;
    }, 12000);
  };
  retry.addEventListener("click", load);
  window.addEventListener("message", (event) => {
    if (event.origin !== player.origin || event.source !== frame?.contentWindow) return;
    if (event.data?.type === "textured:resize" && inline) {
      const height = event.data.height;
      if (Number.isFinite(height)) frame.style.height = `${Math.max(320, Math.min(3000, Math.ceil(height)))}px`;
      return;
    }
    if (event.data?.type !== "textured:ready") return;
    ready = true;
    clearTimeout(timer);
    notice.hidden = true;
    retry.hidden = true;
  });
  if (inline) {
    shadow.append(panel);
  } else {
    const launch = document.createElement("button");
    launch.type = "button";
    launch.className = "launch";
    launch.textContent = script.dataset.label || "Open Textured";
    launch.setAttribute("aria-haspopup", "dialog");
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Textured synthesiser");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.textContent = "Close";
    close.addEventListener("click", () => dialog.close());
    actions.append(close);
    dialog.append(panel);
    launch.addEventListener("click", () => {
      dialog.showModal();
      if (!frame) load();
      close.focus();
    });
    dialog.addEventListener("close", () => {
      frame?.contentWindow?.postMessage({ type: "textured:pause" }, player.origin);
      launch.focus();
    });
    shadow.append(launch, dialog);
  }
  const mount = () => {
    if (script.parentElement === document.head) document.body.append(host);
    else script.insertAdjacentElement("beforebegin", host);
    if (inline) load();
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();
