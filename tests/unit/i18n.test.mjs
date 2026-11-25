import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t } from '../../public/assets/i18n.mjs';

const en = Object.keys(STRINGS.en);
const ar = Object.keys(STRINGS.ar);

test('every English key has an Arabic twin and vice versa', () => {
  assert.deepEqual(new Set(en), new Set(ar));
  for (const k of en) {
    assert.ok(STRINGS.en[k].trim().length > 0, `empty en:${k}`);
    assert.ok(STRINGS.ar[k].trim().length > 0, `empty ar:${k}`);
  }
});

test('placeholder sets match between languages', () => {
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of en) {
    assert.deepEqual(ph(STRINGS.en[k]), ph(STRINGS.ar[k]), `placeholder mismatch: ${k}`);
  }
});

test('t() substitutes variables and falls back to English', () => {
  assert.equal(t('en', 'course.lessons', { n: 5 }), '5 lessons');
  assert.equal(t('ar', 'course.lessons', { n: 5 }), '5 درسًا');
  assert.equal(t('ar', 'missing-key-xyz'), 'missing-key-xyz');
});

test('Arabic strings contain Arabic, English strings contain Latin', () => {
  for (const k of en) {
    if (k === 'lang.switch') continue; // shows the OTHER language's name on purpose
    assert.match(STRINGS.ar[k], /[؀-ۿ]/, `ar:${k} has no Arabic characters`);
    assert.match(STRINGS.en[k], /[a-zA-Z]/, `en:${k} has no Latin characters`);
  }
});
