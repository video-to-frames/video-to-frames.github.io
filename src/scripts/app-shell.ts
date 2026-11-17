import {
  ensureLocale,
  getClientLocale,
  getPageLocale,
  isValidLocale,
  LANG_EVENT,
  LANGUAGES,
  setClientLocale,
  t,
  type LocaleCode,
  type TranslationKey,
} from '../i18n';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const THEME_STORAGE_KEY = 'vtf-theme';

function getCurrentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: 'light' | 'dark', locale: LocaleCode): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage errors
  }

  const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.content = theme === 'dark' ? '#121010' : '#FCF8F8';
  }

  const toggleBtn = document.getElementById('vtf-theme-toggle');
  if (toggleBtn) {
    const labelKey: TranslationKey = theme === 'dark' ? 'nav.themeToLight' : 'nav.themeToDark';
    const label = t(locale, labelKey);
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.setAttribute('title', label);
  }
}

function applyLocaleToDocument(locale: LocaleCode): void {
  document.documentElement.lang = locale;

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n as TranslationKey | undefined;
    if (key) {
      el.textContent = t(locale, key);
    }
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const key = el.dataset.i18nAria as TranslationKey | undefined;
    if (key) {
      el.setAttribute('aria-label', t(locale, key));
    }
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle as TranslationKey | undefined;
    if (key) {
      el.setAttribute('title', t(locale, key));
    }
  });

  const metaTitleKey = document.body.dataset.metaTitleKey as TranslationKey | undefined;
  if (metaTitleKey) {
    document.title = t(locale, metaTitleKey);
  }

  const metaDescKey = document.body.dataset.metaDescKey as TranslationKey | undefined;
  if (metaDescKey) {
    const descEl = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (descEl) descEl.content = t(locale, metaDescKey);
  }

  const langMeta = LANGUAGES.find((l) => l.code === locale);
  const langLabelEl = document.getElementById('vtf-lang-current-label');
  if (langLabelEl && langMeta) {
    langLabelEl.textContent = langMeta.nativeName;
  }

  document.querySelectorAll<HTMLButtonElement>('[data-lang-option]').forEach((btn) => {
    const isActive = btn.dataset.langOption === locale;
    btn.setAttribute('aria-selected', String(isActive));
  });

  const toggleBtn = document.getElementById('vtf-theme-toggle');
  if (toggleBtn) {
    const theme = getCurrentTheme();
    const label = t(locale, theme === 'dark' ? 'nav.themeToLight' : 'nav.themeToDark');
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.setAttribute('title', label);
  }
}

function trapModalTab(container: HTMLElement, ev: KeyboardEvent): void {
  if (ev.key !== 'Tab') return;
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute('hidden'));

  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
}

