import { DEFAULT_LOCALE, isValidLocale, LANGUAGES, type LocaleCode } from './languages';
import type { TranslationKey, TranslationMap } from './types';
import { en } from './locales/en';

export { DEFAULT_LOCALE, isValidLocale, LANGUAGES };
export type { LocaleCode, TranslationKey, TranslationMap };

export const LANG_STORAGE_KEY = 'vtf-lang';
export const LANG_EVENT = 'vtf:langchange';

const loadedLocales: Partial<Record<LocaleCode, TranslationMap>> = {
  en,
};

const localeLoaders: Record<Exclude<LocaleCode, 'en'>, () => Promise<TranslationMap>> = {
  es: () => import('./locales/es').then((m) => m.es),
  pt: () => import('./locales/pt').then((m) => m.pt),
  de: () => import('./locales/de').then((m) => m.de),
  fr: () => import('./locales/fr').then((m) => m.fr),
  ja: () => import('./locales/ja').then((m) => m.ja),
  zh: () => import('./locales/zh').then((m) => m.zh),
  ru: () => import('./locales/ru').then((m) => m.ru),
};

function hydrateInlineSsrLocale(): void {
  if (typeof document === 'undefined') return;
  const pageLocale = document.documentElement.dataset.pageLocale;
  if (!isValidLocale(pageLocale) || pageLocale === DEFAULT_LOCALE || loadedLocales[pageLocale]) {
    return;
  }
  const el = document.getElementById('vtf-ssr-locale');
  if (el?.textContent) {
    try {
      loadedLocales[pageLocale] = JSON.parse(el.textContent) as TranslationMap;
    } catch {
      // Ignore malformed inline locale data
    }
  }
}

export async function ensureLocale(locale: LocaleCode): Promise<TranslationMap> {
  hydrateInlineSsrLocale();
  const cached = loadedLocales[locale];
  if (cached) return cached;
  if (locale === 'en') return en;

  const map = await localeLoaders[locale]();
  loadedLocales[locale] = map;
  return map;
}

export function t(locale: LocaleCode, key: TranslationKey): string {
  hydrateInlineSsrLocale();
  return loadedLocales[locale]?.[key] ?? loadedLocales[DEFAULT_LOCALE]?.[key] ?? en[key];
}

export function getPageLocale(): LocaleCode {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const attr = document.documentElement.dataset.pageLocale;
  return isValidLocale(attr) ? attr : DEFAULT_LOCALE;
}

export function getClientLocale(): LocaleCode {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  hydrateInlineSsrLocale();
  const pageLocale = getPageLocale();
  if (pageLocale !== DEFAULT_LOCALE) {
    return pageLocale;
  }
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isValidLocale(saved)) return saved;
  } catch {
    // Ignore storage access errors
  }
  return DEFAULT_LOCALE;
}

export async function setClientLocale(next: LocaleCode): Promise<void> {
  if (typeof window === 'undefined' || !isValidLocale(next)) return;
  await ensureLocale(next);
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, next);
  } catch {
    // Ignore storage access errors
  }
  document.documentElement.lang = next;
  window.dispatchEvent(new CustomEvent<LocaleCode>(LANG_EVENT, { detail: next }));
}
