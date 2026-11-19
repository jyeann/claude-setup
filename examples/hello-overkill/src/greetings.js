'use strict';

const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' }, { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' }, { code: 'it', label: 'Italian' }, { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' }, { code: 'sv', label: 'Swedish' }, { code: 'ja', label: 'Japanese' },
  { code: 'sw', label: 'Swahili' },
];
const TONES = [
  { code: 'formal', label: 'Formal' }, { code: 'pirate', label: 'Pirate' },
  { code: 'shakespearean', label: 'Shakespearean' }, { code: 'corporate', label: 'Corporate' },
];

// One template per language.tone; {name} appears exactly once.
const TEMPLATES = {
  en: {
    formal: 'Good day, {name}. It is a pleasure to make your acquaintance.',
    pirate: 'Ahoy, {name}! Welcome aboard, ye scurvy dog!',
    shakespearean: 'Hark, good {name}! Thrice welcome to this fair place.',
    corporate: 'Hi {name}, let us circle back and synergize on this greeting.',
  },
  es: {
    formal: 'Buenos días, {name}. Es un placer saludarle.',
    pirate: '¡Ahoy, {name}! ¡Bienvenido a bordo, grumete!',
    shakespearean: '¡Salve, noble {name}! Bienvenido seas a esta morada.',
    corporate: 'Hola {name}, alineemos sinergias para este saludo.',
  },
  fr: {
    formal: 'Bonjour, {name}. Enchanté de faire votre connaissance.',
    pirate: 'Ohé, {name} ! Bienvenue à bord, moussaillon !',
    shakespearean: 'Salut à toi, noble {name} ! Sois le bienvenu en ces lieux.',
    corporate: 'Bonjour {name}, faisons un point pour optimiser ce salut.',
  },
  de: {
    formal: 'Guten Tag, {name}. Es freut mich sehr, Sie kennenzulernen.',
    pirate: 'Ahoi, {name}! Willkommen an Bord, Landratte!',
    shakespearean: 'Sei gegrüßt, edler {name}! Willkommen an diesem schönen Ort.',
    corporate: 'Hallo {name}, lassen Sie uns diese Begrüßung skalierbar machen.',
  },
  it: {
    formal: 'Buongiorno, {name}. È un piacere conoscerla.',
    pirate: 'Ohilà, {name}! Benvenuto a bordo, mozzo!',
    shakespearean: 'Salve, nobile {name}! Benvenuto in questa dimora.',
    corporate: 'Ciao {name}, allineiamoci per ottimizzare questo saluto.',
  },
  pt: {
    formal: 'Bom dia, {name}. É um prazer conhecê-lo.',
    pirate: 'Ahoy, {name}! Bem-vindo a bordo, marujo!',
    shakespearean: 'Salve, nobre {name}! Sê bem-vindo a este lugar.',
    corporate: 'Olá {name}, vamos alinhar sinergias neste cumprimento.',
  },
  nl: {
    formal: 'Goedendag, {name}. Aangenaam kennis te maken.',
    pirate: 'Ahoi, {name}! Welkom aan boord, landrot!',
    shakespearean: 'Wees gegroet, edele {name}! Welkom op deze plek.',
    corporate: 'Hoi {name}, laten we even afstemmen over deze groet.',
  },
  sv: {
    formal: 'God dag, {name}. Det är ett nöje att träffas.',
    pirate: 'Ahoj, {name}! Välkommen ombord, landkrabba!',
    shakespearean: 'Hell dig, ädle {name}! Välkommen till denna plats.',
    corporate: 'Hej {name}, låt oss synka kring den här hälsningen.',
  },
  ja: {
    formal: 'はじめまして、{name}様。お会いできて光栄です。',
    pirate: 'おーい、{name}！船へようこそ、新入り！',
    shakespearean: 'おお、高貴なる{name}よ！この地へよくぞ参られた。',
    corporate: '{name}さん、お世話になっております。本件、シナジーを最大化しましょう。',
  },
  sw: {
    formal: 'Habari za mchana, {name}. Ni furaha kukutana nawe.',
    pirate: 'Ahoi, {name}! Karibu ndani ya meli, baharia!',
    shakespearean: 'Salamu, {name} mtukufu! Karibu katika mahali hapa pazuri.',
    corporate: 'Habari {name}, tuoanishe mikakati ya salamu hii.',
  },
};

const CATALOGUE = new Map();
for (const l of LANGUAGES) {
  for (const t of TONES) {
    CATALOGUE.set(`${l.code}.${t.code}`, { id: `${l.code}.${t.code}`, language: l.code, tone: t.code, template: TEMPLATES[l.code][t.code] });
  }
}

const LANG_SET = new Set(LANGUAGES.map((l) => l.code));
const TONE_SET = new Set(TONES.map((t) => t.code));
const isLanguage = (v) => typeof v === 'string' && LANG_SET.has(v);
const isTone = (v) => typeof v === 'string' && TONE_SET.has(v);

// Renders the greeting for a catalogue entry; returns null for an unknown language or tone.
function render(lang, tone, name) {
  const entry = isLanguage(lang) && isTone(tone) ? CATALOGUE.get(`${lang}.${tone}`) : undefined;
  if (!entry) return null;
  const i = entry.template.indexOf('{name}');
  return entry.template.slice(0, i) + String(name) + entry.template.slice(i + 6);
}

module.exports = { LANGUAGES, TONES, CATALOGUE, render, isLanguage, isTone };
