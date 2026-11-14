const productsDataElement = document.querySelector('#products-data');
const products = JSON.parse(productsDataElement.textContent);
const productsById = new Map(products.map((product) => [product.id, product]));

const CART_STORAGE_KEY = 'fivebuys_cart';
const DISCOUNT_RATE = 0.05;
const TOAST_DURATION_MS = 2500;

let cart = loadCart();
let checkoutBusy = false;
let normalCheckoutAttempt;

function loadCart() {
  try {
    const storedCart = JSON.parse(
      localStorage.getItem(CART_STORAGE_KEY) || '[]',
    );

    if (!Array.isArray(storedCart)) {
      return [];
    }

    return storedCart.filter(
      (item) => productsById.has(item.id) && Number.isInteger(item.quantity) && item.quantity > 0,
    );
  } catch {
    return [];
  }
}

function saveCart() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  renderCart();
}

function formatMoney(value) {
  return `$${Math.round(value).toLocaleString('es-CL')}`;
}

// El símbolo visual se conserva; el lector recibe la moneda sin ambigüedad.
function moneyMarkup(value, { prefix = '', suffix = '' } = {}) {
  const rounded = Math.round(value);
  const negative = rounded < 0 || prefix === '-' || prefix === '−';
  const number = Math.abs(rounded).toLocaleString('es-CL');
  const spoken = `${negative ? 'menos ' : ''}${number} ${Math.abs(rounded) === 1 ? 'peso chileno' : 'pesos chilenos'}`;
  return `<span data-money-visible aria-hidden="true">${prefix}${formatMoney(value)}${suffix}</span><span class="sr-only" data-money-spoken>${spoken}</span>`;
}

function renderMoney(element, value, options) {
  element.innerHTML = moneyMarkup(value, options);
}

function addProduct(productId) {
  const cartItem = cart.find((item) => item.id === productId);

  if (cartItem) {
    if (cartItem.quantity >= 20) {
      showToast('Máximo 20 unidades.');
      return;
    }
    cartItem.quantity += 1;
  } else {
    cart.push({ id: productId, quantity: 1 });
  }

  saveCart();
  showToast(`Cantidad: ${cart.find(item => item.id === productId).quantity}.`);
  
  // Actualizar solo este producto en el catálogo
  const productCard = document.querySelector(`[data-product-card] [data-add-product="${productId}"]`)?.closest('[data-product-card]');
  if (productCard) {
    updateProductFooter(productCard, productId);
  }
}

function changeQuantity(productId, amount) {
  const cartItem = cart.find((item) => item.id === productId);

  if (!cartItem) {
    return;
  }

  const newQuantity = cartItem.quantity + amount;

  if (newQuantity > 20) {
    showToast('Máximo 20 unidades.');
    return;
  }

  if (newQuantity < 1) {
    cartItem.quantity = 0;
  } else {
    cartItem.quantity = newQuantity;
  }

  cart = cart.filter((item) => item.quantity > 0);
  saveCart();
  
  // Sincronizar catálogo cuando se cambia cantidad desde el carrito
  renderCatalogQuantityControls();
  showToast(newQuantity > 0 ? `Cantidad: ${newQuantity}.` : 'Producto retirado.');
}

