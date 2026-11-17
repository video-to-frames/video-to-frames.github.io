import { DEFAULT_LOCALE, LANGUAGES, NON_DEFAULT_LOCALES, type LocaleCode } from './languages';
import type { TranslationKey, TranslationMap } from './types';
import { en } from './locales/en';
import { es } from './locales/es';
import { pt } from './locales/pt';
import { de } from './locales/de';
import { fr } from './locales/fr';
import { ja } from './locales/ja';
import { zh } from './locales/zh';
import { ru } from './locales/ru';

export { DEFAULT_LOCALE, LANGUAGES, NON_DEFAULT_LOCALES };
export type { LocaleCode, TranslationKey, TranslationMap };

export const SSR_TRANSLATIONS: Record<LocaleCode, TranslationMap> = {
  en,
  es,
  pt,
  de,
  fr,
  ja,
  zh,
  ru,
};

export function tServer(locale: LocaleCode, key: TranslationKey): string {
  return SSR_TRANSLATIONS[locale]?.[key] ?? SSR_TRANSLATIONS[DEFAULT_LOCALE][key];
}

export function getLocalePrefix(locale: LocaleCode): string {
  return locale === DEFAULT_LOCALE ? '' : `/${locale}`;
}

export function getLocalizedHref(locale: LocaleCode, routePath: string): string {
  const clean = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const normalized = clean.endsWith('/') ? clean : `${clean}/`;
  if (locale === DEFAULT_LOCALE) return normalized;
  return normalized === '/' ? `/${locale}/` : `/${locale}${normalized}`;
}
