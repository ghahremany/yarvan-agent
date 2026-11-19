(() => {
  'use strict';
  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const copy = JSON.parse($('copy-data').textContent);
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const theme = $('theme');
  const language = $('language');
  const live = $('live');
  const repo = 'https://github.com/ghahremany/yarvan-agent';
  const chatTabs = [...document.querySelectorAll('[data-chat]')];
  const scenarioTabs = [...document.querySelectorAll('[data-scenario]')];
  const accents = ['blue', 'green', 'teal', 'peach'];
  const menus = [...document.querySelectorAll('.dropdown')];
  const copyTimers = new WeakMap();
  let lang = 'fa';
  let chat = 0;
  let scenario = 0;

  function t(key) { return key.split('.').reduce((scope, part) => scope[part], copy[lang]); }
  function text(id, value) { $(id).textContent = value; }
  function isDark() { return (root.dataset.theme ?? (systemTheme.matches ? 'dark' : 'light')) === 'dark'; }
  function syncThemeLabel() {
    const label = t(isDark() ? 'ui.light' : 'ui.dark');
    theme.setAttribute('aria-label', label);
    theme.title = label;
  }
  function updateAvatar(id, index) {
    const avatar = $(id);
    avatar.classList.remove(...accents);
    avatar.classList.add(accents[index]);
  }
  function drawChat(announce = false) {
    const data = copy[lang].examples[chat];
    for (const field of ['name', 'model', 'time', 'ask', 'reply1', 'reply2', 'extra']) text('app-' + field, data[field]);
    updateAvatar('app-avatar', chat);
    chatTabs.forEach((button, index) => button.setAttribute('aria-pressed', String(index === chat)));
    if (announce) live.textContent = `${t('showcase.opened')} ${data.name}`;
  }
  function drawScenario(announce = false) {
    const data = copy[lang].examples[scenario];
    for (const field of ['name', 'desc', 'tag1', 'tag2']) text('scenario-' + field, data[field]);
    for (const field of ['name', 'scope', 'ask', 'extra']) text('phone-' + field, data[field]);
    text('phone-reply', data.reply2);
    updateAvatar('phone-avatar', scenario);
    scenarioTabs.forEach((button, index) => button.setAttribute('aria-pressed', String(index === scenario)));
    if (announce) live.textContent = `${t('showcase.opened')} ${data.name}`;
  }
  function setLocale(next, updateUrl = false) {
    lang = next === 'en' ? 'en' : 'fa';
    const rtl = lang === 'fa';
    root.lang = lang;
    root.dir = rtl ? 'rtl' : 'ltr';
    document.title = t('meta.title');
    document.querySelector('meta[name="description"]').content = t('meta.description');
    document.querySelectorAll('[data-mirror]').forEach((el) => { el.dir = root.dir; });
    document.querySelectorAll('[data-i]').forEach((el) => { el.textContent = t(el.dataset.i); });
    document.querySelectorAll('[data-label]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.label)));
    document.querySelectorAll('[data-doc]').forEach((el) => {
      el.href = repo + (rtl ? '/blob/main/docs/yarvan/guide-fa.md' : '/blob/main/README.en.md');
    });
    document.querySelectorAll('[data-install-guide]').forEach((el) => {
      el.href = repo + (rtl ? '/blob/main/docs/yarvan/install-fa.md' : '/blob/main/docs/yarvan/install.md');
    });
    const other = rtl ? 'en' : 'fa';
    language.textContent = rtl ? 'EN' : 'فا';
    language.lang = other;
    language.hreflang = other;
    language.href = '?lang=' + other + location.hash;
    language.setAttribute('aria-label', rtl ? 'Read in English' : 'خواندن به فارسی');
    syncThemeLabel();
    drawChat();
    drawScenario();
    if (updateUrl) {
      try {
        const url = new URL(location.href);
        if (rtl) url.searchParams.delete('lang'); else url.searchParams.set('lang', 'en');
        history.replaceState(null, '', url);
      } catch { /* The standalone preview may run in an opaque-origin iframe. */ }
    }
  }

  function openChat(index) {
    chat = index;
    drawChat(true);
    const tab = chatTabs[chat];
    const roster = tab.parentElement;
    const itemBox = tab.getBoundingClientRect();
    const listBox = roster.getBoundingClientRect();
    if (itemBox.left < listBox.left || itemBox.right > listBox.right) {
      roster.scrollBy({ left: itemBox.left - listBox.left, behavior: 'auto' });
    }
  }
  chatTabs.forEach((item, index) => {
    item.disabled = false;
    item.addEventListener('click', () => openChat(index));
  });
  scenarioTabs.forEach((item, index) => {
    item.disabled = false;
    item.addEventListener('click', () => { scenario = index; drawScenario(true); });
  });
  $('demo-next').addEventListener('click', () => openChat((chat + 1) % chatTabs.length));
  $('demo-next').hidden = false;
  theme.addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    try { localStorage.setItem('yarvan-product-theme', root.dataset.theme); } catch { /* Theme still changes for this page. */ }
    syncThemeLabel();
  });
  systemTheme.addEventListener('change', syncThemeLabel);
  language.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setLocale(lang === 'fa' ? 'en' : 'fa', true);
  });
  window.addEventListener('hashchange', () => { language.href = '?lang=' + language.hreflang + location.hash; });
  theme.hidden = false;
  language.hidden = false;

  for (const button of document.querySelectorAll('[data-copy]')) {
    button.hidden = false;
    button.addEventListener('click', async () => {
      const source = $(button.dataset.copy);
      let copied = false;
      try { await navigator.clipboard.writeText(source.textContent); copied = true; } catch {
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(source);
          selection.removeAllRanges();
          selection.addRange(range);
          try { copied = document.execCommand('copy'); } catch { /* Leave selection available for manual copy. */ }
          if (copied) selection.removeAllRanges();
        }
      }
      live.textContent = t(copied ? 'ui.copied' : 'ui.select');
      button.textContent = t(copied ? 'ui.copied' : 'ui.selected');
      clearTimeout(copyTimers.get(button));
      copyTimers.set(button, setTimeout(() => { button.textContent = t('ui.copy'); }, 3100));
    });
  }

  document.addEventListener('click', (event) => {
    for (const menu of menus) {
      if (menu.open && (!menu.contains(event.target) || event.target.closest('.drop-panel a'))) menu.open = false;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const active = menus.find((menu) => menu.open);
    if (!active) return;
    active.open = false;
    active.querySelector('summary').focus();
  });
  setLocale(new URLSearchParams(location.search).get('lang'));
})();
