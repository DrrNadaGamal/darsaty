// Darsaty single API entry point. All /api/* requests are rewritten here
// (see vercel.json) so one warm function instance serves a whole user flow:
// a module-scope cache gives immediate read-your-writes consistency, with
// write-through persistence to Vercel Blob for cross-instance durability.
import {
  getDb, saveDb, emailHash, hashPassword, verifyPassword, newToken,
  publicUser, json, readBody,
} from './_db.js';
import { CATEGORIES } from './_seed.js';
import {
  filterCourses, scoreQuiz, bestScore, certificateEligible,
  progressPct, revenueStats, certificateSerial,
} from '../shared/logic.mjs';

const SESSION_DAYS = 30;

let cache = null;
let writeQueue = Promise.resolve();

async function db() {
  if (!cache) cache = await getDb();
  return cache;
}

function persist() {
  // serialize writes within this instance to avoid concurrent puts
  writeQueue = writeQueue.then(() => saveDb(cache)).catch(() => {});
  return writeQueue;
}

function sessionUser(d, req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !d.sessions?.[token]) return null;
  const s = d.sessions[token];
  if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) return null;
  return d.users[s.userId] || null;
}

function courseView(d, course, viewer) {
  const enrolled = viewer ? d.enrollments.some((e) => e.userId === viewer.id && e.courseId === course.id) : false;
  const owner = viewer && (viewer.role === 'admin' || course.instructorId === viewer.id);
  const canRead = enrolled || owner;
  return {
    id: course.id, slug: course.slug, category: course.category, price: course.price,
    level: course.level, cover: course.cover, title: course.title, summary: course.summary,
    description: course.description, instructorName: course.instructorName,
    createdAt: course.createdAt, published: course.published,
    lessonCount: course.lessons.length,
    totalMinutes: course.lessons.reduce((s, l) => s + (l.minutes || 0), 0),
    passScore: course.quiz?.passScore ?? 70,
    questionCount: course.quiz?.questions?.length ?? 0,
    enrolled, isOwner: Boolean(owner),
    lessons: course.lessons.map((l) => ({
      id: l.id, title: l.title, minutes: l.minutes, kind: l.kind, free: Boolean(l.free),
      body: canRead || l.free ? l.body : undefined,
    })),
    quiz: canRead && course.quiz
      ? { id: course.quiz.id, passScore: course.quiz.passScore, questions: course.quiz.questions.map((q) => ({ id: q.id, q: q.q, options: q.options })) }
      : undefined,
  };
}

function newSession(d, userId) {
  d.sessions ||= {};
  const token = newToken();
  d.sessions[token] = {
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
  };
  return token;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleAuth(req, res, d) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const body = await readBody(req);
  d.sessions ||= {};
  if (body.action === 'signup') {
    const name = String(body.name || '').trim().slice(0, 80);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!name || !EMAIL_RE.test(email) || password.length < 8) return json(res, 400, { error: 'invalid_input' });
    const hash = emailHash(email);
    if (Object.values(d.users).some((u) => u.emailHash === hash)) return json(res, 409, { error: 'email_exists' });
    const id = `user-${++d.counters.user}`;
    d.users[id] = { id, name, emailHash: hash, pass: hashPassword(password), role: 'student', createdAt: new Date().toISOString() };
    const token = newSession(d, id);
    await persist();
    return json(res, 200, { token, user: publicUser(d.users[id]) });
  }
  if (body.action === 'login') {
    const hash = emailHash(body.email || '');
    const user = Object.values(d.users).find((u) => u.emailHash === hash);
    if (!user || !user.pass || !verifyPassword(body.password || '', user.pass)) return json(res, 401, { error: 'invalid_credentials' });
    const token = newSession(d, user.id);
    await persist();
    return json(res, 200, { token, user: publicUser(user) });
  }
  if (body.action === 'me') {
    const user = sessionUser(d, req);
    return json(res, user ? 200 : 401, user ? { user: publicUser(user) } : { error: 'unauthorized' });
  }
  if (body.action === 'logout') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token && d.sessions[token]) { delete d.sessions[token]; await persist(); }
    return json(res, 200, { ok: true });
  }
  return json(res, 400, { error: 'unknown_action' });
}

