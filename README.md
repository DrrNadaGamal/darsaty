# Darsaty · درساتي

A bilingual (English / العربية) online course platform: public catalog, student area with progress tracking, quizzes with server-side scoring, verifiable certificates, and an instructor dashboard with revenue and learner analytics.

منصة دورات أونلاين ثنائية اللغة (إنجليزي / عربي مع دعم RTL كامل): كتالوج عام، ومنطقة طالب بمتابعة للتقدم، واختبارات بتصحيح على الخادم، وشهادات قابلة للتحقق، ولوحة تحكم للمدرب بالإيرادات وتحليلات المتعلمين.

## Features

- **Catalog** — full-text search (diacritic-insensitive Arabic normalization) and category filters across 8 seeded courses.
- **Course pages** — bilingual curriculum, free preview lessons, pricing, instructor info.
- **Student area** — enrolment, lesson player with progress ring, offline progress queue (service worker + localStorage outbox, syncs on reconnect), final quizzes with per-question feedback.
- **Certificates** — issued only when 100% of lessons are complete AND the quiz is passed; serial-numbered (`DAR-YYYY-NNNNN`), printable, PDF download, publicly verifiable by serial.
- **Instructor dashboard** — students, revenue (total + 30-day window), completions, average quiz score, per-course table, recent learner activity, course creation form.
- **Roles** — student, instructor, admin.
- **Bilingual RTL** — every UI string in English and Arabic (parity enforced by tests), full right-to-left layout via logical CSS properties.
- **Offline-friendly** — app shell and covers cached by a service worker; lesson-completion writes queue locally and replay when the connection returns.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Instructor | `instructor@darsaty.app` | `Demo#1234` |
| Student | `student@darsaty.app` | `Demo#1234` |
| Admin | `admin@darsaty.app` | `Demo#1234` |

Or create your own student account from the sign-up tab.

## Stack

Vanilla JS SPA (no framework) · Vercel serverless functions (Node, ESM) · Vercel Blob (shared demo workspace) · Service worker · jsPDF (vendored) · `node:test` unit tests.

## Project structure

```
api/            serverless functions (auth, courses, enroll, progress, quiz, certificate, dashboard, stats)
api/_seed.js    bilingual seed content: 8 courses, lessons, quizzes, learners
api/_db.js      Blob persistence, scrypt auth, sessions, seeding
public/         SPA shell, styles, service worker, covers
public/assets/i18n.mjs   UI strings EN/AR (single source; parity-tested)
shared/logic.mjs         domain rules (scoring, eligibility, search, revenue) used by API + tests
tests/unit/     18 node:test checks: logic, i18n parity, seed integrity
```

## Local development

```bash
npm install
npx vercel dev        # needs BLOB_READ_WRITE_TOKEN in .env for persistence
npm test              # node --test tests/unit/
```

## Honest limits (demo scope)

- **Demo accounts and data are fictional.** The demo password is public on purpose; auth is scrypt + bearer tokens but is not production-grade (no rate limiting, no email verification, no refresh rotation).
- **One shared demo workspace** on Vercel Blob: every visitor sees the same data, last writer wins on concurrent edits, and anyone can create an account. Enrolled learners' display names are visible to instructor accounts.
- **Demo checkout**: the enroll button records the catalog price without processing payment, so revenue figures are illustrative.
- **Video lessons are placeholders**: lesson content is presented as notes; no video streaming is wired up.
- **Certificates** are verifiable by serial on the demo site; the PDF is English-only (the print view is fully bilingual) because the bundled PDF font has no Arabic glyphs.
- **Instructor-created courses** get a generated quiz only when authored through the API; the dashboard form creates lessons without a quiz.
- FR/DE are not included; this build is EN/AR only.

## Credit

Product direction and scope: Nada Gamal. Implementation: AI-assisted (Instinct). Presented as a demonstration build, not a production client deployment.