function renderCart() {
  const previousFocus = document.activeElement;
  const hadRowFocus = Boolean(previousFocus?.closest('[data-cart-items]'));
  const focusProduct = previousFocus?.dataset.productId || previousFocus?.dataset.remove;
  const focusQuantity = previousFocus?.dataset.quantity;
  function restoreRowFocus() {
    if (!hadRowFocus) return;
    const selector = focusQuantity ? `[data-quantity="${focusQuantity}"][data-product-id="${focusProduct}"]` : `[data-remove="${focusProduct}"]`;
    const target = document.querySelector(selector) || document.querySelector('[data-cart-items] button') || document.querySelector('.cart-title');
    target?.focus();
  }
  const itemCount = cart.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const subtotal = cart.reduce((total, item) => {
    const product = productsById.get(item.id);
    return total + product.price * item.quantity;
  }, 0);
  // El descuento solo lo confirma el servidor tras registrar una encuesta.
  const discount = 0;

  document.querySelector('[data-cart-count]').textContent = itemCount;
  const cartTotal = subtotal - discount;
  const cartTotalPreview = document.querySelector('[data-cart-total-preview]');
  cartTotalPreview.textContent = `Total: ${formatMoney(cartTotal)}`;
  document.querySelector('[data-open-cart]').setAttribute(
    'aria-label',
    'Carrito',
  );
  renderMoney(document.querySelector('[data-cart-subtotal]'), subtotal);
  renderMoney(document.querySelector('[data-cart-discount]'), discount, { prefix: '-' });
  renderMoney(document.querySelector('[data-cart-total]'), cartTotal);
  document.querySelector('[data-checkout]').disabled = cart.length === 0 || checkoutBusy;
  document.querySelector('[data-survey-open]').disabled = cart.length === 0 || checkoutBusy;

  const cartItemsElement = document.querySelector('[data-cart-items]');

  if (cart.length === 0) {
    cartItemsElement.innerHTML = `
      <tr>
        <td colspan="5" class="cart-empty">
          Tu carrito está vacío.
        </td>
      </tr>
    `;
    restoreRowFocus();
    return;
  }

  const existingRows = [...cartItemsElement.querySelectorAll('[data-cart-row]')];
  if (existingRows.length === cart.length && cart.every(item => existingRows.some(row => Number(row.dataset.cartRow) === item.id))) {
    for (const item of cart) {
      const row = existingRows.find(row => Number(row.dataset.cartRow) === item.id);
      row.querySelector('[data-cart-quantity-display]').textContent = item.quantity;
      row.querySelector('[data-quantity="1"]').setAttribute('aria-disabled', String(item.quantity >= 20));
      renderMoney(row.querySelector('[data-label="Subtotal"]'), productsById.get(item.id).price * item.quantity);
      row.querySelector('[data-cart-max]').hidden = item.quantity < 20;
    }
    return; // El control conserva su identidad y foco; no se vuelve a anunciar su nombre.
  }

  cartItemsElement.innerHTML = cart
    .map((item) => {
      const product = productsById.get(item.id);
      const isMaxed = item.quantity >= 20;

      return `
        <tr data-cart-row="${item.id}">
          <td data-label="Producto"><strong>${product.name}</strong></td>
          <td data-label="Precio unitario">${moneyMarkup(product.price)}</td>
          <td data-label="Cantidad">
            <div class="qty-ctrl" role="group" aria-label="Cantidad de ${product.name}">
              <button type="button" data-quantity="-1" data-product-id="${item.id}" aria-label="Menos">−</button>
              <span data-cart-quantity-display>${item.quantity}</span>
              <button type="button" data-quantity="1" data-product-id="${item.id}" aria-disabled="${isMaxed}" aria-label="Más">+</button>
            </div>
            <p class="cart-quantity-note" data-cart-max ${isMaxed ? '' : 'hidden'}>Máximo 20 unidades.</p>
          </td>
          <td data-label="Subtotal">
            ${moneyMarkup(product.price * item.quantity)}
          </td>
          <td data-label="Acciones">
            <button class="btn-remove" data-remove="${item.id}" aria-label="Eliminar">Eliminar</button>
          </td>
        </tr>
      `;
    })
    .join('');
  restoreRowFocus();
}

function updateProductFooter(productCard, productId) {
  const cartItem = cart.find(item => item.id === productId);
  const productFooter = productCard.querySelector('.product-footer');
  if (!productFooter) return;
  const quantity = cartItem?.quantity || 0;
  // Conservar el mismo control: los cambios de cantidad no reemplazan el botón enfocado.
  if (!productFooter.querySelector('.qty-ctrl-catalog')) {
    productFooter.innerHTML = `
      <div><div class="price-label">Precio</div><div class="price">${moneyMarkup(productsById.get(productId).price)}</div></div>
      <div class="qty-ctrl-catalog" role="group">
        <button class="btn-qty-catalog" type="button" data-add-product="${productId}" data-qty-increase="${productId}">+</button>
        <output data-qty-catalog-display aria-live="off">0</output>
        <button class="btn-qty-catalog" type="button" data-qty-decrease="${productId}">−</button>
      </div>
      <p data-qty-max-message class="catalog-quantity-note" hidden>Máximo 20 unidades</p>`;
  }
  const group = productFooter.querySelector('.qty-ctrl-catalog');
  const productName = productsById.get(productId).name;
  group.setAttribute('aria-label', `Cantidad de ${productName}`);
  const output = group.querySelector('[data-qty-catalog-display]');
  output.setAttribute('aria-label', 'Cantidad');
  if (output.textContent !== String(quantity)) {
    output.textContent = quantity;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      output.getAnimations().forEach(animation => animation.cancel());
      output.animate([{ transform: 'translateY(-3px) scale(.97)' }, { transform: 'translateY(0) scale(1)' }],
        { duration: 250, easing: 'ease-in-out' });
    }
  }
  const plus = group.querySelector('[data-qty-increase]');
  const minus = group.querySelector('[data-qty-decrease]');
  plus.setAttribute('aria-label', 'Más');
  minus.setAttribute('aria-label', 'Menos');
  plus.setAttribute('aria-disabled', String(quantity >= 20));
  minus.setAttribute('aria-disabled', String(quantity === 0));
  const note = productFooter.querySelector('[data-qty-max-message]');
  if (note) note.hidden = quantity < 20;
}

