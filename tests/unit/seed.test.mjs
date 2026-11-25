import test from 'node:test';
import assert from 'node:assert/strict';
import { seedCourses, seedLearners, CATEGORIES } from '../../api/_seed.js';
import { seedDb } from '../../api/_db.js';

const courses = seedCourses('inst-1');
const catIds = new Set(CATEGORIES.map((c) => c.id));

test('seed has 8 courses across valid categories', () => {
  assert.equal(courses.length, 8);
  for (const c of courses) assert.ok(catIds.has(c.category), `bad category ${c.category}`);
  const slugs = new Set(courses.map((c) => c.slug));
  assert.equal(slugs.size, 8, 'slugs must be unique');
});

test('every course is fully bilingual with lessons and a valid quiz', () => {
  for (const c of courses) {
    for (const field of ['title', 'summary', 'description']) {
      assert.ok(c[field].en.trim().length > 3, `${c.slug} ${field}.en`);
      assert.match(c[field].ar, /[؀-ۿ]/, `${c.slug} ${field}.ar must be Arabic`);
    }
    assert.ok(c.lessons.length >= 5, `${c.slug} needs >= 5 lessons`);
    assert.ok(c.lessons.some((l) => l.free), `${c.slug} needs a free preview lesson`);
    for (const l of c.lessons) {
      assert.ok(l.title.en && /[؀-ۿ]/.test(l.title.ar), `${c.slug} lesson bilingual titles`);
      assert.ok(l.minutes >= 5 && l.minutes <= 120, `${c.slug} lesson minutes sane`);
    }
    assert.ok(c.quiz.questions.length >= 5, `${c.slug} quiz needs >= 5 questions`);
    assert.ok(c.quiz.passScore >= 50 && c.quiz.passScore <= 100);
    for (const q of c.quiz.questions) {
      assert.equal(q.options.length, 4, `${c.slug} question must have 4 options`);
      assert.ok(q.answer >= 0 && q.answer < 4, `${c.slug} answer index in range`);
      assert.ok(q.q.en && /[؀-ۿ]/.test(q.q.ar));
      for (const o of q.options) {
        assert.ok(o.en.trim() && o.ar.trim(), 'options non-empty');
        // Technical tokens (status codes, acronyms) stay identical across languages.
        if (!/^[\x20-\x7E]+$/.test(o.en)) assert.match(o.ar, /[؀-ۿ]/, `option ${o.en} needs Arabic`);
      }
    }
  }
});

test('seedDb builds a consistent workspace', () => {
  const db = seedDb();
  assert.equal(db.courses.length, 8);
  assert.ok(db.users['user-instructor'] && db.users['user-instructor'].role === 'instructor');
  assert.ok(db.users['user-student'] && db.users['user-admin']);
  const courseIds = new Set(db.courses.map((c) => c.id));
  for (const e of db.enrollments) {
    assert.ok(courseIds.has(e.courseId), `enrollment ${e.id} references known course`);
    assert.ok(db.users[e.userId], `enrollment ${e.id} references known user`);
    const course = db.courses.find((c) => c.id === e.courseId);
    for (const li of e.completedLessons) {
      assert.ok(li >= 0 && li < course.lessons.length, `lesson index ${li} in range`);
    }
  }
  for (const cert of db.certificates) {
    assert.ok(courseIds.has(cert.courseId));
    assert.match(cert.serial, /^DAR-\d{4}-\d{5}$/);
  }
});

test('seeded learners complete courses only when eligible (quiz + lessons)', () => {
  const db = seedDb();
  for (const cert of db.certificates) {
    const course = db.courses.find((c) => c.id === cert.courseId);
    const enr = db.enrollments.find((e) => e.userId === cert.userId && e.courseId === cert.courseId);
    assert.ok(enr, `certificate ${cert.id} has an enrollment`);
    assert.equal(enr.completedLessons.length, course.lessons.length, `certificate ${cert.id} all lessons done`);
    const best = Math.max(...enr.quizAttempts.map((a) => a.score));
    assert.ok(best >= course.quiz.passScore, `certificate ${cert.id} quiz passed`);
  }
});

test('seedLearners covers multiple courses for a believable dashboard', () => {
  const { enrollments, users } = seedLearners(Date.now());
  assert.ok(Object.keys(users).length >= 6);
  const courseSet = new Set(enrollments.map((e) => e.courseSlug));
  assert.ok(courseSet.size >= 7, 'most seeded courses have learners');
  assert.ok(enrollments.some((e) => e.pricePaid > 0), 'some paid enrollments for revenue stats');
});
