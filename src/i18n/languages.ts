export type LocaleCode = 'en' | 'es' | 'pt' | 'de' | 'fr' | 'ja' | 'zh' | 'ru';

export interface LanguageOption {
  code: LocaleCode;
  name: string;
  nativeName: string;
  shortLabel: string;
  ogLocale: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English', nativeName: 'English', shortLabel: 'EN', ogLocale: 'en_US' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', shortLabel: 'ES', ogLocale: 'es_ES' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', shortLabel: 'PT', ogLocale: 'pt_PT' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', shortLabel: 'DE', ogLocale: 'de_DE' },
  { code: 'fr', name: 'French', nativeName: 'Français', shortLabel: 'FR', ogLocale: 'fr_FR' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', shortLabel: 'JA', ogLocale: 'ja_JP' },
  { code: 'zh', name: 'Simplified Chinese', nativeName: '简体中文', shortLabel: '中文', ogLocale: 'zh_CN' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', shortLabel: 'RU', ogLocale: 'ru_RU' },
];

export const NON_DEFAULT_LOCALES: LocaleCode[] = ['es', 'pt', 'de', 'fr', 'ja', 'zh', 'ru'];

export const DEFAULT_LOCALE: LocaleCode = 'en';

export function isValidLocale(value: string | null | undefined): value is LocaleCode {
  return LANGUAGES.some((lang) => lang.code === value);
}
