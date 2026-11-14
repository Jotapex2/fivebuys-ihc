// Movimiento del menú existente; no cambia sus enlaces ni su lógica de navegación.
(() => {
  const menu = document.querySelector('.mobile-menu');
  const trigger = document.querySelector('.menu-button');
  if (!menu || !trigger) return;
  let transition;
  let version = 0;
  menu.inert = !menu.classList.contains('open');
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !menu.classList.contains('open')) return;
    event.preventDefault();
    trigger.click();
    trigger.focus();
  });
  new MutationObserver(() => {
    const currentVersion = ++version;
    const opening = menu.classList.contains('open');
    menu.inert = !opening;
    const style = getComputedStyle(menu);
    const current = { transform: style.transform, opacity: style.opacity, clipPath: style.clipPath };
    transition?.cancel();
    if (!matchMedia('(max-width: 850px)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      menu.style.removeProperty('display');
      return;
    }
    menu.style.display = 'grid';
    const source = trigger.getBoundingClientRect();
    const surface = menu.getBoundingClientRect();
    menu.style.transformOrigin = `${source.left + source.width / 2 - surface.left}px ${source.bottom - surface.top}px`;
    const folded = { transform: 'translateY(-6px) scale(.95)', opacity: 0, clipPath: 'inset(0 0 90% 0 round 12px)' };
    const settled = { transform: 'translateY(0) scale(1)', opacity: 1, clipPath: 'inset(0 round 12px)' };
    transition = menu.animate(opening ? [style.display === 'none' ? folded : current, settled] : [current, folded], {
      duration: opening ? 350 : 250,
      easing: opening ? 'cubic-bezier(.16,1,.3,1)' : 'cubic-bezier(.7,0,.84,0)',
      fill: 'none'
    });
    transition.finished.then(() => {
      if (currentVersion === version && !menu.classList.contains('open')) menu.style.removeProperty('display');
    }).catch(() => {});
  }).observe(menu, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', () => {
    if (!matchMedia('(max-width: 850px)').matches) { transition?.cancel(); menu.style.removeProperty('display'); }
  });
})();

// Respuesta decorativa inmediata; no retrasa navegación ni anuncia texto adicional.
(() => {
  const targets = 'button, a.hero-btn, a.primary-button, .about-actions > a, summary';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function wave(target, x, y) {
    if (reduced() || target.matches(':disabled,[aria-disabled="true"]') || target.closest('[inert]')) return;
    const rect = target.getBoundingClientRect();
    const diameter = Math.hypot(rect.width, rect.height) * 2;
    // Conservar controles posicionados, como la X del diálogo.
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.classList.add('interaction-surface');
    target.querySelectorAll('.interaction-wave').forEach(node => node.remove());
    const mark = document.createElement('span');
    mark.className = 'interaction-wave';
    mark.setAttribute('aria-hidden', 'true');
    Object.assign(mark.style, { width: `${diameter}px`, height: `${diameter}px`, left: `${x - rect.left - diameter / 2}px`, top: `${y - rect.top - diameter / 2}px` });
    target.append(mark);
    const animation = mark.animate([{ transform: 'scale(0)', opacity: .25 }, { transform: 'scale(1)', opacity: 0 }], { duration: 450, easing: 'cubic-bezier(.16,1,.3,1)' });
    animation.finished.finally(() => mark.remove()).catch(() => {});
  }
  document.addEventListener('pointerdown', event => {
    const target = event.target.closest(targets);
    if (target && event.button === 0) wave(target, event.clientX, event.clientY);
  });
  document.addEventListener('click', event => {
    if (event.detail !== 0) return;
    const target = event.target.closest(targets);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    wave(target, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  document.addEventListener('toggle', event => {
    const detail = event.target;
    if (!detail.matches('.about-details details') || !detail.open || reduced()) return;
    detail.querySelector('.about-detail-content').animate([{ opacity: .5, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'ease-out' });
  }, true);
})();
