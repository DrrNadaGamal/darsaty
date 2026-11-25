// Darsaty SPA: hash router, bilingual rendering, offline progress outbox.
import { t } from './i18n.mjs';

const LS = { token: 'darsaty-token', lang: 'darsaty-lang', outbox: 'darsaty-outbox' };
const state = {
  lang: localStorage.getItem(LS.lang) || (navigator.language || '').startsWith('ar') ? (localStorage.getItem(LS.lang) || 'ar') : 'en',
  user: null,
  token: localStorage.getItem(LS.token) || null,
  categories: [],
};
// fix precedence explicitly
state.lang = localStorage.getItem(LS.lang) || (((navigator.language || '').startsWith('ar')) ? 'ar' : 'en');

const $app = document.getElementById('app');
const $header = document.getElementById('site-header');
const $footer = document.getElementById('site-footer');
const $banner = document.getElementById('offline-banner');
const $toastRoot = document.getElementById('toast-root');

const tr = (key, vars) => t(state.lang, key, vars);
const pick = (obj) => (obj && (obj[state.lang] ?? obj.en)) || '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $toastRoot.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'request_failed');
    err.code = data.error || res.status;
    throw err;
  }
  return data;
}

/* ---------------- offline outbox ---------------- */
function getOutbox() {
  try { return JSON.parse(localStorage.getItem(LS.outbox) || '[]'); } catch { return []; }
}
function setOutbox(items) { localStorage.setItem(LS.outbox, JSON.stringify(items)); updateBanner(); }
async function flushOutbox() {
  const items = getOutbox();
  if (!items.length || !state.token) return;
  const remaining = [];
  for (const item of items) {
    try { await api('/api/progress', { method: 'POST', body: item }); }
    catch { remaining.push(item); }
  }
  setOutbox(remaining);
  if (!remaining.length && items.length) toast(tr('offline.synced'));
}
function updateBanner() {
  const offline = !navigator.onLine;
  const pending = getOutbox().length > 0;
  $banner.hidden = !(offline || pending);
  $banner.textContent = tr('offline.badge');
}
window.addEventListener('online', () => { updateBanner(); flushOutbox(); route(); });
window.addEventListener('offline', updateBanner);

/* ---------------- shell ---------------- */
function renderShell() {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  const authed = Boolean(state.user);
  const staff = state.user && (state.user.role === 'instructor' || state.user.role === 'admin');
  $header.innerHTML = `
    <div class="wrap header-inner">
      <a class="brand" href="#/">darsaty<span class="brand-dot">.</span><span class="brand-tag">${esc(tr('brand.tag'))}</span></a>
      <nav class="nav" aria-label="Main">
        <a href="#/" data-nav="home">${esc(tr('nav.catalog'))}</a>
        ${authed ? `<a href="#/my" data-nav="my">${esc(tr('nav.myLearning'))}</a>` : ''}
        ${staff ? `<a href="#/dashboard" data-nav="dashboard">${esc(tr('nav.dashboard'))}</a>` : ''}
        ${authed
          ? `<button class="linklike" id="logout-btn">${esc(tr('nav.logout'))} (${esc(state.user.name.split(' ')[0])})</button>`
          : `<a href="#/auth">${esc(tr('nav.login'))}</a><a class="btn primary small" href="#/auth">${esc(tr('nav.signup'))}</a>`}
        <button class="lang-switch" id="lang-btn">${esc(tr('lang.switch'))}</button>
      </nav>
    </div>`;
  $footer.innerHTML = `
    <div class="wrap footer-inner">
      <span>${esc(tr('footer.note'))}</span>
      <span>${esc(tr('footer.built'))}</span>
    </div>`;
  document.getElementById('lang-btn').onclick = () => {
    state.lang = state.lang === 'ar' ? 'en' : 'ar';
    localStorage.setItem(LS.lang, state.lang);
    renderShell();
    route();
  };
  const logout = document.getElementById('logout-btn');
  if (logout) logout.onclick = async () => {
    try { await api('/api/auth', { method: 'POST', body: { action: 'logout' } }); } catch {}
    state.user = null; state.token = null;
    localStorage.removeItem(LS.token);
    location.hash = '#/';
    renderShell(); route();
  };
  updateBanner();
}

function setActiveNav(key) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
}

function loading() {
  $app.innerHTML = '<div class="loading-shell"><span class="spinner" aria-hidden="true"></span></div>';
}

