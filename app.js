(() => {
  const { CalculationError, calculateInitial, recalculate, prefillAdjustment } = CalorieCalculator;
  const format = new Intl.NumberFormat('ru-RU');
  const activityDescriptions = {
    low: 'Преимущественно сидячая работа, мало ходьбы и бытовой активности.',
    moderate: 'Регулярная ходьба, умеренная повседневная активность и/или тренировки.',
    high: 'Физически активная работа, много движения и/или интенсивные регулярные тренировки.',
  };
  const startForm = document.getElementById('start-form');
  const adjustForm = document.getElementById('adjust-form');
  const startError = document.getElementById('start-error');
  const adjustError = document.getElementById('adjust-error');
  const guide = document.getElementById('check-guide');
  const announcer = document.getElementById('announcer');
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const startView = createResultView('start-result');
  const adjustView = createResultView('adjust-result');
  const macros = { protein: 'Белки', fat: 'Жиры', carbs: 'Углеводы' };
  let hasStartResult = false;

  function resultText(result) {
    const lines = [`${format.format(result.calories)} ккал / день`];
    for (const [key, label] of Object.entries(macros)) {
      lines.push(`${label} — ${format.format(result[key])} г`);
    }
    return lines.join('\n');
  }

  function createResultView(id) {
    const container = document.getElementById(id);
    container.append(document.getElementById('result-template').content.cloneNode(true));
    const heading = container.querySelector('h2');
    const context = container.querySelector('.result-context');
    const note = container.querySelector('.result-note');
    const copyButton = container.querySelector('.copy');
    const copyStatus = container.querySelector('.copy-status');
    const manualCopy = container.querySelector('.manual-copy');
    const textarea = manualCopy.querySelector('textarea');
    const values = Array.from(container.querySelectorAll('[data-value]'));
    let currentResult;
    heading.textContent = container.dataset.label;

    copyButton.addEventListener('click', async () => {
      const result = currentResult;
      const text = resultText(result);
      let copied = false;
      try {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch {
        // Clipboard access can be restricted in local files or embedded previews.
      }
      if (result !== currentResult) return;
      if (!copied) {
        manualCopy.hidden = false;
        textarea.value = text;
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, text.length);
        try {
          copied = document.execCommand('copy');
        } catch {
          // Keep the selected text available for manual copying.
        }
        if (copied) {
          manualCopy.hidden = true;
          copyButton.focus();
        }
      }
      copyStatus.hidden = false;
      copyStatus.textContent = copied ? 'КБЖУ скопированы.' : 'Скопируйте выделенный текст вручную.';
    });

    return {
      focus() { heading.focus(); },
      render(result, summary = '', message = '') {
        currentResult = result;
        for (const value of values) {
          value.textContent = result ? format.format(result[value.dataset.value]) : '—';
        }
        context.hidden = !summary;
        context.textContent = summary;
        note.textContent = message || 'Заполните поля, чтобы увидеть результат.';
        copyButton.disabled = !result;
        copyStatus.hidden = true;
        copyStatus.textContent = '';
        manualCopy.hidden = true;
        textarea.value = '';
      },
    };
  }

  function selectTab(selected, moveFocus = false) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
    guide.hidden = selected !== tabs[0] || !hasStartResult;
    if (moveFocus) selected.focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      const next = { ArrowLeft: 1 - index, ArrowRight: 1 - index, Home: 0, End: 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[next], true);
    });
  });

  function clearError(form, box) {
    for (const field of form.querySelectorAll('[aria-invalid]')) {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-errormessage');
    }
    box.hidden = true;
    box.textContent = '';
  }

  function showError(form, box, error, moveFocus = false) {
    if (!(error instanceof CalculationError)) throw error;
    const field = error.field ? form.elements.namedItem(error.field) : null;
    box.hidden = false;
    box.textContent = error.message;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-errormessage', box.id);
    }
    if (moveFocus) {
      if (!field) box.tabIndex = -1;
      (field || box).focus();
    }
  }

  function updateStartFields() {
    const target = startForm.elements.targetWeight;
    const maintain = startForm.elements.goal.value === 'maintain';
    target.disabled = maintain;
    document.getElementById('target-field').hidden = maintain;
    const description = activityDescriptions[startForm.elements.activity.value] || 'Учитывайте ходьбу, работу и тренировки.';
    document.getElementById('activity-hint').textContent =
      `${description} Коэффициенты приблизительные. Даже при тренировках общая активность может быть невысокой.`;
  }

  function updateAdjustment(announce = false) {
    clearError(adjustForm, adjustError);
    const input = Object.fromEntries(new FormData(adjustForm));
    if ([input.currentCalories, input.weight, input.targetWeight].some((value) => !value.trim())) {
      adjustView.render(null);
      if (announce) announcer.textContent = 'Заполните поля перерасчёта.';
      return;
    }
    try {
      const result = recalculate(input);
      const summary = result.correction
        ? `Корректировка ${result.correction < 0 ? '−' : '+'}${Math.abs(result.correction)}%`
        : 'Калорийность без изменений';
      adjustView.render(result, summary, 'Используйте средний вес за неделю, чтобы оценить изменения.');
      if (announce) announcer.textContent = resultText(result);
    } catch (error) {
      showError(adjustForm, adjustError, error);
      adjustView.render(null, '', 'Проверьте параметры перерасчёта.');
      if (announce) announcer.textContent = error.message;
    }
  }

  startForm.addEventListener('input', () => {
    clearError(startForm, startError);
    updateStartFields();
    if (hasStartResult) {
      hasStartResult = false;
      guide.hidden = true;
      startView.render(null, '', 'Нажмите «Рассчитать», чтобы обновить результат.');
    }
  });

  startForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearError(startForm, startError);
    try {
      const result = calculateInitial(Object.fromEntries(new FormData(startForm)));
      const summary = `Поддержание: ${format.format(result.maintenance)} ккал · Дефицит: ${result.correction ? '−10%' : '0%'}`;
      startView.render(result, summary, 'Это расчётная отправная точка. Фактическая потребность в калориях может отличаться. Расчёт не гарантирует определённую скорость изменения веса.');
      hasStartResult = true;
      guide.hidden = false;
      for (const [name, value] of Object.entries(prefillAdjustment(result))) {
        adjustForm.elements.namedItem(name).value = String(value).replace('.', ',');
      }
      updateAdjustment();
      startView.focus();
      announcer.textContent = resultText(result);
    } catch (error) {
      hasStartResult = false;
      guide.hidden = true;
      startView.render(null, '', 'Проверьте параметры расчёта.');
      showError(startForm, startError, error, true);
    }
  });

  adjustForm.addEventListener('input', () => updateAdjustment());
  adjustForm.addEventListener('change', () => updateAdjustment(true));
  adjustForm.addEventListener('submit', (event) => {
    event.preventDefault();
    updateAdjustment(true);
  });
  updateStartFields();
  updateAdjustment();
})();
