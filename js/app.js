// app.js — entry point: wires all event listeners and boots the app

function initEventListeners() {

  // ── Home ────────────────────────────────────────────────────────
  on('btn-create-exam', 'click', showCreateScreen);
  on('topbar-back',     'click', goHome);

  // Exam list uses event delegation (cards are dynamically rendered)
  $('exam-list').addEventListener('click', e => {
    const card = e.target.closest('.exam-card[data-exam-id]');
    if (card) showExamActions(card.dataset.examId);
  });

  // ── Create / Edit ─────────────────────────────────────────────
  on('exam-qcount', 'input', handleQuestionCountInput);
  on('btn-save',    'click', saveExam);
  on('btn-delete',  'click', confirmDelete);

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
  on('btn-preview-retake', 'click', retakePhoto);
  on('btn-preview-use',    'click', usePhoto);

  // ── Result ────────────────────────────────────────────────────
  on('btn-result-back',    'click', discardResult);
  on('btn-result-discard', 'click', discardResult);
  on('btn-result-confirm', 'click', confirmResult);
}

// ── Service Worker registration ───────────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.warn('SW registration failed:', err));
  }
}

// ── Boot ─────────────────────────────────────────────────────────
initEventListeners();
registerServiceWorker();
openDB()
  .then(() => loadExamList())
  .catch(err => showToast('Storage error: ' + (err.message || err), true));