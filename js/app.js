// app.js — entry point: wires all event listeners and boots the app

function initEventListeners() {

  // ── Home ──────────────────────────────────────────────────────
  on('btn-create-exam', 'click', showCreateScreen);
  on('topbar-back',     'click', goHome);

  $('exam-list').addEventListener('click', e => {
    const card = e.target.closest('.exam-card[data-exam-id]');
    if (card) showExamActions(card.dataset.examId);
  });

  // ── Template picker ───────────────────────────────────────────
  on('btn-template-calibrate', 'click', startCalibrateFromPicker);
  on('btn-template-cancel',    'click', closeTemplatePicker);

  $('template-picker-list').addEventListener('click', handleTemplatePickerClick);

  $('template-picker-overlay').addEventListener('click', e => {
    if (e.target === $('template-picker-overlay')) closeTemplatePicker();
  });

  // ── Create / Edit ─────────────────────────────────────────────
  on('exam-qcount',         'input', handleQuestionCountInput);
  on('btn-save',            'click', saveExam);
  on('btn-delete',          'click', confirmDelete);
  on('btn-change-template', 'click', showTemplatePicker);

  // ── Action sheet ──────────────────────────────────────────────
  on('btn-action-grade',  'click', startGradingSession);
  on('btn-action-edit',   'click', editFromActionSheet);
  on('btn-action-delete', 'click', deleteFromActionSheet);
  on('btn-action-cancel', 'click', closeActionSheet);

  $('action-sheet-overlay').addEventListener('click', e => {
    if (e.target === $('action-sheet-overlay')) closeActionSheet();
  });

  // ── Delete modal ──────────────────────────────────────────────
  on('btn-delete-cancel',  'click', closeDeleteModal);
  on('btn-delete-confirm', 'click', deleteExam);

  $('delete-modal').addEventListener('click', e => {
    if (e.target === $('delete-modal')) closeDeleteModal();
  });

  // ── Camera ────────────────────────────────────────────────────
  on('btn-camera-back', 'click', stopCamera);
  on('cam-flash-btn',   'click', toggleFlash);
  on('cam-shutter',     'click', capturePhoto);
  on('btn-cam-finish',  'click', finishSession);

  // ── Preview ───────────────────────────────────────────────────
  on('btn-preview-retake',  'click', retakePhoto);
  on('btn-preview-use',     'click', usePhoto);
  on('btn-preview-adjust',  'click', adjustAndGrade);

  // ── Result ────────────────────────────────────────────────────
  on('btn-result-back',    'click', discardResult);
  on('btn-result-discard', 'click', discardResult);
  on('btn-result-confirm', 'click', confirmResult);

  // ── Corner adjust ─────────────────────────────────────────────
  on('btn-cadj-cancel',  'click', cancelCornerAdjust);
  on('cadj-confirm-btn', 'click', confirmCornerAdjust);

  // ── Calibration ───────────────────────────────────────────────
  on('btn-calib-save',   'click', saveCalibration);
  on('btn-calib-cancel', 'click', () => {
    hideCalibrationScreen();
  });

  // ── Hard reset ────────────────────────────────────────────────
  on('btn-hard-refresh', 'click', showResetModal);
  on('btn-reset-cancel',  'click', closeResetModal);
  on('btn-reset-confirm', 'click', hardReset);

  $('reset-modal').addEventListener('click', e => {
    if (e.target === $('reset-modal')) closeResetModal();
  });
}

// ── Hard reset ────────────────────────────────────────────────────

function showResetModal() { $('reset-modal').classList.add('visible'); }
function closeResetModal() { $('reset-modal').classList.remove('visible'); }

async function hardReset() {
  try {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('ges_omr');
      req.onsuccess = resolve; req.onerror = reject; req.onblocked = resolve;
    });
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    location.reload(true);
  } catch (err) {
    console.error('Hard reset error:', err);
    showToast('Reset failed: ' + (err.message || err), true);
  }
}

// ── Service Worker ────────────────────────────────────────────────

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.warn('SW registration failed:', err));
  }
}

// ── Boot ─────────────────────────────────────────────────────────
initEventListeners();
initCalibration();    // calibration.js
initCornerAdjust();   // corner-adjust.js
registerServiceWorker();
openDB()
  .then(() => loadExamList())
  .catch(err => showToast('Storage error: ' + (err.message || err), true));