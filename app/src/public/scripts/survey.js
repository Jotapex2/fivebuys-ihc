const surveyDialog = document.querySelector('[data-survey-dialog]');
const surveyForm = document.querySelector('[data-survey-form]');
const surveyStatus = document.querySelector('[data-survey-status]');
const surveyConfirm = document.querySelector('[data-survey-confirm]');
const surveyRetry = document.querySelector('[data-survey-retry]');
const surveyNow = document.querySelector('[data-survey-now]');
const surveyPause = document.querySelector('[data-survey-pause]');
let surveyRequestId;
let surveyCheckoutId;
let surveyToken;
let surveySending = false;
let surveyGeneration = 0;
let surveyRedirectTimer;
let surveyCountdownTimer;
const surveyCountdown = document.querySelector('[data-survey-countdown]');
let surveyCheckoutUrl;
let surveyTransition;
let surveyTransitionId = 0;

function clearSurveyCountdown() {
  clearTimeout(surveyRedirectTimer);
  clearInterval(surveyCountdownTimer);
  surveyCountdown.hidden = true;
  surveyStatus.classList.remove('sr-only');
}

function stopSurveyRedirect() {
  clearSurveyCountdown();
  surveyCheckoutUrl = undefined;
  surveyNow.hidden = true;
  surveyPause.hidden = true;
}

function surveyAnimationFrames(opening) {
  const trigger = document.querySelector('[data-survey-open]').getBoundingClientRect();
  const surface = surveyDialog.getBoundingClientRect();
  const x = trigger.left + trigger.width / 2 - surface.left - surface.width / 2;
  const y = trigger.top + trigger.height / 2 - surface.top - surface.height / 2;
  surveyDialog.style.transformOrigin = `${trigger.left + trigger.width / 2 - surface.left}px ${trigger.top + trigger.height / 2 - surface.top}px`;
  const anchored = { transform: `translate(${x * .18}px, ${y * .18}px) scale(.95)`, clipPath: 'inset(12% 4% 12% 4% round 24px)', opacity: .8 };
  const settled = { transform: 'translate(0,0) scale(1)', clipPath: 'inset(0 round 24px)', opacity: 1 };
  return opening ? [anchored, { ...settled, offset: .8, transform: `translate(${x * -.012}px, ${y * .018}px) scale(.999)` }, settled]
    : [{ transform: getComputedStyle(surveyDialog).transform, clipPath: getComputedStyle(surveyDialog).clipPath, opacity: getComputedStyle(surveyDialog).opacity }, anchored];
}

function animateSurvey(opening) {
  const frames = surveyAnimationFrames(opening);
  surveyTransition?.cancel();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  surveyTransition = surveyDialog.animate(frames, { duration: opening ? 350 : 280, easing: opening ? 'cubic-bezier(.16,1,.3,1)' : 'cubic-bezier(.7,0,.84,0)', fill: 'none' });
  return surveyTransition.finished.catch(() => {});
}

async function returnFromSurvey() {
  stopSurveyRedirect();
  surveyGeneration += 1;
  const transitionId = ++surveyTransitionId;
  surveyToken = undefined;
  await animateSurvey(false);
  if (transitionId !== surveyTransitionId) return;
  if (surveyDialog.open) surveyDialog.close();
  const opener = document.querySelector('[data-survey-open]');
  if (!opener.disabled) opener.focus();
  else document.addEventListener('fivebuys:checkout-idle', () => {
    if (!surveyDialog.open && document.activeElement === document.body) opener.focus();
  }, { once: true });
}

function refreshSurveyStars(fieldset, preview) {
  const selected = preview ?? Number(fieldset.querySelector('input:checked')?.value || 0);
  fieldset.querySelectorAll('[data-star-value]').forEach(label => {
    label.dataset.filled = String(Number(label.dataset.starValue) <= selected);
  });
}

