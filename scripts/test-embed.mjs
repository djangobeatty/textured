import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/embed.js', import.meta.url), 'utf8');

// Exercise the shipped loader with a small DOM/event harness and a controlled
// clock, including frames that never answer or answer after the timeout.
function setup({ head = false, mode } = {}) {
  const elements = [], listeners = new Map(), timers = new Map();
  let sequence = 0;
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.events = new Map();
      this.hidden = false;
      this.srcWrites = 0;
      this.messages = [];
      this.contentWindow = { postMessage: (data, origin) => this.messages.push({ data, origin }) };
      elements.push(this);
    }
    get isConnected() { return this.root || !!this.parentElement?.isConnected; }
    set src(value) { this.url = value; this.srcWrites++; }
    get src() { return this.url; }
    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
        if (child.tag === 'iframe') child.connectedAtInsertion = child.isConnected;
      }
    }
    attachShadow() { this.shadowRoot = new Element('shadow'); this.append(this.shadowRoot); return this.shadowRoot; }
    insertAdjacentElement(position, child) { assert.equal(position, 'beforebegin'); this.parentElement.append(child); }
    setAttribute() {}
    addEventListener(type, callback) { this.events.set(type, callback); }
    emit(type) { this.events.get(type)?.(); }
    focus() {}
    showModal() {}
    close() { this.emit('close'); }
  }
  const document = {
    head: new Element('head'),
    body: head ? null : new Element('body'),
    createElement: tag => new Element(tag),
    addEventListener: (type, callback) => listeners.set(type, callback),
  };
  document.head.root = true;
  if (document.body) document.body.root = true;
  const script = new Element('script');
  script.src = 'https://player.example/embed.js';
  if (mode) script.dataset.mode = mode;
  (head ? document.head : document.body).append(script);
  document.currentScript = script;
  runInNewContext(source, {
    document, URL,
    location: { origin: 'https://host.example', href: 'https://host.example/music?sound=whales+singing' },
    window: { addEventListener: (type, callback) => listeners.set(type, callback) },
    setTimeout: callback => { timers.set(++sequence, callback); return sequence; },
    clearTimeout: id => timers.delete(id),
  });
  return {
    find: tag => elements.find(element => element.tag === tag),
    notice: elements.find(element => element.className === 'notice'),
    retry: elements.find(element => element.className === 'retry'),
    launch: elements.find(element => element.className === 'launch'),
    timeout: () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    message: (data, origin = 'https://player.example', sender) => listeners.get('message')({ data, origin, source: sender ?? elements.find(element => element.tag === 'iframe')?.contentWindow }),
    mount: () => { document.body = new Element('body'); document.body.root = true; listeners.get('DOMContentLoaded')(); },
  };
}

const normal = setup();
assert.equal(normal.find('iframe').connectedAtInsertion, true);
assert.equal(normal.find('a'), undefined, 'The embed must not add an Open player link.');
const url = new URL(normal.find('iframe').src);
assert.equal(url.searchParams.get('sound'), 'whales singing');
assert.equal(url.searchParams.get('shareBase'), 'https://host.example/music');
normal.find('iframe').emit('load');
assert.equal(normal.find('iframe').messages[0].data.type, 'textured:connect');
assert.equal(normal.find('iframe').messages[0].origin, 'https://player.example');

// Neither another origin nor another iframe may acknowledge this player.
normal.message({ type: 'textured:ready' }, 'https://other.example');
normal.message({ type: 'textured:ready' }, undefined, {});
assert.equal(normal.notice.hidden, false);
normal.timeout();
assert.equal(normal.retry.hidden, false);
assert.match(normal.notice.textContent, /taking longer/);
assert.doesNotMatch(normal.notice.textContent, /open player/i);
normal.retry.emit('click');
assert.equal(normal.find('iframe').srcWrites, 2);
assert.equal(normal.retry.hidden, true);
assert.equal(normal.notice.hidden, false);
normal.message({ type: 'textured:ready' });
normal.timeout();
assert.equal(normal.notice.hidden, true);
assert.equal(normal.retry.hidden, true);

const slow = setup();
slow.timeout();
assert.equal(slow.retry.hidden, false);
slow.message({ type: 'textured:ready' });
assert.equal(slow.retry.hidden, true);
assert.equal(slow.notice.hidden, true);

const head = setup({ head: true });
assert.equal(head.find('iframe'), undefined);
head.mount();
assert.equal(head.find('iframe').connectedAtInsertion, true);

const modal = setup({ mode: 'button' });
assert.equal(modal.find('iframe'), undefined);
modal.launch.emit('click');
assert.equal(modal.find('iframe').connectedAtInsertion, true);
modal.find('dialog').close();
assert.equal(modal.find('iframe').messages.at(-1).data.type, 'textured:pause');
modal.launch.emit('click');
assert.equal(modal.find('iframe').srcWrites, 1, 'Reopening must preserve the current sound.');
console.log('Embed startup, trusted connection, timeout, retry, late recovery and dialog reuse passed.');