/* ---------------- views ---------------- */
async function viewHome() {
  setActiveNav('home');
  loading();
  let data, stats = { courses: 0, learners: 0, certificates: 0 };
  try {
    [data, stats] = await Promise.all([api('/api/courses'), api('/api/stats')]);
  } catch {
    $app.innerHTML = `<div class="wrap section"><p class="alert">${esc(tr('error.load'))}</p></div>`;
    return;
  }
  state.categories = data.categories;
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const q = params.get('q') || '';
  const cat = params.get('cat') || '';
  const filtered = applyFilter(data.courses, q, cat);

  $app.innerHTML = `
    <section class="hero wrap">
      <div>
        <p class="hero-kicker">${esc(tr('hero.kicker'))}</p>
        <h1>${esc(tr('hero.title'))}</h1>
        <p class="lede">${esc(tr('hero.sub'))}</p>
        <div class="hero-actions">
          <a class="btn primary" href="#catalog">${esc(tr('hero.cta.browse'))}</a>
          <a class="btn ghost" href="#/auth">${esc(tr('hero.cta.teach'))}</a>
        </div>
        <div class="hero-stats">
          <div class="stat"><b>${stats.courses}</b><span>${esc(tr('hero.stat.courses'))}</span></div>
          <div class="stat"><b>${stats.learners}</b><span>${esc(tr('hero.stat.learners'))}</span></div>
          <div class="stat"><b>${stats.certificates}</b><span>${esc(tr('hero.stat.certificates'))}</span></div>
        </div>
      </div>
      <div class="hero-art"><img src="/assets/covers/hero-learning.webp" alt="Learners connected to a glowing knowledge hub" width="1024" height="576"></div>
    </section>
    <section class="section wrap" id="catalog">
      <div class="section-head"><h2>${esc(tr('catalog.title'))}</h2></div>
      <div class="catalog-tools">
        <div class="search-box">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="search" type="search" placeholder="${esc(tr('catalog.search'))}" value="${esc(q)}" aria-label="${esc(tr('catalog.search'))}">
        </div>
        <div class="chips" id="chips">
          <button class="chip ${!cat ? 'active' : ''}" data-cat="">${esc(tr('catalog.all'))}</button>
          ${state.categories.map((c) => `<button class="chip ${cat === c.id ? 'active' : ''}" data-cat="${esc(c.id)}">${esc(pick(c))}</button>`).join('')}
        </div>
        <span class="results-meta">${esc(tr('catalog.results', { n: filtered.length }))}</span>
      </div>
      <div class="grid" id="grid">${filtered.map(courseCard).join('') || `<p class="empty-state">${esc(tr('catalog.empty'))}</p>`}</div>
    </section>`;

  const searchEl = document.getElementById('search');
  let debounce;
  searchEl.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => updateCatalog(data.courses), 220);
  });
  document.getElementById('chips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === btn));
    updateCatalog(data.courses);
  });
  function updateCatalog(courses) {
    const nq = searchEl.value;
    const ncat = document.querySelector('.chip.active')?.dataset.cat || '';
    const list = applyFilter(courses, nq, ncat);
    document.getElementById('grid').innerHTML = list.map(courseCard).join('') || `<p class="empty-state">${esc(tr('catalog.empty'))}</p>`;
    document.querySelector('.results-meta').textContent = tr('catalog.results', { n: list.length });
  }
}

function applyFilter(courses, q, cat) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[ً-ْٰ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').trim();
  const needle = norm(q);
  return courses.filter((c) => {
    if (cat && c.category !== cat) return false;
    if (!needle) return true;
    const hay = norm([c.title.en, c.title.ar, c.summary.en, c.summary.ar, c.instructorName].join(' '));
    return hay.includes(needle);
  });
}

function catName(id) {
  const c = state.categories.find((x) => x.id === id);
  return c ? pick(c) : id;
}

function courseCard(c) {
  return `
    <article class="card">
      <a href="#/course/${esc(c.slug)}" tabindex="-1" aria-hidden="true"><img class="cover" src="${esc(c.cover)}" alt="" loading="lazy"></a>
      <div class="body">
        <span class="cat">${esc(catName(c.category))}</span>
        <h3><a href="#/course/${esc(c.slug)}">${esc(pick(c.title))}</a></h3>
        <p>${esc(pick(c.summary))}</p>
        <div class="meta">
          <span>${esc(tr('course.lessons', { n: c.lessonCount }))}</span>
          <span>${esc(tr('course.minutes', { n: c.totalMinutes }))}</span>
          <span>${esc(tr(`course.level.${c.level}`))}</span>
        </div>
        <div class="foot">
          <span class="price">${c.price ? `$${c.price}` : esc(tr('course.enroll.free').split(' ')[state.lang === 'ar' ? 1 : 2] ?? (state.lang === 'ar' ? 'مجانًا' : 'Free'))}</span>
          ${c.enrolled ? `<span class="badge">${esc(tr('course.enrolled'))}</span>` : ''}
        </div>
      </div>
    </article>`;
}

