import {
  api,
  clearFormErrors,
  qs,
  setFormStatus,
  setLoading,
  showFormErrors,
  toast,
} from './ui.js';

const form = qs('[data-feedback-form]');

if (form) {
  const status = form.querySelector('[data-form-status]');
  const submit = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    setFormStatus(status, '');

    const name = form.querySelector('[name="name"]').value.trim();
    const contact = form.querySelector('[name="contact"]').value.trim();
    const message = form.querySelector('[name="message"]').value.trim();
    const consent = form.querySelector('[name="consent"]').checked;
    const website = form.querySelector('[name="website"]')?.value ?? '';
    const errors = {};

    if (name.length < 2) errors.name = 'Укажите имя — минимум 2 символа.';
    if (contact.length < 3) errors.contact = 'Оставьте телефон, e-mail или Telegram.';
    if (message.length < 10) errors.message = 'Расскажите чуть подробнее — минимум 10 символов.';
    if (!consent) errors.consent = 'Отметьте согласие на обработку данных.';

    if (Object.keys(errors).length) {
      showFormErrors(form, errors);
      return;
    }

    setLoading(submit, true);
    try {
      await api('/api/feedback', {
        method: 'POST',
        body: { name, contact, message, consent, website },
      });
      form.reset();
      setFormStatus(
        status,
        'Спасибо! Сообщение отправлено. Ответим в рабочие часы, обычно в течение 1–2 часов.',
        'success',
      );
      toast('Сообщение отправлено врачу.', 'success');
    } catch (error) {
      if (error.fields) {
        showFormErrors(form, error.fields);
      } else {
        setFormStatus(
          status,
          `${error.message} Если вопрос срочный — напишите в Telegram или звоните 103.`,
          'error',
        );
      }
    } finally {
      setLoading(submit, false);
    }
  });
}