export async function initAppShell(): Promise<void> {
  const pageLocale = getPageLocale();
  let currentLocale = getClientLocale();

  if (currentLocale !== pageLocale) {
    await ensureLocale(currentLocale);
    applyLocaleToDocument(currentLocale);
  } else {
    applyTheme(getCurrentTheme(), currentLocale);
  }

  window.addEventListener(LANG_EVENT, (ev) => {
    const custom = ev as CustomEvent<LocaleCode>;
    if (custom.detail && isValidLocale(custom.detail)) {
      currentLocale = custom.detail;
      applyLocaleToDocument(currentLocale);
    }
  });

  // Language dropdown controls + keyboard listbox navigation
  const langTrigger = document.getElementById('vtf-lang-trigger') as HTMLButtonElement | null;
  const langMenu = document.getElementById('vtf-lang-menu');
  const langOptions = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-lang-option]')
  );

  const closeLangMenu = (restoreFocus = false) => {
    if (!langMenu || !langTrigger || langMenu.hidden) return;
    langMenu.hidden = true;
    langTrigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) langTrigger.focus();
  };

  const openLangMenu = (focusSelected = false) => {
    if (!langMenu || !langTrigger) return;
    langMenu.hidden = false;
    langTrigger.setAttribute('aria-expanded', 'true');
    if (focusSelected) {
      const selected =
        langOptions.find((b) => b.getAttribute('aria-selected') === 'true') ?? langOptions[0];
      selected?.focus();
    }
  };

  langTrigger?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!langMenu) return;
    if (langMenu.hidden) {
      openLangMenu(true);
    } else {
      closeLangMenu(false);
    }
  });

  langTrigger?.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      openLangMenu(true);
    }
  });

  langOptions.forEach((btn, idx) => {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.langOption;
      if (isValidLocale(code)) {
        await setClientLocale(code);
      }
      closeLangMenu(true);
    });

    btn.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        langOptions[(idx + 1) % langOptions.length]?.focus();
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        langOptions[(idx - 1 + langOptions.length) % langOptions.length]?.focus();
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        langOptions[0]?.focus();
      } else if (ev.key === 'End') {
        ev.preventDefault();
        langOptions[langOptions.length - 1]?.focus();
      } else if (ev.key === 'Tab') {
        closeLangMenu(false);
      }
    });
  });

  document.addEventListener('click', (ev) => {
    if (!langMenu || langMenu.hidden) return;
    const target = ev.target as Node | null;
    if (target && !langMenu.contains(target) && !langTrigger?.contains(target)) {
      closeLangMenu(false);
    }
  });

  // Theme toggle (atomic class swap avoids partial transition contrast flash)
  const themeBtn = document.getElementById('vtf-theme-toggle');
  themeBtn?.addEventListener('click', () => {
    const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
    const rootEl = document.documentElement;
    rootEl.classList.add('vtf-no-transition');
    applyTheme(next, currentLocale);
    void window.getComputedStyle(document.body).backgroundColor;
    window.requestAnimationFrame(() => rootEl.classList.remove('vtf-no-transition'));
  });

  // PWA Service Worker & Install Handling
  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let lastModalOpener: HTMLElement | null = null;
  const installBtn = document.getElementById('vtf-pwa-install');
  const installLabel = document.getElementById('vtf-pwa-install-label');
  const pwaModal = document.getElementById('vtf-pwa-modal');
  const pwaCloseBtn = document.getElementById('vtf-pwa-modal-close') as HTMLButtonElement | null;
  const pwaInstalledText = document.getElementById('vtf-pwa-installed-msg');
  const pwaInstructions = document.getElementById('vtf-pwa-instructions');

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  const setInstalledUi = () => {
    if (installBtn) {
      installBtn.classList.add('nav-btn-installed');
      installBtn.setAttribute('data-i18n-aria', 'nav.installedApp');
      installBtn.setAttribute('data-i18n-title', 'nav.installedApp');
      const label = t(currentLocale, 'nav.installedApp');
      installBtn.setAttribute('aria-label', label);
      installBtn.setAttribute('title', label);
    }
    if (installLabel) {
      installLabel.setAttribute('data-i18n', 'nav.installedApp');
      installLabel.textContent = t(currentLocale, 'nav.installedApp');
    }
  };

  if (isStandalone) {
    setInstalledUi();
  }

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    deferredPrompt = ev as BeforeInstallPromptEvent;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    setInstalledUi();
  });

  const openPwaModal = () => {
    if (!pwaModal) return;
    lastModalOpener = document.activeElement as HTMLElement | null;
    const standaloneNow =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (pwaInstalledText && pwaInstructions) {
      pwaInstalledText.hidden = !standaloneNow;
      pwaInstructions.hidden = standaloneNow;
    }
    pwaModal.hidden = false;
    pwaCloseBtn?.focus();
  };

  const closePwaModal = () => {
    if (!pwaModal || pwaModal.hidden) return;
    pwaModal.hidden = true;
    lastModalOpener?.focus();
    lastModalOpener = null;
  };

  installBtn?.addEventListener('click', async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        deferredPrompt = null;
        setInstalledUi();
      }
      return;
    }
    openPwaModal();
  });

  pwaCloseBtn?.addEventListener('click', closePwaModal);
  pwaModal?.addEventListener('click', (ev) => {
    if (ev.target === pwaModal) closePwaModal();
  });
  pwaModal?.addEventListener('keydown', (ev) => {
    if (!pwaModal.hidden) trapModalTab(pwaModal, ev);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      closeLangMenu(true);
      closePwaModal();
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Ignore service worker registration errors in unsupported contexts
      });
    });
  }
}
