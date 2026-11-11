import { qsa } from './ui.js';

const links = qsa('[data-toc] a');
const sections = qsa('[data-article] section[id]');

if (links.length && sections.length && 'IntersectionObserver' in window) {
  const map = new Map(links.map((link) => [link.getAttribute('href')?.slice(1), link]));
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (!visible.length) return;
      const id = visible[0].target.id;
      links.forEach((link) => link.classList.toggle('is-active', link === map.get(id)));
    },
    { rootMargin: '-12% 0px -68% 0px', threshold: [0.1, 0.4, 0.8] },
  );

  sections.forEach((section) => observer.observe(section));

  links.forEach((link) => {
    link.addEventListener('click', () => {
      links.forEach((item) => item.classList.toggle('is-active', item === link));
    });
  });

  if (window.location.hash) {
    const active = map.get(window.location.hash.slice(1));
    if (active) active.classList.add('is-active');
  }
}