async function handleCourses(req, res, d, url) {
  const viewer = sessionUser(d, req);
  if (req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const cat = url.searchParams.get('cat') || '';
    const mine = url.searchParams.get('mine') === '1';
    let courses = d.courses.filter((c) => c.published || (viewer && (viewer.role === 'admin' || c.instructorId === viewer.id)));
    if (mine && viewer) courses = courses.filter((c) => c.instructorId === viewer.id || viewer.role === 'admin');
    courses = filterCourses(courses, { q, cat });
    return json(res, 200, { courses: courses.map((c) => courseView(d, c, viewer)), categories: CATEGORIES });
  }
  if (req.method === 'POST') {
    if (!viewer || (viewer.role !== 'instructor' && viewer.role !== 'admin')) return json(res, 403, { error: 'forbidden' });
    const body = await readBody(req);
    const titleEn = String(body.titleEn || '').trim().slice(0, 120);
    const titleAr = String(body.titleAr || '').trim().slice(0, 160);
    const summaryEn = String(body.summaryEn || '').trim().slice(0, 400);
    const summaryAr = String(body.summaryAr || '').trim().slice(0, 400);
    const category = CATEGORIES.some((c) => c.id === body.category) ? body.category : null;
    const price = Math.max(0, Math.min(9999, Number(body.price) || 0));
    const lessons = Array.isArray(body.lessons) ? body.lessons : [];
    if (!titleEn || !titleAr || !summaryEn || !summaryAr || !category || lessons.length === 0) return json(res, 400, { error: 'invalid_input' });
    const cleanLessons = lessons.slice(0, 30).map((l, i) => ({
      id: `l${i + 1}`,
      title: { en: String(l.en || '').trim().slice(0, 140) || `Lesson ${i + 1}`, ar: String(l.ar || '').trim().slice(0, 160) || `الدرس ${i + 1}` },
      minutes: Math.max(1, Math.min(600, Number(l.minutes) || 15)),
      kind: 'video',
      free: i === 0,
      body: { en: 'Lesson notes will appear here.', ar: 'ستظهر ملاحظات الدرس هنا.' },
    }));
    const id = `crs-${++d.counters.course}`;
    const covers = ['cover-webdev', 'cover-wordpress', 'cover-design', 'cover-marketing', 'cover-freelance', 'cover-python', 'cover-js', 'cover-seo'];
    const course = {
      id,
      slug: `${titleEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'course'}-${id}`,
      category, price, level: 'beginner',
      cover: `/assets/covers/${covers[d.counters.course % covers.length]}.webp`,
      title: { en: titleEn, ar: titleAr },
      summary: { en: summaryEn, ar: summaryAr },
      description: { en: summaryEn, ar: summaryAr },
      instructorId: viewer.id, instructorName: viewer.name,
      published: true, createdAt: new Date().toISOString(),
      lessons: cleanLessons,
      quiz: { id: 'qz-1', passScore: 70, questions: [] },
    };
    d.courses.push(course);
    await persist();
    return json(res, 200, { course: courseView(d, course, viewer) });
  }
  return json(res, 405, { error: 'method_not_allowed' });
}

async function handleCourse(req, res, d, url) {
  const viewer = sessionUser(d, req);
  const id = url.searchParams.get('id') || '';
  const course = d.courses.find((c) => c.id === id || c.slug === id);
  if (!course) return json(res, 404, { error: 'not_found' });
  if (!course.published && !(viewer && (viewer.role === 'admin' || course.instructorId === viewer.id))) return json(res, 404, { error: 'not_found' });
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  return json(res, 200, { course: courseView(d, course, viewer) });
}

async function handleEnroll(req, res, d) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const viewer = sessionUser(d, req);
  if (!viewer) return json(res, 401, { error: 'unauthorized' });
  const body = await readBody(req);
  const course = d.courses.find((c) => c.id === body.courseId || c.slug === body.courseId);
  if (!course || !course.published) return json(res, 404, { error: 'not_found' });
  const existing = d.enrollments.find((e) => e.userId === viewer.id && e.courseId === course.id);
  if (existing) return json(res, 200, { enrollment: existing, already: true });
  const enrollment = {
    id: `enr-${++d.counters.enrollment}`,
    userId: viewer.id, courseId: course.id, pricePaid: course.price,
    at: new Date().toISOString(), completedLessons: [], quizAttempts: [],
  };
  d.enrollments.push(enrollment);
  await persist();
  return json(res, 200, { enrollment });
}