function renderCatalogQuantityControls() {
  document.querySelectorAll('[data-product-card]').forEach((productCard) => {
    const productId = Number(productCard.dataset.productId);
    updateProductFooter(productCard, productId);
  });
}

function showCart({ history = true, focus = true } = {}) {
  if (checkoutBusy) return;
  document.querySelector('[data-catalog-view]').hidden = true;
  document.querySelector('[data-home-contact]').hidden = true;
  document.querySelector('[data-cart-view]').hidden = false;
  if (history && location.hash !== '#carrito') window.history.pushState(null, '', '#carrito');
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  if (focus) document.querySelector('.cart-title').focus({ preventScroll: true });
}

function showCatalog({ history = true, focus = true } = {}) {
  if (checkoutBusy) return;
  document.querySelector('[data-cart-view]').hidden = true;
  document.querySelector('[data-catalog-view]').hidden = false;
  document.querySelector('[data-home-contact]').hidden = false;
  if (history && location.hash !== '#catalogo') window.history.pushState(null, '', '#catalogo');
  renderCatalogQuantityControls();
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  if (focus) { const title = document.querySelector('[data-catalog-view] h1'); title.tabIndex = -1; title.focus({ preventScroll: true }); }
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  const cartVisible = !document.querySelector('[data-cart-view]').hidden;
  const toastElement = document.querySelector('[data-toast]');
  const cartStatus = document.querySelector('[data-checkout-status]');
  const target = cartVisible ? cartStatus : toastElement;
  (cartVisible ? toastElement : cartStatus).textContent = '';
  target.replaceChildren(document.createTextNode(message));
  if (!cartVisible) {
    toastElement.classList.add('show');
    toastTimer = setTimeout(() => toastElement.classList.remove('show'), TOAST_DURATION_MS);
  }
}

document.querySelector('[data-catalog-view]').addEventListener('click', (event) => {
  const addProductButton = event.target.closest('[data-add-product]');
  const qtyIncreaseButton = event.target.closest('[data-qty-increase]');
  const qtyDecreaseButton = event.target.closest('[data-qty-decrease]');
  
  if (addProductButton) {
    addProduct(Number(addProductButton.dataset.addProduct));
    return;
  }
  
  if (qtyIncreaseButton) {
    const productId = Number(qtyIncreaseButton.dataset.qtyIncrease);
    const cartItem = cart.find((item) => item.id === productId);
    
    if (cartItem && cartItem.quantity < 20) {
      cartItem.quantity += 1;
      const productCard = qtyIncreaseButton.closest('[data-product-card]');
      updateProductFooter(productCard, productId);
      saveCart();
    }
  }
  
  if (qtyDecreaseButton) {
    const productId = Number(qtyDecreaseButton.dataset.qtyDecrease);
    const cartItem = cart.find((item) => item.id === productId);
    
    if (cartItem) {
      cartItem.quantity -= 1;
      if (cartItem.quantity <= 0) {
        cart = cart.filter((item) => item.id !== productId);
      }
      const productCard = qtyDecreaseButton.closest('[data-product-card]');
      updateProductFooter(productCard, productId);
      saveCart();
      showToast(cartItem.quantity > 0 ? `Cantidad: ${cartItem.quantity}.` : 'Producto retirado.');
    }
  }
});

document.addEventListener('click', event => { if (event.target.closest('[data-open-cart]')) showCart(); });
document
  .querySelector('[data-show-catalog]')
  .addEventListener('click', () => showCatalog());

document.querySelector('[data-cart-items]').addEventListener('click', (event) => {
  const quantityButton = event.target.closest('[data-quantity]');
  const removeButton = event.target.closest('[data-remove]');

  if (quantityButton) {
    changeQuantity(
      Number(quantityButton.dataset.productId),
      Number(quantityButton.dataset.quantity),
    );
  }

  if (removeButton) {
    const productId = Number(removeButton.dataset.remove);
    cart = cart.filter((item) => item.id !== productId);
    saveCart();
    showToast('Producto eliminado.');
    
    // Actualizar catálogo cuando se elimina producto
    const productCard = document.querySelector(`[data-product-card] [data-add-product="${productId}"]`)?.closest('[data-product-card]');
    if (productCard) {
      updateProductFooter(productCard, productId);
    }
  }
});

document.querySelector('[data-clear-cart]').addEventListener('click', () => {
  if (!cart.length) { showToast('El carrito ya está vacío.'); return; }
  cart = [];
  saveCart();
  
  // Actualizar todo el catálogo cuando se vacía el carrito
  renderCatalogQuantityControls();
  showToast('Carrito vaciado.');
});