async function viewCourse(slug) {
  loading();
  let course;
  try {
    ({ course } = await api(`/api/course?id=${encodeURIComponent(slug)}`));
  } catch {
    $app.innerHTML = `<div class="wrap section"><p class="alert">${esc(tr('error.load'))}</p></div>`;
    return;
  }
  const freeLessons = course.lessons.filter((l) => l.free);
  $app.innerHTML = `
    <section class="course-hero wrap">
      <div>
        <span class="cat" style="color:var(--accent-2);font-weight:700;font-size:.8rem;text-transform:uppercase">${esc(catName(course.category))}</span>
        <h1>${esc(pick(course.title))}</h1>
        <p class="lede">${esc(pick(course.summary))}</p>
        <div class="instructor-line">
          <span class="avatar">${esc(course.instructorName.trim()[0] || 'D')}</span>
          <span>${esc(tr('course.instructor'))}: <b>${esc(course.instructorName)}</b></span>
        </div>
        <h2 style="margin-top:30px">${esc(tr('course.about'))}</h2>
        <p class="lede">${esc(pick(course.description))}</p>
        <h2 style="margin-top:30px">${esc(tr('course.curriculum'))}</h2>
        <div class="curriculum">
          ${course.lessons.map((l, i) => `
            <${l.free || course.enrolled ? `a href="${course.enrolled ? `#/learn/${course.slug}?lesson=${l.id}` : `#/course/${course.slug}?preview=${l.id}`}"` : 'div'} class="lesson-row ${l.free || course.enrolled ? 'playable' : ''}">
              <span class="num">${i + 1}</span>
              <span class="lt">${esc(pick(l.title))} ${l.free ? `<span class="badge">${esc(tr('course.preview'))}</span>` : ''}</span>
              <span class="lm">${esc(tr('course.minutes', { n: l.minutes }))}</span>
              ${l.free || course.enrolled ? '' : `<span class="lock" title="${esc(tr('course.locked'))}">🔒</span>`}
            </${l.free || course.enrolled ? 'a' : 'div'}>`).join('')}
        </div>
        ${course.questionCount ? `
        <h2 style="margin-top:30px">${esc(tr('course.quiz'))}</h2>
        <div class="panel"><p style="margin:0;color:var(--muted)">${esc(tr('course.quiz.questions', { n: course.questionCount, p: course.passScore }))}</p></div>` : ''}
      </div>
      <aside class="side-panel">
        <img src="${esc(course.cover)}" alt="${esc(pick(course.title))}">
        <div class="pad">
          <span class="price" style="font-size:1.5rem">${course.price ? `$${course.price}` : (state.lang === 'ar' ? 'مجاني' : 'Free')}</span>
          ${course.enrolled
            ? `<a class="btn primary" href="#/learn/${esc(course.slug)}">${esc(tr('course.continue'))}</a>`
            : `<button class="btn primary" id="enroll-btn">${esc(tr(course.price ? 'course.enroll.paid' : 'course.enroll.free'))}</button>
               <p class="demo-note">${esc(tr('course.demoNote'))}</p>`}
          <div class="meta" style="color:var(--muted);font-size:.86rem;display:flex;gap:12px;flex-wrap:wrap">
            <span>${esc(tr('course.lessons', { n: course.lessonCount }))}</span>
            <span>${esc(tr('course.minutes', { n: course.totalMinutes }))}</span>
          </div>
        </div>
      </aside>
    </section>`;

  const previewId = new URLSearchParams(location.hash.split('?')[1] || '').get('preview');
  if (previewId) {
    const l = course.lessons.find((x) => x.id === previewId && x.free);
    if (l) {
      const player = document.createElement('div');
      player.className = 'wrap';
      player.innerHTML = `
        <div class="player">
          <div class="screen"><img src="${esc(course.cover)}" alt=""><div class="play-hint"><b>${esc(pick(l.title))}</b>${esc(tr('learn.videoPlaceholder'))}</div></div>
          <div class="body"><p>${esc(pick(l.body))}</p></div>
        </div>`;
      $app.querySelector('.course-hero').after(player);
      player.scrollIntoView({ behavior: 'smooth' });
    }
  }

  const enrollBtn = document.getElementById('enroll-btn');
  if (enrollBtn) enrollBtn.onclick = async () => {
    if (!state.user) { location.hash = `#/auth?next=${encodeURIComponent(`#/course/${course.slug}`)}`; return; }
    enrollBtn.disabled = true;
    try {
      await api('/api/enroll', { method: 'POST', body: { courseId: course.id } });
      toast(tr('course.enrolled') + ' ✓');
      viewCourse(slug);
    } catch (e) {
      toast(tr('error.generic'));
      enrollBtn.disabled = false;
    }
  };
}

async function viewLearn(slug) {
  if (!state.user) { location.hash = `#/auth?next=${encodeURIComponent(`#/learn/${slug}`)}`; return; }
  setActiveNav('my');
  loading();
  let course, progressList;
  try {
    [{ course }, { progress: progressList }] = await Promise.all([
      api(`/api/course?id=${encodeURIComponent(slug)}`),
      api('/api/progress'),
    ]);
  } catch {
    $app.innerHTML = `<div class="wrap section"><p class="alert">${esc(tr('error.load'))}</p></div>`;
    return;
  }
  const prog = progressList.find((p) => p.slug === slug || p.courseId === course.id);
  if (!prog) { location.hash = `#/course/${slug}`; return; }
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const currentId = params.get('lesson') || course.lessons[0]?.id;
  const lesson = course.lessons.find((l) => l.id === currentId) || course.lessons[0];
  const doneSet = new Set(prog.completedLessons);
  const idx = course.lessons.indexOf(lesson);
  const next = course.lessons[idx + 1];
  const circ = 2 * Math.PI * 22;

  $app.innerHTML = `
    <div class="learn wrap">
      <aside class="learn-side">
        <header>
          <h3>${esc(pick(course.title))}</h3>
          <div class="progress-ring">
            <svg class="ring" viewBox="0 0 52 52" role="img" aria-label="${prog.pct}%">
              <circle class="bgc" cx="26" cy="26" r="22"></circle>
              <circle class="fgc" cx="26" cy="26" r="22" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - prog.pct / 100)).toFixed(1)}"></circle>
            </svg>
            <div><b>${prog.pct}%</b><br><span style="color:var(--muted);font-size:.82rem">${esc(tr('learn.progress'))}</span></div>
          </div>
        </header>
        <div class="learn-lessons">
          ${course.lessons.map((l, i) => `
            <a class="lesson-row ${l.id === lesson.id ? 'current' : ''}" href="#/learn/${esc(course.slug)}?lesson=${esc(l.id)}">
              <span class="num">${doneSet.has(l.id) ? '<span class="done-dot">✓</span>' : i + 1}</span>
              <span class="lt">${esc(pick(l.title))}</span>
              <span class="lm">${l.minutes}m</span>
            </a>`).join('')}
        </div>
      </aside>
      <div class="learn-main">
        <a href="#/course/${esc(course.slug)}" style="color:var(--muted);text-decoration:none">← ${esc(tr('learn.back'))}</a>
        <div class="player">
          <div class="screen">
            <img src="${esc(course.cover)}" alt="">
            <div class="play-hint"><b>${esc(pick(lesson.title))}</b>${esc(tr('learn.videoPlaceholder'))}</div>
          </div>
          <div class="body">
            <h2>${esc(pick(lesson.title))}</h2>
            <p>${esc(pick(lesson.body))}</p>
            <div class="learn-actions">
              <button class="btn ${doneSet.has(lesson.id) ? 'ghost' : 'primary'}" id="done-btn">
                ${doneSet.has(lesson.id) ? esc(tr('learn.completed')) + ' ✓' : esc(tr('learn.markDone'))}
              </button>
              ${next ? `<a class="btn ghost" href="#/learn/${esc(course.slug)}?lesson=${esc(next.id)}">${esc(tr('learn.next'))} →</a>` : ''}
            </div>
          </div>
        </div>
        <div class="panel" id="quiz-panel">
          <h3>${esc(tr('course.quiz'))}</h3>
          ${course.quiz && course.quiz.questions?.length
            ? `<p style="color:var(--muted)">${esc(tr('course.quiz.questions', { n: course.quiz.questions.length, p: course.quiz.passScore }))}
                 ${prog.bestQuizScore ? ` · ${esc(tr('quiz.score', { s: prog.bestQuizScore }))}` : ''}</p>
               <a class="btn primary" href="#/quiz/${esc(course.slug)}">${esc(tr(prog.bestQuizScore ? 'quiz.retry' : 'learn.takeQuiz'))}</a>`
            : `<p style="color:var(--muted)">—</p>`}
        </div>
        <div class="panel" id="cert-panel">
          ${prog.eligibility.eligible || prog.certificateId
            ? `<h3>${esc(tr('learn.certificate.ready'))} 🎓</h3><button class="btn primary" id="cert-btn">${esc(tr('learn.certificate.view'))}</button>`
            : `<h3>${esc(tr('cert.title'))}</h3><p style="color:var(--muted)">${esc(tr('learn.certificate.hint'))}</p>`}
        </div>
      </div>
    </div>`;

  document.getElementById('done-btn').onclick = async () => {
    const nowDone = !doneSet.has(lesson.id);
    const payload = { courseId: course.id, lessonId: lesson.id, done: nowDone };
    if (nowDone) doneSet.add(lesson.id); else doneSet.delete(lesson.id);
    try {
      await api('/api/progress', { method: 'POST', body: payload });
    } catch {
      const box = getOutbox();
      box.push(payload);
      setOutbox(box);
      toast(tr('offline.badge'));
    }
    viewLearn(slug);
  };
  const certBtn = document.getElementById('cert-btn');
  if (certBtn) certBtn.onclick = async () => {
    certBtn.disabled = true;
    try {
      const { certificate } = await api('/api/certificate', { method: 'POST', body: { courseId: course.id } });
      location.hash = `#/certificate/${certificate.id}`;
    } catch { toast(tr('cert.locked')); certBtn.disabled = false; }
  };
}

async function viewQuiz(slug) {
  if (!state.user) { location.hash = `#/auth?next=${encodeURIComponent(`#/quiz/${slug}`)}`; return; }
  loading();
  let course;
  try { ({ course } = await api(`/api/course?id=${encodeURIComponent(slug)}`)); } catch {
    $app.innerHTML = `<div class="wrap section"><p class="alert">${esc(tr('error.load'))}</p></div>`; return;
  }
  if (!course.quiz || !course.quiz.questions?.length) {
    $app.innerHTML = `<div class="wrap section"><p class="alert">${esc(tr('error.generic'))}</p></div>`; return;
  }
  const renderForm = (result) => {
    $app.innerHTML = `
      <div class="wrap section" style="max-width:820px">
        <a href="#/learn/${esc(course.slug)}" style="color:var(--muted);text-decoration:none">← ${esc(tr('learn.back'))}</a>
        <h1 style="font-family:var(--font-display)">${esc(tr('quiz.title'))} · ${esc(pick(course.title))}</h1>
        ${result ? `
          <div class="quiz-card score-hero">
            <div class="big">${result.score}%</div>
            <p class="${result.passed ? 'pass' : 'fail'}">${esc(tr(result.passed ? 'quiz.passed' : 'quiz.failed', { p: course.quiz.passScore }))}</p>
            <div class="learn-actions" style="justify-content:center">
              ${result.eligibility?.eligible ? `<button class="btn primary" id="cert-after">${esc(tr('learn.certificate.view'))}</button>` : ''}
              <button class="btn ghost" id="retry-btn">${esc(tr('quiz.retry'))}</button>
            </div>
          </div>` : ''}
        <form id="quiz-form" class="quiz-card">
          ${course.quiz.questions.map((q, qi) => `
            <div class="quiz-q">
              <h3>${qi + 1}. ${esc(pick(q.q))}</h3>
              ${q.options.map((o, oi) => {
                let cls = '';
                if (result) {
                  const d = result.detail.find((x) => x.questionId === q.id);
                  if (d && d.correct && d.chosen === oi) cls = 'correct';
                  if (d && !d.correct && d.chosen === oi) cls = 'wrong';
                }
                return `<label class="quiz-opt ${cls}"><input type="radio" name="q${qi}" value="${oi}" ${result ? 'disabled' : ''}> <span>${esc(pick(o))}</span></label>`;
              }).join('')}
            </div>`).join('')}
          ${result ? '' : `<p class="form-error" id="quiz-err" hidden>${esc(tr('quiz.unanswered'))}</p><button class="btn primary" type="submit">${esc(tr('quiz.submit'))}</button>`}
        </form>
      </div>`;
    if (result) {
      document.getElementById('retry-btn').onclick = () => renderForm(null);
      const certAfter = document.getElementById('cert-after');
      if (certAfter) certAfter.onclick = async () => {
        try {
          const { certificate } = await api('/api/certificate', { method: 'POST', body: { courseId: course.id } });
          location.hash = `#/certificate/${certificate.id}`;
        } catch { toast(tr('cert.locked')); }
      };
      return;
    }
    document.getElementById('quiz-form').onsubmit = async (e) => {
      e.preventDefault();
      const answers = course.quiz.questions.map((_, qi) => {
        const sel = document.querySelector(`input[name="q${qi}"]:checked`);
        return sel ? Number(sel.value) : null;
      });
      if (answers.some((a) => a === null)) {
        document.getElementById('quiz-err').hidden = false;
        return;
      }
      try {
        const res = await api('/api/quiz', { method: 'POST', body: { courseId: course.id, answers } });
        renderForm(res);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch { toast(tr('error.generic')); }
    };
  };
  renderForm(null);
}

async function viewCertificate(id) {
  loading();
  let cert;
  try { ({ certificate: cert } = await api(`/api/certificate?id=${encodeURIComponent(id)}`)); } catch {
    $app.innerHTML = `<div class="wrap section"><p class="alert">${esc(tr('cert.locked'))}</p></div>`; return;
  }
  const dateFmt = new Intl.DateTimeFormat(state.lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'long' });
  $app.innerHTML = `
    <div class="wrap">
      <div class="cert-toolbar">
        <button class="btn ghost" id="print-btn">${esc(tr('cert.print'))}</button>
        <button class="btn primary" id="pdf-btn">${esc(tr('cert.pdf'))}</button>
      </div>
      <div class="certificate" id="certificate-el">
        <div class="cert-brand">darsaty.</div>
        <h1>${esc(tr('cert.title'))}</h1>
        <p class="cert-sub">${esc(tr('cert.awarded'))}</p>
        <p class="cert-name">${esc(cert.learnerName)}</p>
        <p class="cert-sub">${esc(tr('cert.completed'))}</p>
        <p class="cert-course">${esc(pick(cert.courseTitle))}</p>
        <div class="cert-meta">
          <div><b>${esc(cert.serial)}</b>${esc(tr('cert.serial'))}</div>
          <div><b>${esc(dateFmt.format(new Date(cert.at)))}</b>${esc(tr('cert.date'))}</div>
          <div><b>${esc(cert.instructorName)}</b>${esc(tr('course.instructor'))}</div>
          <div class="cert-seal">DARSATY<br>VERIFIED</div>
        </div>
      </div>
    </div>`;
  document.getElementById('print-btn').onclick = () => window.print();
  document.getElementById('pdf-btn').onclick = () => {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      doc.setFillColor(253, 251, 247);
      doc.rect(0, 0, W, H, 'F');
      doc.setDrawColor(109, 94, 240);
      doc.setLineWidth(3);
      doc.rect(28, 28, W - 56, H - 56);
      doc.setTextColor(76, 63, 212);
      doc.setFontSize(20).text('darsaty.', 60, 78);
      doc.setFontSize(38).text('Certificate of Completion', W / 2, 160, { align: 'center' });
      doc.setTextColor(90, 84, 112);
      doc.setFontSize(13).text('This certifies that', W / 2, 205, { align: 'center' });
      doc.setTextColor(76, 63, 212);
      doc.setFontSize(30).text(cert.learnerName, W / 2, 250, { align: 'center' });
      doc.setTextColor(90, 84, 112);
      doc.setFontSize(13).text('has successfully completed the course', W / 2, 285, { align: 'center' });
      doc.setTextColor(28, 24, 48);
      doc.setFontSize(20).text(cert.courseTitle.en, W / 2, 322, { align: 'center' });
      doc.setTextColor(90, 84, 112);
      doc.setFontSize(11);
      doc.text(`Certificate ID: ${cert.serial}`, 60, H - 60);
      doc.text(`Issued: ${new Date(cert.at).toISOString().slice(0, 10)}`, W / 2, H - 60, { align: 'center' });
      doc.text(`Instructor: ${cert.instructorName}`, W - 60, H - 60, { align: 'right' });
      doc.save(`${cert.serial}.pdf`);
    } catch { toast(tr('error.generic')); }
  };
}

async function viewMy() {
  if (!state.user) { location.hash = '#/auth'; return; }
  setActiveNav('my');
  loading();
  let progress;
  try { ({ progress } = await api('/api/progress')); } catch {
    $app.innerHTML = `<div class="wrap section"><p class="alert">${esc(tr('error.load'))}</p></div>`; return;
  }
  $app.innerHTML = `
    <div class="wrap section">
      <div class="section-head"><h2>${esc(tr('nav.myLearning'))}</h2></div>
      ${progress.length === 0 ? `<p class="empty-state">${esc(tr('catalog.empty'))}</p>` : ''}
      ${progress.map((p) => `
        <div class="my-course">
          <img src="${esc(p.cover)}" alt="">
          <div>
            <h3>${esc(pick(p.title))}</h3>
            <div class="sub">${p.completedLessons.length}/${p.totalLessons} · ${p.bestQuizScore ? esc(tr('quiz.score', { s: p.bestQuizScore })) : ''}</div>
            <div class="meter" style="margin-top:8px"><i style="width:${p.pct}%"></i></div>
          </div>
          <div class="learn-actions">
            <a class="btn primary small" href="#/learn/${esc(p.slug)}">${esc(tr('course.continue'))}</a>
            ${p.certificateId ? `<a class="btn ghost small" href="#/certificate/${esc(p.certificateId)}">${esc(tr('learn.certificate.view'))}</a>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
}

async function viewDashboard() {
  if (!state.user) { location.hash = '#/auth?next=' + encodeURIComponent('#/dashboard'); return; }
  setActiveNav('dashboard');
  loading();
  let data;
  try { data = await api('/api/dashboard'); } catch (e) {
    $app.innerHTML = `<div class="wrap section"><p class="alert">${esc(tr(e.code === 403 || e.code === 'forbidden' ? 'dash.forbidden' : 'error.load'))}</p></div>`;
    return;
  }
  const s = data.stats;
  $app.innerHTML = `
    <div class="wrap section">
      <div class="section-head"><h2>${esc(tr('dash.title'))}</h2></div>
      <div class="stat-cards">
        <div class="stat-card"><b>${s.students}</b><span>${esc(tr('dash.students'))}</span></div>
        <div class="stat-card"><b>$${s.revenue}</b><span>${esc(tr('dash.revenue'))}</span><span class="sub">$${s.recentRevenue} · ${esc(tr('dash.last30', { n: s.windowDays }))}</span></div>
        <div class="stat-card"><b>${s.completions}</b><span>${esc(tr('dash.completions'))}</span></div>
        <div class="stat-card"><b>${s.avgScore === null ? '—' : s.avgScore + '%'}</b><span>${esc(tr('dash.avgScore'))}</span></div>
      </div>
      <div class="panel">
        <h3>${esc(tr('dash.yourCourses'))}</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>${esc(tr('dash.courseCol'))}</th><th>${esc(tr('dash.enrollments'))}</th><th>${esc(tr('dash.revenueCol'))}</th><th>${esc(tr('dash.completionRate'))}</th><th>${esc(tr('dash.bestScore'))}</th></tr></thead>
          <tbody>${data.courses.map((c) => `
            <tr>
              <td><a href="#/course/${esc(c.slug)}">${esc(pick(c.title))}</a></td>
              <td>${c.students}</td>
              <td>$${c.revenue}</td>
              <td><div class="meter"><i style="width:${c.completionRate}%"></i></div></td>
              <td>${c.avgScore === null ? '—' : c.avgScore + '%'}</td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="panel">
        <h3>${esc(tr('dash.recent'))}</h3>
        ${data.recent.length === 0 ? `<p style="color:var(--muted)">${esc(tr('dash.empty'))}</p>` : `
        <div class="table-wrap"><table>
          <thead><tr><th>${esc(tr('dash.learner'))}</th><th>${esc(tr('dash.courseCol'))}</th><th>${esc(tr('dash.progress'))}</th><th>${esc(tr('dash.bestScore'))}</th></tr></thead>
          <tbody>${data.recent.map((r) => `
            <tr>
              <td>${esc(r.learner)}</td>
              <td>${esc(pick(r.courseTitle))}</td>
              <td><div class="meter"><i style="width:${r.pct}%"></i></div></td>
              <td>${r.bestScore === null ? '—' : r.bestScore + '%'}</td>
            </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
      <div class="panel">
        <h3>${esc(tr('dash.newCourse'))}</h3>
        <form id="create-form" class="form-grid">
          <div class="field"><label>${esc(tr('dash.create.titleEn'))}</label><input name="titleEn" required dir="ltr"></div>
          <div class="field"><label>${esc(tr('dash.create.titleAr'))}</label><input name="titleAr" required dir="rtl"></div>
          <div class="field"><label>${esc(tr('dash.create.category'))}</label>
            <select name="category">${state.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.en)} · ${esc(c.ar)}</option>`).join('')}</select></div>
          <div class="field"><label>${esc(tr('dash.create.price'))}</label><input name="price" type="number" min="0" max="9999" value="49" required></div>
          <div class="field full"><label>${esc(tr('dash.create.summaryEn'))}</label><textarea name="summaryEn" required dir="ltr"></textarea></div>
          <div class="field full"><label>${esc(tr('dash.create.summaryAr'))}</label><textarea name="summaryAr" required dir="rtl"></textarea></div>
          <div class="field full"><label>${esc(tr('dash.create.lessons'))}</label><textarea name="lessons" required placeholder="Intro to HTML | مقدمة في HTML | 20" style="min-height:120px"></textarea></div>
          <div class="field full"><button class="btn primary" type="submit">${esc(tr('dash.create.submit'))}</button> <span id="create-msg"></span></div>
        </form>
      </div>
    </div>`;
  document.getElementById('create-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const lessons = String(fd.get('lessons')).split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [en, ar, min] = line.split('|').map((x) => (x || '').trim());
      return { en, ar: ar || en, minutes: Number(min) || 15 };
    });
    try {
      await api('/api/courses', {
        method: 'POST',
        body: {
          titleEn: fd.get('titleEn'), titleAr: fd.get('titleAr'),
          summaryEn: fd.get('summaryEn'), summaryAr: fd.get('summaryAr'),
          category: fd.get('category'), price: Number(fd.get('price')),
          lessons,
        },
      });
      document.getElementById('create-msg').textContent = tr('dash.create.done');
      e.target.reset();
    } catch { toast(tr('error.generic')); }
  };
}

function viewAuth() {
  loading();
  const next = new URLSearchParams(location.hash.split('?')[1] || '').get('next') || '#/';
  let mode = 'login';
  const render = () => {
    $app.innerHTML = `
      <div class="auth-shell wrap">
        <div class="auth-tabs">
          <button class="${mode === 'login' ? 'active' : ''}" data-mode="login">${esc(tr('auth.login.title'))}</button>
          <button class="${mode === 'signup' ? 'active' : ''}" data-mode="signup">${esc(tr('auth.signup.title'))}</button>
        </div>
        <div class="panel">
          <form id="auth-form" class="form-grid" style="grid-template-columns:1fr">
            ${mode === 'signup' ? `<div class="field"><label>${esc(tr('auth.name'))}</label><input name="name" required></div>` : ''}
            <div class="field"><label>${esc(tr('auth.email'))}</label><input name="email" type="email" required dir="ltr"></div>
            <div class="field"><label>${esc(tr('auth.password'))}</label><input name="password" type="password" minlength="8" required dir="ltr"></div>
            <p class="form-error" id="auth-err" hidden></p>
            <button class="btn primary" type="submit">${esc(tr(mode === 'login' ? 'auth.login.btn' : 'auth.signup.btn'))}</button>
          </form>
          <div class="demo-accounts">${esc(tr('auth.demo'))}</div>
        </div>
      </div>`;
    document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { mode = b.dataset.mode; render(); }));
    document.getElementById('auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById('auth-err');
      try {
        const body = mode === 'login'
          ? { action: 'login', email: fd.get('email'), password: fd.get('password') }
          : { action: 'signup', name: fd.get('name'), email: fd.get('email'), password: fd.get('password') };
        const res = await api('/api/auth', { method: 'POST', body });
        state.token = res.token; state.user = res.user;
        localStorage.setItem(LS.token, res.token);
        renderShell();
        await flushOutbox();
        location.hash = next;
        route();
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = tr(err.code === 'email_exists' ? 'auth.exists' : 'auth.error');
      }
    };
  };
  render();
}

/* ---------------- router ---------------- */
function route() {
  const hash = location.hash || '#/';
  const [path] = hash.slice(1).split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return viewHome();
  if (parts[0] === 'course' && parts[1]) return viewCourse(decodeURIComponent(parts[1]));
  if (parts[0] === 'learn' && parts[1]) return viewLearn(decodeURIComponent(parts[1]));
  if (parts[0] === 'quiz' && parts[1]) return viewQuiz(decodeURIComponent(parts[1]));
  if (parts[0] === 'certificate' && parts[1]) return viewCertificate(decodeURIComponent(parts[1]));
  if (parts[0] === 'my') return viewMy();
  if (parts[0] === 'dashboard') return viewDashboard();
  if (parts[0] === 'auth') return viewAuth();
  viewHome();
}

window.addEventListener('hashchange', route);

async function init() {
  renderShell();
  if (state.token) {
    try {
      const { user } = await api('/api/auth', { method: 'POST', body: { action: 'me' } });
      state.user = user;
      renderShell();
      flushOutbox();
    } catch {
      state.token = null;
      localStorage.removeItem(LS.token);
      renderShell();
    }
  }
  route();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

init();