function progressFor(d, userId) {
  return d.enrollments.filter((e) => e.userId === userId).map((e) => {
    const course = d.courses.find((c) => c.id === e.courseId);
    if (!course) return null;
    const total = course.lessons.length;
    const completedCount = (e.completedLessons || []).length;
    const cert = d.certificates.find((c) => c.userId === userId && c.courseId === e.courseId);
    return {
      courseId: course.id, slug: course.slug, title: course.title, cover: course.cover,
      totalLessons: total, completedLessons: e.completedLessons || [],
      pct: progressPct(completedCount, total),
      bestQuizScore: bestScore(e.quizAttempts),
      passScore: course.quiz?.passScore ?? 70,
      eligibility: certificateEligible({ completedCount, totalLessons: total, attempts: e.quizAttempts, passScore: course.quiz?.passScore }),
      certificateId: cert?.id || null,
      enrolledAt: e.at,
    };
  }).filter(Boolean);
}

async function handleProgress(req, res, d) {
  const viewer = sessionUser(d, req);
  if (!viewer) return json(res, 401, { error: 'unauthorized' });
  if (req.method === 'GET') return json(res, 200, { progress: progressFor(d, viewer.id) });
  if (req.method === 'POST') {
    const body = await readBody(req);
    const course = d.courses.find((c) => c.id === body.courseId || c.slug === body.courseId);
    const enrollment = course && d.enrollments.find((e) => e.userId === viewer.id && e.courseId === course.id);
    if (!course || !enrollment) return json(res, 404, { error: 'not_enrolled' });
    const lesson = course.lessons.find((l) => l.id === body.lessonId);
    if (!lesson) return json(res, 404, { error: 'no_lesson' });
    enrollment.completedLessons ||= [];
    const done = body.done !== false;
    const has = enrollment.completedLessons.includes(lesson.id);
    if (done && !has) enrollment.completedLessons.push(lesson.id);
    if (!done && has) enrollment.completedLessons = enrollment.completedLessons.filter((x) => x !== lesson.id);
    await persist();
    const total = course.lessons.length;
    return json(res, 200, {
      courseId: course.id, completedLessons: enrollment.completedLessons,
      pct: progressPct(enrollment.completedLessons.length, total),
      eligibility: certificateEligible({ completedCount: enrollment.completedLessons.length, totalLessons: total, attempts: enrollment.quizAttempts, passScore: course.quiz?.passScore }),
    });
  }
  return json(res, 405, { error: 'method_not_allowed' });
}

async function handleQuiz(req, res, d) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const viewer = sessionUser(d, req);
  if (!viewer) return json(res, 401, { error: 'unauthorized' });
  const body = await readBody(req);
  const course = d.courses.find((c) => c.id === body.courseId || c.slug === body.courseId);
  const enrollment = course && d.enrollments.find((e) => e.userId === viewer.id && e.courseId === course.id);
  if (!course || !enrollment) return json(res, 404, { error: 'not_enrolled' });
  if (!course.quiz || !course.quiz.questions?.length) return json(res, 404, { error: 'no_quiz' });
  const answers = Array.isArray(body.answers) ? body.answers.map((a) => (Number.isInteger(a) ? a : null)) : [];
  if (answers.length !== course.quiz.questions.length || answers.some((a) => a === null || a < 0 || a > 3)) return json(res, 400, { error: 'unanswered' });
  const result = scoreQuiz(course.quiz.questions, answers);
  enrollment.quizAttempts ||= [];
  enrollment.quizAttempts.push({ score: result.score, total: result.total, at: new Date().toISOString() });
  await persist();
  const passScore = course.quiz.passScore ?? 70;
  return json(res, 200, {
    score: result.score, total: result.total, correctCount: result.correctCount,
    detail: result.detail.map((x) => ({ questionId: x.questionId, correct: x.correct, chosen: x.chosen })),
    passed: result.score >= passScore, passScore,
    eligibility: certificateEligible({
      completedCount: (enrollment.completedLessons || []).length,
      totalLessons: course.lessons.length,
      attempts: enrollment.quizAttempts, passScore,
    }),
  });
}

function certView(d, cert) {
  const user = d.users[cert.userId];
  const course = d.courses.find((c) => c.id === cert.courseId);
  if (!user || !course) return null;
  return {
    id: cert.id, serial: cert.serial, at: cert.at,
    learnerName: user.name, courseTitle: course.title, instructorName: course.instructorName,
    totalMinutes: course.lessons.reduce((s, l) => s + (l.minutes || 0), 0),
    lessonCount: course.lessons.length,
  };
}

