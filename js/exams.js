let currentExam       = null;
let editingId         = null;
let pendingDeleteId   = null;
let actionSheetExamId = null;

// ── Screen navigation ─────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + id).classList.add('active');
}

function goHome() {
  showScreen('home');
  $('topbar-back').classList.remove('visible');
  show($('topbar-logo'));
  loadExamList();
}

// ── Home screen ───────────────────────────────────────────────────

function renderEmptyExamState() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-title">No exams yet</div>
      <div class="empty-state-sub">Tap <strong>Create New Exam</strong> to add your first answer key</div>
    </div>`;
}

function renderExamCard(exam) {
  const answered = exam.answerKey.filter(Boolean).length;
  const total    = exam.questionCount;
  const complete = answered === total;
  const date     = new Date(exam.lastModified).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  return `
    <div class="exam-card" data-exam-id="${exam.id}">
      <div class="exam-card-icon">${complete ? '✅' : '📝'}</div>
      <div class="exam-card-info">
        <div class="exam-card-name">${escHtml(exam.name)}</div>
        <div class="exam-card-meta">${total} questions &middot; ${answered}/${total} keyed &middot; ${date}</div>
      </div>
      <div class="exam-card-arrow">›</div>
    </div>`;
}

async function loadExamList() {
  try {
    const exams = await dbGetAll();
    const list  = $('exam-list');
    if (!exams.length) {
      list.innerHTML = renderEmptyExamState();
      return;
    }
    exams.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
    list.innerHTML = exams.map(renderExamCard).join('');
  } catch (err) {
    console.error('loadExamList error:', err);
    showToast('Could not load exams: ' + (err.message || err), true);
  }
}

// ── Create / Edit screen ──────────────────────────────────────────

function showCreateScreen() {
  editingId   = null;
  currentExam = { answerKey: [] };
  $('exam-name').value   = '';
  $('exam-qcount').value = '';
  $('name-error').classList.remove('visible');
  $('qcount-error').classList.remove('visible');
  hide($('key-section'));
  $('key-grid').innerHTML = '';
  hide($('btn-delete'));
  $('topbar-back').classList.add('visible');
  hide($('topbar-logo'));
  showScreen('create');
}

async function showEditScreen(id) {
  try {
    const exam = await dbGet(id);
    if (!exam) return;
    editingId   = id;
    currentExam = JSON.parse(JSON.stringify(exam));
    $('exam-name').value   = exam.name;
    $('exam-qcount').value = exam.questionCount;
    $('name-error').classList.remove('visible');
    $('qcount-error').classList.remove('visible');
    show($('btn-delete'), 'flex');
    $('topbar-back').classList.add('visible');
    hide($('topbar-logo'));
    buildKeyGrid(exam.questionCount, exam.answerKey);
    showScreen('create');
  } catch (err) {
    console.error('showEditScreen error:', err);
    showToast('Could not open exam: ' + (err.message || err), true);
  }
}

// ── Answer key grid ───────────────────────────────────────────────

function buildKeyGrid(count, existingKey = []) {
  currentExam.questionCount = count;
  const prev = currentExam.answerKey || [];
  currentExam.answerKey = Array.from({ length: count }, (_, i) => prev[i] || existingKey[i] || null);

  const grid = $('key-grid');
  grid.innerHTML = '';

  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'key-row' + (currentExam.answerKey[i] ? ' answered' : '');
    row.id = `key-row-${i}`;

    const qnum = document.createElement('div');
    qnum.className   = 'key-qnum';
    qnum.textContent = i + 1;

    const opts = document.createElement('div');
    opts.className = 'key-options';

    ['A', 'B', 'C', 'D'].forEach(letter => {
      const btn = document.createElement('button');
      btn.className   = 'key-opt' + (currentExam.answerKey[i] === letter ? ` selected-${letter}` : '');
      btn.textContent = letter;
      btn.dataset.q   = i;
      btn.dataset.l   = letter;
      btn.onclick     = () => selectAnswer(i, letter);
      opts.appendChild(btn);
    });

    const status = document.createElement('div');
    status.className   = 'key-status';
    status.id          = `key-status-${i}`;
    status.textContent = currentExam.answerKey[i] ? '✓' : '';

    row.appendChild(qnum);
    row.appendChild(opts);
    row.appendChild(status);
    grid.appendChild(row);
  }

  show($('key-section'));
  updateKeyProgress();
}

function selectAnswer(qIndex, letter) {
  const prev   = currentExam.answerKey[qIndex];
  const newVal = prev === letter ? null : letter;
  currentExam.answerKey[qIndex] = newVal;

  const row = $(`key-row-${qIndex}`);
  row.className = 'key-row' + (newVal ? ' answered' : '');
  row.querySelectorAll('.key-opt').forEach(btn => {
    btn.className = 'key-opt' + (btn.dataset.l === newVal ? ` selected-${newVal}` : '');
  });
  $(`key-status-${qIndex}`).textContent = newVal ? '✓' : '';
  updateKeyProgress();

  if (newVal) {
    const next = findNextUnanswered(qIndex + 1);
    if (next !== -1) setTimeout(() => scrollToRow(next), 120);
  }
}

function findNextUnanswered(from) {
  for (let i = from; i < currentExam.answerKey.length; i++) {
    if (!currentExam.answerKey[i]) return i;
  }
  return -1;
}

function scrollToRow(index) {
  const row = $(`key-row-${index}`);
  if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateKeyProgress() {
  const total = currentExam.answerKey.length;
  const done  = currentExam.answerKey.filter(Boolean).length;
  const pct   = total ? Math.round((done / total) * 100) : 0;
  $('key-progress-label').textContent = `${done} of ${total} answered`;
  $('key-progress-pct').textContent   = `${pct}%`;
  $('key-progress-fill').style.width  = pct + '%';
}

// ── Question count input ──────────────────────────────────────────

let qcountDebounce;

function handleQuestionCountInput() {
  clearTimeout(qcountDebounce);
  qcountDebounce = setTimeout(() => {
    const val = parseInt($('exam-qcount').value);
    const err = $('qcount-error');
    if (!val || val < 1 || val > 60) {
      if ($('exam-qcount').value.trim() !== '') {
        err.textContent = 'Enter a number between 1 and 60.';
        err.classList.add('visible');
      }
      hide($('key-section'));
      return;
    }
    err.classList.remove('visible');
    buildKeyGrid(val, currentExam ? currentExam.answerKey : []);
  }, 400);
}

// ── Save ──────────────────────────────────────────────────────────

async function saveExam() {
  const nameEl    = $('exam-name');
  const qcountEl  = $('exam-qcount');
  const nameErr   = $('name-error');
  const qcountErr = $('qcount-error');
  let valid = true;

  const name   = nameEl.value.trim();
  const qcount = parseInt(qcountEl.value);

  if (!name) {
    nameErr.textContent = 'Please enter an exam name.';
    nameErr.classList.add('visible');
    valid = false;
  } else {
    nameErr.classList.remove('visible');
  }

  if (!qcount || qcount < 1 || qcount > 60) {
    qcountErr.textContent = 'Enter a number between 1 and 60.';
    qcountErr.classList.add('visible');
    valid = false;
  } else {
    qcountErr.classList.remove('visible');
  }

  if (!valid) return;

  try {
    if (!currentExam || !currentExam.answerKey || currentExam.questionCount !== qcount) {
      buildKeyGrid(qcount, currentExam ? currentExam.answerKey : []);
    }

    const existing = await dbGetByName(name);
    if (existing && existing.id !== editingId) {
      nameErr.textContent = 'An exam with this name already exists.';
      nameErr.classList.add('visible');
      return;
    }

    const exam = {
      id:            editingId || generateUUID(),
      name,
      questionCount: qcount,
      answerKey:     Array.from({ length: qcount }, (_, i) => (currentExam.answerKey || [])[i] || null),
      createdAt:     editingId ? (currentExam.createdAt || Date.now()) : Date.now(),
      lastModified:  Date.now(),
    };

    await dbPut(exam);
    showToast(editingId ? 'Exam updated ✓' : 'Exam saved ✓');
    setTimeout(() => goHome(), 500);

  } catch (err) {
    console.error('saveExam error:', err);
    showToast('Save failed: ' + (err.message || err), true);
  }
}

// ── Delete (from Edit screen) ─────────────────────────────────────

function confirmDelete() {
  if (!editingId) return;
  pendingDeleteId = editingId;
  $('delete-modal-name').textContent = '"' + $('exam-name').value.trim() + '"';
  $('delete-modal').classList.add('visible');
}

function closeDeleteModal() {
  $('delete-modal').classList.remove('visible');
  pendingDeleteId = null;
}

async function deleteExam() {
  if (!pendingDeleteId) return;
  try {
    await dbDelete(pendingDeleteId);
    closeDeleteModal();
    showToast('Exam deleted');
    setTimeout(() => goHome(), 300);
  } catch (err) {
    console.error('deleteExam error:', err);
    showToast('Delete failed: ' + (err.message || err), true);
  }
}

// ── Action sheet ──────────────────────────────────────────────────

async function showExamActions(id) {
  try {
    const exam = await dbGet(id);
    if (!exam) return;
    actionSheetExamId = id;
    $('action-sheet-name').textContent = exam.name;
    $('action-sheet-overlay').classList.add('visible');
  } catch (err) {
    console.error('showExamActions error:', err);
    showToast('Could not open exam: ' + (err.message || err), true);
  }
}

function closeActionSheet() {
  $('action-sheet-overlay').classList.remove('visible');
  actionSheetExamId = null;
}

function editFromActionSheet() {
  const id = actionSheetExamId;
  closeActionSheet();
  showEditScreen(id);
}

async function deleteFromActionSheet() {
  try {
    const id   = actionSheetExamId;
    const exam = await dbGet(id);
    if (!exam) return;
    pendingDeleteId = id;
    $('delete-modal-name').textContent = '"' + exam.name + '"';
    closeActionSheet();
    setTimeout(() => $('delete-modal').classList.add('visible'), 200);
  } catch (err) {
    console.error('deleteFromActionSheet error:', err);
    showToast('Could not delete exam: ' + (err.message || err), true);
  }
}
