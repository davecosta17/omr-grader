// results.js — result screen after a sheet is processed
// Uses gradingExam.computedTemplate set by camera.js

let pendingResult = null;

async function showResultScreen(dataUrl) {
  const resultScreen   = $('screen-result');
  const processing     = $('result-processing');
  const answersPanel   = $('result-answers-panel');
  const candidateLabel = $('result-candidate-label');
  const scoreBadge     = $('result-score-badge');
  const answersGrid    = $('result-answers-grid');
  const flagsEl        = $('result-flags');

  resultScreen.classList.add('active');
  processing.classList.remove('hidden');
  answersPanel.style.opacity = '0';
  candidateLabel.textContent = 'Processing…';
  scoreBadge.textContent     = '—';

  try {
    const qCount           = gradingExam.questionCount;
    const computedTemplate = gradingExam.resolvedTemplate || gradingExam.computedTemplate;

    if (!computedTemplate) {
      throw new Error('No template for this exam. Edit the exam and select a template.');
    }

    const { answers, bubbleMap, width, height } =
      await processSheet(dataUrl, computedTemplate, qCount);

    const key = gradingExam.answerKey;
    let correct = 0;
    answers.forEach((ans, i) => { if (ans === key[i]) correct++; });

    const flagged = answers.some(a => a === 'BLANK' || a === 'DOUBLE');
    const pct     = Math.round((correct / qCount) * 100);

    pendingResult = { dataUrl, answers, bubbleMap, score: `${correct}/${qCount}`, correct, qCount, flagged };

    await drawDebugOverlay(dataUrl, bubbleMap, width, height, computedTemplate);

    processing.classList.add('hidden');
    candidateLabel.textContent = 'Sheet processed';
    scoreBadge.textContent     = `${pct}%`;
    answersGrid.innerHTML      = renderResultAnswers(answers, key);

    if (flagged) {
      flagsEl.textContent = buildResultFlagsMessage(answers);
      flagsEl.classList.add('visible');
    } else {
      flagsEl.classList.remove('visible');
    }

    answersPanel.style.opacity = '1';

  } catch (err) {
    console.error('Processing error:', err);
    processing.classList.add('hidden');
    candidateLabel.textContent = 'Read failed';
    showToast('Could not read sheet — try retaking', true);
  }
}

function discardResult() {
  $('screen-result').classList.remove('active');
  pendingResult = null;
  // Return to camera so the teacher can retake the shot
  showCameraScreen();
  initCamera();
}

function confirmResult() {
  if (!pendingResult) return;

  sessionResults.push({
    dataUrl:   pendingResult.dataUrl,
    answers:   pendingResult.answers,
    score:     pendingResult.score,
    correct:   pendingResult.correct,
    qCount:    pendingResult.qCount,
    flagged:   pendingResult.flagged,
    timestamp: Date.now(),
  });

  const saved = sessionResults.length;
  updateCamCounter();
  updateFinishBtn();
  pendingResult = null;

  // Hide result screen and return to camera for the next sheet.
  // The camera stream was stopped in usePhoto(), so we restart it.
  $('screen-result').classList.remove('active');
  showToast(`Sheet ${saved} saved ✓`);
  showCameraScreen();   // defined in camera.js — re-shows camera UI
  initCamera();         // defined in camera.js — restarts the stream
}