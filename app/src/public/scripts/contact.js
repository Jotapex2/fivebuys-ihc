const contactForm = document.querySelector('[data-contact-form]');
const formResponse = document.querySelector('[data-form-response]');

if (contactForm && formResponse) {
  let sending = false;
  let sent = false;
  let contactAttempt;
  const submitButton = contactForm.querySelector('button[type="submit"]');
  const newMessage = contactForm.querySelector('[data-contact-new]');
  function showContactErrors(errors) {
    let first;
    for (const field of ['name', 'email', 'subject', 'message']) {
      const input = contactForm.elements[field];
      const error = contactForm.querySelector(`[data-field-error="${field}"]`);
      error.textContent = errors[field] || '';
      error.hidden = !errors[field];
      if (errors[field]) { input.setAttribute('aria-invalid', 'true'); first ||= input; }
      else input.removeAttribute('aria-invalid');
    }
    if (first) { formResponse.textContent = ''; first.focus(); }
    return Boolean(first);
  }
  contactForm.addEventListener('input', event => {
    if (sent) return;
    const field = event.target.name;
    const error = contactForm.querySelector(`[data-field-error="${field}"]`);
    if (error) { error.hidden = true; event.target.removeAttribute('aria-invalid'); }
  });
  contactForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || sent) return;
    const data = Object.fromEntries(new FormData(contactForm));
    for (const field in data) data[field] = data[field].trim();
    const errors = {};
    if (data.name.length < 3) errors.name = 'Nombre: al menos 3 caracteres.';
    if (!/^\S+@\S+\.\S+$/.test(data.email)) errors.email = data.email ? 'Revisa el correo.' : 'Escribe tu correo.';
    if (!data.subject) errors.subject = 'Selecciona un asunto.';
    if (!data.message) errors.message = 'Escribe tu mensaje.';
    if (showContactErrors(errors)) return;
    const signature = JSON.stringify(data);
    if (contactAttempt?.signature !== signature) contactAttempt = { signature, id: crypto.randomUUID() };
    data.requestId = contactAttempt.id;
    sending = true;
    submitButton.setAttribute('aria-disabled', 'true');
    formResponse.classList.remove('error', 'success');
    formResponse.textContent = 'Enviando…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/contacto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) {
        if (result.errors && showContactErrors(result.errors)) return;
        throw new Error(result.message || 'No se pudo enviar. Reintenta.');
      }
      sent = true;
      contactForm.classList.add('contact-sent');
      contactForm.querySelectorAll('input, textarea').forEach(input => input.readOnly = true);
      contactForm.elements.subject.disabled = true;
      formResponse.classList.add('success');
      formResponse.textContent = 'Mensaje enviado.';
      newMessage.hidden = false;
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) formResponse.animate([{ transform: 'scale(.98)' }, { transform: 'scale(1.015)', offset: .5 }, { transform: 'scale(1)' }], { duration: 350, easing: 'ease-in-out' });
    } catch (error) {
      formResponse.classList.add('error');
      formResponse.textContent = error instanceof TypeError || error.name === 'AbortError' ? 'Sin conexión. Reintenta.' : error.message;
    } finally {
      clearTimeout(timeout);
      sending = false;
      submitButton.setAttribute('aria-disabled', String(sent));
    }
  });
  newMessage.addEventListener('click', () => {
    contactForm.reset(); sent = false;
    contactAttempt = undefined;
    contactForm.classList.remove('contact-sent');
    contactForm.querySelectorAll('input, textarea').forEach(input => input.readOnly = false);
    contactForm.elements.subject.disabled = false;
    submitButton.removeAttribute('aria-disabled');
    formResponse.textContent = ''; formResponse.classList.remove('success', 'error');
    newMessage.hidden = true;
    contactForm.elements.name.focus();
  });
}
