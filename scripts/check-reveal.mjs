import assert from 'node:assert/strict';
import { revealOnScroll } from '../src/lib/reveal.js';
const element = top => ({ getBoundingClientRect: () => ({ top }) });
const heading = {}, cards = [{}, {}], grid = { ...element(1200), children: cards };
const section = { ...element(1000), children: [heading, grid], querySelector: () => grid };
const visible = {}, above = { ...element(-100), children: [visible], querySelector: () => null };
globalThis.window = { innerHeight: 800 };
globalThis.document = { querySelectorAll: selector => { assert.equal(selector, 'main section:not([data-hero]):not(#historia)'); return [above, section]; } };
const observed = new Set(), sets = [], tweens = [];
let callback, disconnected = false, killed;
globalThis.IntersectionObserver = class {
  constructor(fn) { callback = fn; }
  observe(target) { observed.add(target); }
  unobserve(target) { observed.delete(target); }
  disconnect() { disconnected = true; }
};
const cleanup = revealOnScroll({ set: (...args) => sets.push(args), to: (...args) => tweens.push(args), killTweensOf: targets => { killed = targets; } });
assert.equal(sets.length, 2);
assert.equal(sets[0][1].opacity, 0, 'offscreen headings start hidden');
assert.equal(sets[1][1].opacity, 0, 'offscreen cards start hidden');
assert.ok(!sets.flatMap(call => call[0]).includes(visible), 'content already reached stays visible on restored scroll');
callback([{ target: grid, isIntersecting: false }]);
assert.equal(tweens.length, 0, 'no reveal before entering the viewport');
callback([{ target: grid, isIntersecting: true }]);
assert.deepEqual(tweens[0][0], cards);
assert.equal(tweens[0][1].opacity, 1);
assert.equal(tweens[0][1].y, 0);
assert.equal(observed.has(grid), false, 'reveal once');
callback([{ target: grid, isIntersecting: true }]);
assert.equal(tweens.length, 1);
cleanup();
assert.ok(disconnected);
assert.deepEqual(killed, [heading, ...cards]);
assert.equal(sets.at(-1)[1].clearProps, 'opacity,transform', 'reduced-motion cleanup restores content');
delete globalThis.IntersectionObserver;
assert.equal(typeof revealOnScroll({}), 'function', 'unsupported browsers leave content visible');
console.log('Reveal: hidden before entry, visible on intersection, restored scroll, one-shot and reduced-motion cleanup verified');