function purchaseItems() {
  return cart.map(item => ({ id: item.id, quantity: item.quantity }));
}

async function purchaseRequest(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const context = await fetch('/purchase-context', { cache: 'no-store', signal: controller.signal });
    if (!context.ok) throw new Error();
    const response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo preparar el pago de prueba.');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('La conexión tardó demasiado. Reintenta.');
    if (error instanceof TypeError || error instanceof SyntaxError || !error.message) {
      throw new Error('Sin conexión. Reintenta.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function beginCheckout({ surveyToken, requestId, redirect = true } = {}) {
  if (checkoutBusy) throw new Error('Ya estamos preparando el pago. Espera un momento.');
  if (cart.length === 0) throw new Error('Agrega un computador antes de pagar.');
  const items = purchaseItems();
  const signature = JSON.stringify(items);
  if (!requestId) {
    if (normalCheckoutAttempt?.signature !== signature) normalCheckoutAttempt = { signature, id: crypto.randomUUID() };
    requestId = normalCheckoutAttempt.id;
  }
  const checkoutBtn = document.querySelector('[data-checkout]');
  const status = document.querySelector('[data-checkout-status]');
  const cartView = document.querySelector('[data-cart-view]');
  checkoutBusy = true;
  checkoutBtn.disabled = true;
  document.querySelector('[data-survey-open]').disabled = true;
  // Bloquear cambios sin retirar el carrito ni su estado del árbol accesible.
  const lockedCartControls = [...cartView.querySelectorAll('button')]
    .filter(control => control !== checkoutBtn && !control.matches('[data-survey-open]'))
    .map(control => ({ control, disabled: control.disabled }));
  lockedCartControls.forEach(({ control }) => { control.disabled = true; });
  cartView.inert = false;
  checkoutBtn.textContent = 'Preparando pago…';
  status.textContent = 'Preparando pago…';
  try {
    const data = await purchaseRequest('/create-checkout-session', { items, requestId, ...(surveyToken ? { surveyToken } : {}) });
    if (signature !== JSON.stringify(purchaseItems())) throw new Error('El carrito cambió. Revisa el total antes de pagar.');
    if (!Number.isSafeInteger(data.total) || data.currency !== 'clp' || !data.url?.startsWith('https://checkout.stripe.com/')) {
      throw new Error('No se pudo confirmar el importe del pago. Tu carrito se conserva.');
    }
    status.textContent = 'Abriendo Stripe…';
    if (redirect) window.location.assign(data.url);
    return data;
  } catch (error) {
    status.textContent = error.message;
    throw error;
  } finally {
    checkoutBusy = false;
    cartView.inert = false;
    lockedCartControls.forEach(({ control, disabled }) => { control.disabled = disabled; });
    checkoutBtn.disabled = cart.length === 0;
    document.querySelector('[data-survey-open]').disabled = cart.length === 0;
    checkoutBtn.textContent = 'Ir a pagar';
    document.dispatchEvent(new Event('fivebuys:checkout-idle'));
  }
}

document.querySelector('[data-checkout]').addEventListener('click', () => {
  beginCheckout().catch(() => { /* El mensaje permanece en la región de estado. */ });
});

document.querySelector('[data-close-modal]').addEventListener('click', () => {
  document.querySelector('[data-modal]').classList.remove('open');
  showCatalog();
});

document.querySelector('[data-search]').addEventListener('input', (event) => {
  if (!document.querySelector('[data-cart-view]').hidden) showCatalog({ focus: false });
  const searchTerm = event.target.value.trim().toLowerCase();
  let visibleProductCount = 0;

  document.querySelectorAll('[data-product-card]').forEach((productCard) => {
    const matchesSearch = productCard.dataset.searchText.includes(searchTerm);
    productCard.hidden = !matchesSearch;

    if (matchesSearch) {
      visibleProductCount += 1;
    }
  });

  document.querySelector('[data-empty]').hidden = visibleProductCount !== 0;
});

document.querySelector('.menu-button').addEventListener('click', () => {
  const mobileMenu = document.querySelector('.mobile-menu');
  const isOpen = mobileMenu.classList.toggle('open');

  document
    .querySelector('.menu-button')
    .setAttribute('aria-expanded', String(isOpen));
});

renderCart();
renderCatalogQuantityControls();

function restorePurchaseView() {
  if (location.hash === '#carrito') showCart({ history: false, focus: false });
  else if (!document.querySelector('[data-cart-view]').hidden) showCatalog({ history: false, focus: false });
}
window.addEventListener('popstate', restorePurchaseView);
window.addEventListener('hashchange', restorePurchaseView);
if (location.hash === '#carrito') showCart({ history: false, focus: false });
