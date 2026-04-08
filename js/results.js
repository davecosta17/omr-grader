// results.js — result screen after a sheet is processed
// Uses gradingExam.computedTemplate set by camera.js

let pendingResult = null;
const AMBIGUITY_MARGIN_THRESHOLD = 0.06;

async function showResultScreen(dataUrl) {
  const resultScreen   = $('screen-result');
  const processing     = $('result-processing');
  const answersPanel   = $('result-answers-panel');
  const candidateLabel = $('result-candidate-label');
  const scoreBadge     = $('result-score-badge');
  const answersGrid    = $('result-answers-grid');
  const flagsEl        = $('result-flags');
  const confirmBtn     = $('btn-result-confirm');

  resultScreen.classList.add('active');
  processing.classList.remove('hidden');
  answersPanel.style.opacity = '0';
  candidateLabel.textContent = 'Processing…';
  scoreBadge.textContent     = '—';
  if (confirmBtn) confirmBtn.textContent = 'Confirm & Next →';

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
    const quality = evaluateSheetQuality(answers, bubbleMap, qCount);

    pendingResult = {
      dataUrl,
      answers,
      bubbleMap,
      score: `${correct}/${qCount}`,
      correct,
      qCount,
      flagged,
      quality,
      reviewAcknowledged: false,
    };

    await drawDebugOverlay(dataUrl, bubbleMap, width, height, computedTemplate);

    processing.classList.add('hidden');
    candidateLabel.textContent = 'Sheet processed';
    scoreBadge.textContent     = `${pct}%`;
    answersGrid.innerHTML      = renderResultAnswers(answers, key);

    if (quality.needsReview) {
      let msg = flagged ? buildResultFlagsMessage(answers) : '⚠️ Review recommended.';
      if (quality.ambiguous.length) {
        msg += ` Low-confidence marks: ${quality.ambiguous.map(n => `Q${n}`).join(', ')}.`;
      }
      msg += ' Please verify before saving.';
      flagsEl.textContent = msg;
      flagsEl.classList.add('visible');
      if (confirmBtn) confirmBtn.textContent = 'Confirm Anyway →';
    } else {
      flagsEl.classList.remove('visible');
      if (confirmBtn) confirmBtn.textContent = 'Confirm & Next →';
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
  const btn = $('btn-result-confirm');
  if (btn) btn.textContent = 'Confirm & Next →';
  // Return to camera so the teacher can retake the shot
  showCameraScreen();
  initCamera();
}

function confirmResult() {
  if (!pendingResult) return;
  if (pendingResult.quality?.needsReview && !pendingResult.reviewAcknowledged) {
    pendingResult.reviewAcknowledged = true;
    showToast('Review needed: tap “Confirm Anyway” again to save this sheet', true);
    return;
  }

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
  const btn = $('btn-result-confirm');
  if (btn) btn.textContent = 'Confirm & Next →';

  // Hide result screen and return to camera for the next sheet.
  // The camera stream was stopped in usePhoto(), so we restart it.
  $('screen-result').classList.remove('active');
  showToast(`Sheet ${saved} saved ✓`);
  showCameraScreen();   // defined in camera.js — re-shows camera UI
  initCamera();         // defined in camera.js — restarts the stream
}

function evaluateSheetQuality(answers, bubbleMap, qCount) {
  const ambiguous = [];
  let marginSum = 0;
  let marginCount = 0;

  bubbleMap.forEach((row, idx) => {
    const darkness = row.bubbles.map(b => b.darkness).sort((a, b) => b - a);
    if (darkness.length < 2) return;
    const margin = darkness[0] - darkness[1];
    marginSum += margin;
    marginCount++;
    const answer = answers[idx];
    if (answer !== 'BLANK' && answer !== 'DOUBLE' && margin < AMBIGUITY_MARGIN_THRESHOLD) {
      ambiguous.push(idx + 1);
    }
  });

  const avgMargin = marginCount ? (marginSum / marginCount) : 0;
  const blankOrDouble = answers.filter(a => a === 'BLANK' || a === 'DOUBLE').length;
  const issueRate = qCount ? (blankOrDouble + ambiguous.length) / qCount : 1;
  const confidence = Math.max(0, Math.min(1, avgMargin * 6)) * (1 - Math.min(0.6, issueRate));

  return {
    avgMargin,
    ambiguous,
    blankOrDouble,
    confidence: Math.round(confidence * 100) / 100,
    needsReview: blankOrDouble > 0 || ambiguous.length >= Math.max(2, Math.ceil(qCount * 0.08)),
  };
}