document.querySelector('[data-survey-open]').addEventListener('click', () => {
  if (checkoutBusy) return;
  surveyRequestId = crypto.randomUUID();
  surveyCheckoutId = crypto.randomUUID();
  surveyToken = undefined;
  surveyGeneration += 1;
  surveySending = false;
  surveyTransitionId += 1;
  surveyForm.reset();
  surveyForm.querySelectorAll('fieldset').forEach(fieldset => {
    refreshSurveyStars(fieldset);
    fieldset.querySelector('[data-rating-error]').hidden = true;
    fieldset.querySelectorAll('input').forEach(input => input.removeAttribute('aria-invalid'));
  });
  document.querySelector('[data-survey-heading]').hidden = false;
  surveyDialog.setAttribute('aria-labelledby', 'survey-title');
  surveyDialog.setAttribute('aria-describedby', 'survey-intro');
  surveyForm.hidden = false;
  surveyConfirm.hidden = true;
  surveyRetry.hidden = true;
  surveyStatus.textContent = '';
  stopSurveyRedirect();
  surveyDialog.showModal();
  document.querySelector('#survey-title').focus();
  animateSurvey(true);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    surveyForm.querySelectorAll('fieldset').forEach((row, index) => row.animate([
      { clipPath: 'inset(0 0 100% 0)', transform: 'translateY(5px)' },
      { clipPath: 'inset(0)', transform: 'translateY(0)' }
    ], { duration: 250, delay: index * 30, easing: 'ease-out', fill: 'backwards' }));
  }
});

surveyDialog.addEventListener('cancel', event => {
  event.preventDefault();
  returnFromSurvey();
});
document.querySelector('[data-survey-back]').addEventListener('click', returnFromSurvey);
document.querySelector('[data-survey-dismiss]').addEventListener('click', returnFromSurvey);
document.querySelector('[data-survey-stop]').addEventListener('click', returnFromSurvey);

document.querySelector('[data-survey-skip]').addEventListener('click', async () => {
  if (surveySending || checkoutBusy) return;
  const generation = surveyGeneration;
  surveySending = true;
  const skip = document.querySelector('[data-survey-skip]');
  const previousLabel = skip.textContent;
  skip.setAttribute('aria-disabled', 'true');
  skip.textContent = 'Abriendo pago…';
  surveyStatus.textContent = 'Estamos conectando con Stripe. Espera un momento.';
  surveyDialog.classList.add('survey-preparing');
  try {
    const data = await beginCheckout({ redirect: false });
    if (surveyDialog.open && generation === surveyGeneration) {
      // El recuadro deja paso al pago sin añadir otra espera de animación.
      surveyTransition?.cancel();
      surveyDialog.close();
      window.location.assign(data.url);
    }
  } catch (error) {
    if (surveyDialog.open && generation === surveyGeneration) surveyStatus.textContent = error.message;
  } finally {
    surveySending = false;
    skip.removeAttribute('aria-disabled');
    skip.textContent = previousLabel;
    surveyDialog.classList.remove('survey-preparing');
  }
});

function showSurveyTotals(data) {
  renderMoney(document.querySelector('[data-survey-subtotal]'), data.subtotal, { suffix: ' CLP' });
  renderMoney(document.querySelector('[data-survey-discount]'), data.discount, { prefix: '−', suffix: ' CLP' });
  renderMoney(document.querySelector('[data-survey-total]'), data.total, { suffix: ' CLP' });
}

async function continueSurveyCheckout() {
  if (checkoutBusy) return;
  const generation = surveyGeneration;
  surveyRetry.hidden = true;
  stopSurveyRedirect();
  surveyStatus.textContent = 'Preparando pago…';
  surveyStatus.classList.remove('error');
  try {
    const data = await beginCheckout({ surveyToken, requestId: surveyCheckoutId, redirect: false });
    if (!surveyDialog.open || generation !== surveyGeneration) return;
    showSurveyTotals(data);
    surveyCheckoutUrl = data.url;
    surveyNow.hidden = false;
    surveyPause.hidden = false;
    const deadline = Date.now() + 10000;
    let lastSecond;
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (remaining === lastSecond) return;
      lastSecond = remaining;
      document.querySelector('[data-survey-seconds]').textContent = String(remaining);
      document.querySelector('[data-survey-seconds-unit]').textContent = remaining === 1 ? 'segundo' : 'segundos';
      if (remaining === 5) surveyStatus.textContent = 'Quedan 5 segundos para abrir Stripe.';
    };
    surveyStatus.classList.add('sr-only');
    surveyStatus.textContent = 'Tu pago está listo. Stripe se abrirá en 10 segundos. Puedes pausar.';
    updateCountdown();
    surveyCountdown.hidden = false;
    surveyCountdownTimer = setInterval(updateCountdown, 250);
    surveyRedirectTimer = setTimeout(() => {
      if (surveyDialog.open && generation === surveyGeneration && surveyCheckoutUrl) {
        clearSurveyCountdown();
        surveyStatus.textContent = 'Abriendo Stripe…';
        window.location.assign(surveyCheckoutUrl);
      }
    }, 10000);
  } catch (error) {
    if (!surveyDialog.open || generation !== surveyGeneration) return;
    surveyStatus.classList.add('error');
    surveyStatus.textContent = error.message;
    surveyRetry.hidden = false;
  }
}

surveyForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (surveySending || checkoutBusy) return;
  let firstInvalid;
  const ratings = [...surveyForm.querySelectorAll('fieldset')].map(fieldset => {
    const selected = fieldset.querySelector('input:checked');
    fieldset.querySelector('[data-rating-error]').hidden = Boolean(selected);
    fieldset.querySelectorAll('input').forEach(input => {
      if (selected) input.removeAttribute('aria-invalid');
      else input.setAttribute('aria-invalid', 'true');
    });
    if (!selected && !firstInvalid) firstInvalid = fieldset.querySelector('input');
    return selected ? Number(selected.value) : null;
  });
  if (firstInvalid) {
    surveyStatus.textContent = ''; // El campo enfocado anuncia su error asociado una sola vez.
    firstInvalid.focus();
    return;
  }
  const generation = surveyGeneration;
  surveySending = true;
  const submit = surveyForm.querySelector('[type="submit"]');
  submit.disabled = true;
  surveyStatus.textContent = 'Guardando tus respuestas…';
  try {
    const data = await purchaseRequest('/purchase-survey', { requestId: surveyRequestId, items: purchaseItems(), ratings,
      comments: surveyForm.elements.comments.value });
    if (!surveyDialog.open || generation !== surveyGeneration) return;
    surveyToken = data.surveyToken;
    showSurveyTotals(data);
    document.querySelector('[data-survey-heading]').hidden = true;
    surveyDialog.setAttribute('aria-labelledby', 'survey-confirm-title');
    surveyDialog.removeAttribute('aria-describedby');
    surveyForm.hidden = true;
    surveyConfirm.hidden = false;
    document.querySelector('[data-survey-confirm-title]').focus();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      surveyConfirm.animate([{ transform: 'scale(.98)' }, { transform: 'scale(1.015)', offset: .5 }, { transform: 'scale(1)' }], { duration: 350, easing: 'ease-in-out' });
    }
    await continueSurveyCheckout();
  } catch (error) {
    if (surveyDialog.open && generation === surveyGeneration) surveyStatus.textContent = error.message;
  } finally {
    surveySending = false;
    submit.disabled = false;
  }
});

surveyRetry.addEventListener('click', continueSurveyCheckout);
surveyPause.addEventListener('click', () => {
  clearSurveyCountdown();
  surveyStatus.textContent = 'Redirección pausada.';
});
surveyForm.addEventListener('change', event => {
  const fieldset = event.target.closest('.purchase-question');
  if (!fieldset || !fieldset.querySelector('input:checked')) return;
  refreshSurveyStars(fieldset);
  fieldset.querySelector('[data-rating-error]').hidden = true;
  fieldset.querySelectorAll('input').forEach(input => input.removeAttribute('aria-invalid'));
  if (surveyForm.querySelectorAll('input:checked').length === 1 && surveyStatus.textContent.startsWith('Elige una calificación')) {
    surveyStatus.textContent = '';
  }
});
surveyNow.addEventListener('click', () => {
  if (surveyCheckoutUrl) {
    clearSurveyCountdown();
    surveyStatus.textContent = 'Abriendo Stripe…';
    window.location.assign(surveyCheckoutUrl);
  }
});

// El hover solo previsualiza; la respuesta se registra únicamente al seleccionar.
surveyForm.querySelectorAll('.purchase-stars').forEach(stars => {
  stars.addEventListener('pointerover', event => {
    const label = event.target.closest('[data-star-value]');
    if (label) refreshSurveyStars(stars.closest('fieldset'), Number(label.dataset.starValue));
  });
  stars.addEventListener('pointerleave', () => refreshSurveyStars(stars.closest('fieldset')));
});
