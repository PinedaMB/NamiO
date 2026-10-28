export function createStoryPlayer(gsap, chapters, steps) {
  let active = -1;
  let entrance;
  const showChapter = index => {
    if (index === active) return;
    entrance?.kill();
    gsap.set(chapters, { autoAlpha: 0 });
    gsap.set(chapters[index], { autoAlpha: 1 });
    gsap.set(steps, { opacity: 0.45 });
    gsap.set(steps[index], { opacity: 1 });
    active = index;
    const chapter = chapters[index];
    // El scroll elige el capítulo; su entrada siempre avanza por tiempo.
    entrance = gsap.timeline({ defaults: { ease: 'power3.out' } })
      .fromTo(chapter.querySelector('.story-copy'), { y: 30 }, { y: 0, duration: 0.8 }, 0)
      .fromTo(chapter.querySelector('[data-visual]'),
        { y: 40, rotateY: -10, scale: 0.96 }, { y: 0, rotateY: 0, scale: 1, duration: 1 }, 0)
      .fromTo(chapter.querySelectorAll('.sv-row, .sv-field, .sv-lines i, .sv-actions'),
        { x: 20, autoAlpha: 0 }, { x: 0, autoAlpha: 1, stagger: 0.08, duration: 0.6 }, 0.2);
  };
  return { showChapter, cleanup() {
    entrance?.kill();
    gsap.set(chapters.flatMap(chapter => [chapter, ...chapter.querySelectorAll('.story-copy, [data-visual], .sv-row, .sv-field, .sv-lines i, .sv-actions')]),
      { clearProps: 'opacity,visibility,transform' });
    gsap.set(steps, { clearProps: 'opacity' });
  } };
}
