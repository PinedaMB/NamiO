import assert from 'node:assert/strict';
import { createStoryPlayer } from '../src/lib/story.js';

const chapters = Array.from({ length: 4 }, () => ({ querySelector: () => ({}), querySelectorAll: () => [{}, {}] }));
const steps = [{}, {}, {}, {}];
const timelines = [], sets = [];
const gsap = {
  set: (...args) => sets.push(args),
  timeline: options => {
    const timeline = { options, tweens: [], killed: false,
      fromTo(...args) { this.tweens.push(args); return this; },
      kill() { this.killed = true; },
    };
    timelines.push(timeline);
    return timeline;
  },
};
const { showChapter: show, cleanup } = createStoryPlayer(gsap, chapters, steps);
show(0);
show(0);
assert.equal(timelines.length, 1, 'scroll within a chapter does not restart its entrance');
assert.equal(timelines[0].options.scrollTrigger, undefined, 'entrance advances independently of scroll');
assert.equal(timelines[0].tweens.at(-1)[2].autoAlpha, 1, 'all demo rows finish visible');
show(3);
assert.ok(timelines[0].killed, 'fast scrolling cancels the previous entrance');
assert.deepEqual(sets.at(-3), [chapters[3], { autoAlpha: 1 }]);
show(1);
assert.equal(timelines.length, 3, 'scrolling backwards replays the selected chapter');
assert.ok(timelines[1].killed);
cleanup();
assert.ok(timelines[2].killed);
assert.equal(sets.at(-2)[1].clearProps, 'opacity,visibility,transform', 'reduced motion restores all chapters');
console.log('Story: timed entrance, stable chapter, fast jumps and reverse scrolling verified');
