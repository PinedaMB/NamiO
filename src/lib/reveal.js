/** Observa la geometría real, incluso después de fijar la sección de historia. */
export function revealOnScroll(gsap) {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  const pending = new Map();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const group = pending.get(entry.target);
      if (!group) continue;
      observer.unobserve(entry.target);
      gsap.to(group.elements, {
        opacity: 1, y: 0, duration: 0.7, stagger: 0.1, ease: 'power3.out',
        clearProps: 'opacity,transform',
      });
      pending.delete(entry.target);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0 });
  const animated = [];
  const prepare = (trigger, elements, y) => {
    if (!elements.length || trigger.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    pending.set(trigger, { elements });
    observer.observe(trigger);
    gsap.set(elements, { opacity: 0, y });
    animated.push(...elements);
  };
  document.querySelectorAll('main section:not([data-hero]):not(#historia)').forEach(section => {
    const grid = section.querySelector(':scope > .grid');
    prepare(section, Array.from(section.children).filter(element => element !== grid), 32);
    if (grid) prepare(grid, Array.from(grid.children), 40);
  });
  return () => {
    observer.disconnect();
    gsap.killTweensOf(animated);
    gsap.set(animated, { clearProps: 'opacity,transform' });
  };
}
