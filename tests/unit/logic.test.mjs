import test from 'node:test';
import assert from 'node:assert/strict';
import {
  progressPct, scoreQuiz, bestScore, certificateEligible,
  filterCourses, revenueStats, certificateSerial, formatPrice,
} from '../../shared/logic.mjs';

test('progressPct clamps and guards empty courses', () => {
  assert.equal(progressPct(0, 0), 0);
  assert.equal(progressPct(2, 4), 50);
  assert.equal(progressPct(5, 4), 100);
  assert.equal(progressPct(-1, 4), 0);
});

test('scoreQuiz scores exact answers, nulls are wrong', () => {
  const questions = [
    { id: 'q1', answer: 2 },
    { id: 'q2', answer: 0 },
    { id: 'q3', answer: 3 },
    { id: 'q4', answer: 1 },
  ];
  const res = scoreQuiz(questions, [2, 1, null, 1]);
  assert.equal(res.correctCount, 2);
  assert.equal(res.score, 50);
  assert.deepEqual(res.detail.map((d) => d.correct), [true, false, false, true]);
  const perfect = scoreQuiz(questions, [2, 0, 3, 1]);
  assert.equal(perfect.score, 100);
});

test('scoreQuiz of an empty quiz is zero', () => {
  assert.deepEqual(scoreQuiz([], []), { score: 0, total: 0, correctCount: 0, detail: [] });
});

test('bestScore picks the max, 0 with no attempts', () => {
  assert.equal(bestScore([]), 0);
  assert.equal(bestScore(undefined), 0);
  assert.equal(bestScore([{ score: 40 }, { score: 80 }, { score: 60 }]), 80);
});

test('certificateEligible needs all lessons AND passing quiz', () => {
  const base = { completedCount: 5, totalLessons: 5, attempts: [{ score: 70 }], passScore: 70 };
  assert.equal(certificateEligible(base).eligible, true);
  assert.equal(certificateEligible({ ...base, completedCount: 4 }).eligible, false);
  assert.equal(certificateEligible({ ...base, attempts: [{ score: 69 }] }).eligible, false);
  assert.equal(certificateEligible({ ...base, totalLessons: 0 }).eligible, false);
});

test('filterCourses matches category and bilingual normalized search', () => {
  const courses = [
    { id: '1', category: 'web-dev', title: { en: 'JavaScript Basics', ar: 'أساسيات جافاسكريبت' }, summary: { en: '', ar: '' } },
    { id: '2', category: 'design', title: { en: 'Color Theory', ar: 'نظرية الألوان' }, summary: { en: '', ar: '' } },
  ];
  assert.deepEqual(filterCourses(courses, { q: 'javascript' }).map((c) => c.id), ['1']);
  assert.deepEqual(filterCourses(courses, { q: 'الالوان' }).map((c) => c.id), ['2']); // drops ة/أ normalization
  assert.deepEqual(filterCourses(courses, { cat: 'design' }).map((c) => c.id), ['2']);
  assert.deepEqual(filterCourses(courses, { q: '', cat: '' }).length, 2);
  assert.deepEqual(filterCourses(courses, { q: 'nonexistent' }).length, 0);
});

test('revenueStats sums totals and the rolling window', () => {
  const now = Date.UTC(2026, 10, 25);
  const enrollments = [
    { pricePaid: 89, at: new Date(now - 86400000).toISOString() },
    { pricePaid: 45, at: new Date(now - 10 * 86400000).toISOString() },
    { pricePaid: 200, at: new Date(now - 60 * 86400000).toISOString() },
    { pricePaid: 0, at: new Date(now - 2 * 86400000).toISOString() },
  ];
  const s = revenueStats(enrollments, { now, windowDays: 30 });
  assert.equal(s.total, 334);
  assert.equal(s.count, 4);
  assert.equal(s.recentRevenue, 134);
  assert.equal(s.recentCount, 3);
});

test('certificateSerial is zero-padded and year-prefixed', () => {
  assert.equal(certificateSerial(7, new Date(Date.UTC(2026, 0, 1))), 'DAR-2026-00007');
  assert.equal(certificateSerial(12345, new Date(Date.UTC(2026, 0, 1))), 'DAR-2026-12345');
});

test('formatPrice localizes free courses', () => {
  assert.equal(formatPrice(0, 'en'), 'Free');
  assert.equal(formatPrice(0, 'ar'), 'مجاني');
  assert.equal(formatPrice(49, 'en'), '$49');
  assert.equal(formatPrice(49, 'ar'), '49 $');
});
