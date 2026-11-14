const menuButton = document.querySelector('.menu-button');
const mobileMenu = document.querySelector('.mobile-menu');

menuButton?.addEventListener('click', () => {
  const isOpen = mobileMenu.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
});

document.querySelector('[data-open-cart]')?.addEventListener('click', () => {
  window.location.href = '/#carrito';
});

try {
  const savedCart = JSON.parse(localStorage.getItem('fivebuys_cart') || '[]');
  const count = Array.isArray(savedCart) ? savedCart.reduce((sum, item) => sum + (Number.isInteger(item?.quantity) && item.quantity > 0 && item.quantity <= 20 ? item.quantity : 0), 0) : 0;
  const badge = document.querySelector('[data-cart-count]');
  if (badge) badge.textContent = count;
  document.querySelector('[data-open-cart]')?.setAttribute('aria-label', 'Carrito');
} catch { /* Un almacenamiento no disponible no bloquea la navegación. */ }
