// Shared demo workspace on Vercel Blob: one JSON document at darsaty/db.json.
// Demo scope: last writer wins, no cross-region locking (see README limits).
import { put, list } from '@vercel/blob';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { seedCourses, seedLearners } from './_seed.js';
import { certificateSerial } from '../shared/logic.mjs';

const DB_PATH = 'darsaty/db.json';
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

export function emailHash(email) {
  return createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const candidate = scryptSync(String(password), salt, 32);
    return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

export function newToken() {
  return randomBytes(24).toString('hex');
}

export async function getDb() {
  if (!TOKEN) return seedDb(); // local dev without blob: in-memory seed per invocation
  let listedOk = false;
  try {
    // list() bypasses the CDN cache; downloadUrl serves the current version.
    const { blobs } = await list({ prefix: DB_PATH, limit: 1, token: TOKEN });
    listedOk = true;
    const blob = blobs.find((b) => b.pathname === DB_PATH);
    if (blob) {
      const res = await fetch(blob.downloadUrl, { cache: 'no-store' });
      if (res.ok) return await res.json();
    }
  } catch {
    // transient list error: serve an in-memory seed WITHOUT writing it back,
    // so a hiccup never clobbers the shared demo workspace.
  }
  const db = seedDb();
  if (listedOk) {
    // first run: store genuinely empty, persist the seed
    try { await saveDb(db); } catch {}
  }
  return db;
}

export async function saveDb(db) {
  if (!TOKEN) return;
  await put(DB_PATH, JSON.stringify(db), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
    token: TOKEN,
  });
}

export function seedDb() {
  const now = Date.now();
  const courses = seedCourses('user-instructor').map((c, i) => ({
    id: `crs-${i + 1}`,
    published: true,
    createdAt: new Date(now - 45 * 86400000 + i * 86400000).toISOString(),
    students: 0,
    ...c,
    lessons: c.lessons.map((l, j) => ({ id: `l${j + 1}`, ...l })),
    quiz: { id: 'qz-1', ...c.quiz, questions: c.quiz.questions.map((q, k) => ({ id: `q${k + 1}`, ...q })) },
  }));
  const demoPass = hashPassword('Demo#1234');
  const users = {
    'user-instructor': {
      id: 'user-instructor',
      name: 'Nada Gamal',
      emailHash: emailHash('instructor@darsaty.app'),
      pass: demoPass,
      role: 'instructor',
      createdAt: new Date(now - 60 * 86400000).toISOString(),
    },
    'user-student': {
      id: 'user-student',
      name: 'Demo Student',
      emailHash: emailHash('student@darsaty.app'),
      pass: demoPass,
      role: 'student',
      createdAt: new Date(now - 55 * 86400000).toISOString(),
    },
    'user-admin': {
      id: 'user-admin',
      name: 'Platform Admin',
      emailHash: emailHash('admin@darsaty.app'),
      pass: demoPass,
      role: 'admin',
      createdAt: new Date(now - 60 * 86400000).toISOString(),
    },
  };
  const seeded = seedLearners(now);
  Object.assign(users, seeded.users);
  const slugToId = Object.fromEntries(courses.map((c) => [c.slug, c.id]));
  const enrollments = seeded.enrollments.map((e) => ({ ...e, courseId: slugToId[e.courseSlug] }));
  const certificates = seeded.certificates.map((c, i) => ({
    id: `cert-${i + 1}`,
    serial: certificateSerial(i + 1, new Date(c.at)),
    userId: c.userId,
    courseId: slugToId[c.courseSlug],
    at: c.at,
  }));
  return {
    seededAt: new Date(now).toISOString(),
    users,
    sessions: {},
    courses,
    enrollments,
    certificates,
    counters: { user: 100, course: courses.length, enrollment: 100, certificate: certificates.length },
  };
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, role: u.role };
}

export function getSessionUser(db, req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const session = db.sessions?.[token];
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) return null;
  return db.users[session.userId] || null;
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

/** Course shape for the public catalog: no answers, no bodies. */
export function publicCourse(db, course, viewer) {
  const enrolled = viewer
    ? db.enrollments.some((e) => e.userId === viewer.id && e.courseId === course.id)
    : false;
  const owner = viewer && (viewer.role === 'admin' || course.instructorId === viewer.id);
  const canRead = enrolled || owner;
  return {
    id: course.id,
    slug: course.slug,
    category: course.category,
    price: course.price,
    level: course.level,
    cover: course.cover,
    title: course.title,
    summary: course.summary,
    description: course.description,
    instructorName: course.instructorName,
    createdAt: course.createdAt,
    published: course.published,
    lessonCount: course.lessons.length,
    totalMinutes: course.lessons.reduce((s, l) => s + (l.minutes || 0), 0),
    passScore: course.quiz?.passScore ?? 70,
    questionCount: course.quiz?.questions?.length ?? 0,
    enrolled,
    isOwner: Boolean(owner),
    lessons: course.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      minutes: l.minutes,
      kind: l.kind,
      free: Boolean(l.free),
      body: canRead || l.free ? l.body : undefined,
    })),
    quiz: canRead && course.quiz
      ? {
          id: course.quiz.id,
          passScore: course.quiz.passScore,
          questions: course.quiz.questions.map((q) => ({ id: q.id, q: q.q, options: q.options })),
        }
      : undefined,
  };
}
