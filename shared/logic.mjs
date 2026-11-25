// Darsaty shared domain logic. Pure functions: used by the API, the front end
// and the unit tests, so rules are tested once and behave the same everywhere.

export const PASS_SCORE_DEFAULT = 70;

/** Clamp a number into [min, max]. */
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Progress percentage for an enrollment: completed lessons / total lessons. */
export function progressPct(completedCount, totalLessons) {
  if (!Number.isFinite(totalLessons) || totalLessons <= 0) return 0;
  return clamp(Math.round((completedCount / totalLessons) * 100), 0, 100);
}

/** Score a quiz submission. answers[i] is the chosen option index for question i
 *  (null/undefined = unanswered). Returns per-question detail and a 0-100 score. */
export function scoreQuiz(questions, answers) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { score: 0, total: 0, correctCount: 0, detail: [] };
  }
  const detail = questions.map((q, i) => {
    const chosen = Array.isArray(answers) ? answers[i] : null;
    const correct = chosen === q.answer;
    return { questionId: q.id, chosen: chosen ?? null, correct };
  });
  const correctCount = detail.filter((d) => d.correct).length;
  return {
    score: Math.round((correctCount / questions.length) * 100),
    total: questions.length,
    correctCount,
    detail,
  };
}

/** Best score across attempts (0 when none). */
export function bestScore(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return 0;
  return attempts.reduce((m, a) => Math.max(m, Number(a.score) || 0), 0);
}

/** Certificate eligibility: every lesson completed AND best quiz score >= pass mark. */
export function certificateEligible({ completedCount, totalLessons, attempts, passScore = PASS_SCORE_DEFAULT }) {
  const lessonsDone = totalLessons > 0 && completedCount >= totalLessons;
  const quizPassed = bestScore(attempts) >= passScore;
  return { eligible: lessonsDone && quizPassed, lessonsDone, quizPassed, best: bestScore(attempts), passScore };
}

/** Case/diacritic-insensitive course search over bilingual fields, plus category filter. */
export function filterCourses(courses, { q = '', cat = '' } = {}) {
  const needle = normalize(q);
  return (courses || []).filter((c) => {
    if (cat && c.category !== cat) return false;
    if (!needle) return true;
    const hay = normalize([
      c.title?.en, c.title?.ar, c.summary?.en, c.summary?.ar,
      c.instructorName || '', c.category || '',
    ].filter(Boolean).join(' '));
    return hay.includes(needle);
  });
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '') // Arabic diacritics
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .trim();
}

/** Revenue in whole dollars from enrollments (demo records store pricePaid). */
export function revenueStats(enrollments, { now = Date.now(), windowDays = 30 } = {}) {
  const list = Array.isArray(enrollments) ? enrollments : [];
  const since = now - windowDays * 24 * 60 * 60 * 1000;
  const total = list.reduce((s, e) => s + (Number(e.pricePaid) || 0), 0);
  const recent = list.filter((e) => new Date(e.at).getTime() >= since);
  const recentRevenue = recent.reduce((s, e) => s + (Number(e.pricePaid) || 0), 0);
  return { total, count: list.length, recentRevenue, recentCount: recent.length, windowDays };
}

/** Deterministic certificate serial: DAR-<year>-<zero-padded counter>. */
export function certificateSerial(counter, date = new Date()) {
  const n = String(counter).padStart(5, '0');
  return `DAR-${date.getUTCFullYear()}-${n}`;
}

/** Simple client-safe price formatter shared by UI + tests. */
export function formatPrice(amount, lang = 'en') {
  if (!amount) return lang === 'ar' ? 'مجاني' : 'Free';
  return lang === 'ar' ? `${amount} $` : `$${amount}`;
}