async function handleCertificate(req, res, d, url) {
  if (req.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    const cert = d.certificates.find((c) => c.id === id || c.serial.toLowerCase() === id.toLowerCase());
    if (!cert) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { certificate: certView(d, cert) });
  }
  if (req.method === 'POST') {
    const viewer = sessionUser(d, req);
    if (!viewer) return json(res, 401, { error: 'unauthorized' });
    const body = await readBody(req);
    const course = d.courses.find((c) => c.id === body.courseId || c.slug === body.courseId);
    const enrollment = course && d.enrollments.find((e) => e.userId === viewer.id && e.courseId === course.id);
    if (!course || !enrollment) return json(res, 404, { error: 'not_enrolled' });
    const existing = d.certificates.find((c) => c.userId === viewer.id && c.courseId === course.id);
    if (existing) return json(res, 200, { certificate: certView(d, existing) });
    const { eligible } = certificateEligible({
      completedCount: (enrollment.completedLessons || []).length,
      totalLessons: course.lessons.length,
      attempts: enrollment.quizAttempts, passScore: course.quiz?.passScore,
    });
    if (!eligible) return json(res, 403, { error: 'not_eligible' });
    const cert = {
      id: `cert-${++d.counters.certificate}`,
      serial: certificateSerial(d.counters.certificate),
      userId: viewer.id, courseId: course.id, at: new Date().toISOString(),
    };
    d.certificates.push(cert);
    await persist();
    return json(res, 200, { certificate: certView(d, cert) });
  }
  return json(res, 405, { error: 'method_not_allowed' });
}

async function handleDashboard(req, res, d) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  const viewer = sessionUser(d, req);
  if (!viewer || (viewer.role !== 'instructor' && viewer.role !== 'admin')) return json(res, 403, { error: 'forbidden' });
  const myCourses = d.courses.filter((c) => viewer.role === 'admin' || c.instructorId === viewer.id);
  const myIds = new Set(myCourses.map((c) => c.id));
  const myEnrollments = d.enrollments.filter((e) => myIds.has(e.courseId));
  const rev = revenueStats(myEnrollments);
  const perCourse = myCourses.map((c) => {
    const enrolls = myEnrollments.filter((e) => e.courseId === c.id);
    const completions = enrolls.filter((e) => (e.completedLessons || []).length >= c.lessons.length && c.lessons.length > 0).length;
    const scores = enrolls.flatMap((e) => (e.quizAttempts || []).map((a) => a.score));
    return {
      id: c.id, slug: c.slug, title: c.title, price: c.price,
      students: enrolls.length,
      revenue: enrolls.reduce((s, e) => s + (e.pricePaid || 0), 0),
      completionRate: enrolls.length ? Math.round((completions / enrolls.length) * 100) : 0,
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    };
  });
  const allScores = myEnrollments.flatMap((e) => (e.quizAttempts || []).map((a) => a.score));
  const recent = myEnrollments.slice().sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 25).map((e) => {
    const u = d.users[e.userId];
    const c = d.courses.find((x) => x.id === e.courseId);
    return {
      learner: u?.name || 'Learner', courseTitle: c?.title || { en: '?', ar: '؟' },
      enrolledAt: e.at, pct: c ? progressPct((e.completedLessons || []).length, c.lessons.length) : 0,
      bestScore: bestScore(e.quizAttempts) || null, pricePaid: e.pricePaid || 0,
    };
  });
  return json(res, 200, {
    stats: {
      students: new Set(myEnrollments.map((e) => e.userId)).size,
      enrollments: myEnrollments.length,
      revenue: rev.total, recentRevenue: rev.recentRevenue, windowDays: rev.windowDays,
      completions: perCourse.reduce((s, c) => s + Math.round((c.completionRate / 100) * c.students), 0),
      avgScore: allScores.length ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null,
    },
    courses: perCourse, recent,
  });
}

async function handleStats(req, res, d) {
  return json(res, 200, {
    courses: d.courses.filter((c) => c.published).length,
    learners: new Set(d.enrollments.map((e) => e.userId)).size,
    certificates: d.certificates.length,
  });
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.searchParams.get('path') || url.pathname.replace(/^\/api\/?/, '');
    const route = path.replace(/\.js$/, '').replace(/\/$/, '');
    const d = await db();
    switch (route) {
      case 'auth': return await handleAuth(req, res, d);
      case 'courses': return await handleCourses(req, res, d, url);
      case 'course': return await handleCourse(req, res, d, url);
      case 'enroll': return await handleEnroll(req, res, d);
      case 'progress': return await handleProgress(req, res, d);
      case 'quiz': return await handleQuiz(req, res, d);
      case 'certificate': return await handleCertificate(req, res, d, url);
      case 'dashboard': return await handleDashboard(req, res, d);
      case 'stats': return await handleStats(req, res, d);
      default: return json(res, 404, { error: 'not_found', route });
    }
  } catch (e) {
    return json(res, 500, { error: 'internal', detail: String(e && e.message || e).slice(0, 200) });
  }
}
