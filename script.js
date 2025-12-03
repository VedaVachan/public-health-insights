// script.js - index page behavior (cleaned, hardened, plus button enable/disable)
// Replace your current script.js with this file.

(function () {
  // Theme toggle
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    const currentTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);

    function updateThemeIcon() {
      const theme = document.documentElement.getAttribute('data-theme');
      themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
      themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }

    updateThemeIcon();
    themeToggle.addEventListener('click', () => {
      const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      updateThemeIcon();
    });
  }

  // datasets map (root files)
  const datasetsMap = {
    HIV: 'HIV_data.xlsx',
    TB: 'TB.xlsx',
    Diabetes: 'Diabetes.xlsx',
    'Hepatitis-B': 'HepatitisB.xlsx',
    'Hepatitis-A': 'HepatitisA.xlsx',
    'Hepatitis-C': 'HepatitisC.xlsx',
    Gonorrhea: 'Gonorrhea.xlsx',
    Chlamydia: 'Chlamydia.xlsx',
    syphilis: 'syphilis.xlsx',
  };

  const diseaseSelect = document.getElementById('diseaseSelect');
  const yearSelect = document.getElementById('yearInput');
  const viewMapBtn = document.getElementById('viewMap');
  const openStateBtn = document.getElementById('openState');
  const heroOpenMap = document.getElementById('heroOpenMap');

  /**
   * Ensure XLSX library is loaded (injects CDN script if needed).
   * Resolves if loaded, rejects on error.
   */
  async function ensureXLSX() {
    if (typeof XLSX !== 'undefined') return;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = () => setTimeout(resolve, 10);
      s.onerror = (err) => reject(new Error('Failed to load XLSX library: ' + err));
      document.head.appendChild(s);
    });
  }

  /**
   * Try loading candidates for a dataset (first JSON, then XLSX).
   * Returns an array of row objects or null if not found.
   */
  async function fetchRowsFromCandidates(baseFilename) {
    const candidates = [
      baseFilename.replace(/\.xlsx$/i, '.json'),
      baseFilename,
    ];

    for (const candidate of candidates) {
      try {
        const resp = await fetch(candidate, { cache: 'no-store' });
        if (!resp.ok) continue;

        if (candidate.toLowerCase().endsWith('.json')) {
          const json = await resp.json();
          if (Array.isArray(json) && json.length) return json;
          continue;
        }

        // XLSX
        const arrayBuffer = await resp.arrayBuffer();
        try {
          await ensureXLSX();
        } catch (err) {
          console.warn('XLSX library could not be loaded:', err);
          continue;
        }

        const data = new Uint8Array(arrayBuffer);
        let wb;
        try {
          wb = XLSX.read(data, { type: 'array' });
        } catch (err) {
          console.warn('XLSX.read failed for', candidate, err);
          continue;
        }
        if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) continue;
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
        if (Array.isArray(rows) && rows.length) return rows;
      } catch (err) {
        console.warn('Failed to fetch/parse', candidate, err);
      }
    }
    return null;
  }

  /**
   * Populate the year select based on rows obtained from the dataset.
   * Adds a "Select year" placeholder and does NOT auto-select a year.
   */
  async function populateYearsForDisease(diseaseKey) {
    if (!yearSelect) return;
    yearSelect.innerHTML = ''; // clear while loading

    // Add placeholder immediately (so UI shows "Loading..." while loading)
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = 'Loading...';
    yearSelect.appendChild(placeholder);

    if (!diseaseKey || !datasetsMap[diseaseKey]) {
      yearSelect.innerHTML = '';
      const opt = document.createElement('option');
      opt.textContent = 'No data';
      opt.value = '';
      yearSelect.appendChild(opt);
      return;
    }

    const base = datasetsMap[diseaseKey];
    const rows = await fetchRowsFromCandidates(base);

    yearSelect.innerHTML = ''; // clear loading placeholder

    if (!rows || !rows.length) {
      const opt = document.createElement('option');
      opt.textContent = 'No data';
      opt.value = '';
      yearSelect.appendChild(opt);
      return;
    }

    // extract years - accept 'Year' or 'year' or numeric-looking keys
    const yearSet = new Set();
    for (const r of rows) {
      let val = null;
      if (Object.prototype.hasOwnProperty.call(r, 'Year')) val = r['Year'];
      else if (Object.prototype.hasOwnProperty.call(r, 'year')) val = r['year'];
      else {
        for (const k of Object.keys(r)) {
          const v = r[k];
          if (v == null) continue;
          const num = Number(v);
          if (!Number.isNaN(num) && num > 1900 && num < 2100) {
            val = num;
            break;
          }
        }
      }
      if (val == null) continue;
      const num = Number(val);
      if (!Number.isNaN(num)) yearSet.add(num);
    }

    const years = Array.from(yearSet).sort((a, b) => a - b);
    if (!years.length) {
      const opt = document.createElement('option');
      opt.textContent = 'No data';
      opt.value = '';
      yearSelect.appendChild(opt);
      return;
    }

    // insert the "Select year" placeholder
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = 'Select year';
    ph.disabled = true;
    ph.selected = true;
    yearSelect.appendChild(ph);

    // append sorted years
    years.forEach((y) => {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      yearSelect.appendChild(opt);
    });
  }

  // Ensure XLSX preloaded (best-effort) and populate initial years if diseaseSelect has a value
  (async () => {
    try { await ensureXLSX().catch(() => {}); } catch (e) {}
    if (diseaseSelect && diseaseSelect.value) {
      await populateYearsForDisease(diseaseSelect.value);
    } else if (diseaseSelect) {
      yearSelect && (yearSelect.innerHTML = '<option value="">No data</option>');
    } else if (yearSelect) {
      // fallback, fill a safe year range
      yearSelect.innerHTML = '';
      const now = new Date().getFullYear();
      const ph = document.createElement('option');
      ph.value = '';
      ph.disabled = true;
      ph.selected = true;
      ph.textContent = 'Select year';
      yearSelect.appendChild(ph);
      for (let y = 2008; y <= now; y++) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        yearSelect.appendChild(opt);
      }
    }
  })();

  // when disease changes, refresh year list
  if (diseaseSelect) {
    diseaseSelect.addEventListener('change', () => {
      populateYearsForDisease(diseaseSelect.value).then(() => updateActionButtons()).catch(() => updateActionButtons());
    });
  }

  // view map button -> open map with selected disease & year
  if (viewMapBtn) {
    viewMapBtn.addEventListener('click', () => {
      const d = diseaseSelect ? diseaseSelect.value : '';
      const y = yearSelect ? yearSelect.value : '';
      if (!d || !y) return alert('Choose disease and year');
      window.location.href = `map.html?disease=${encodeURIComponent(d)}&year=${encodeURIComponent(y)}`;
    });
  }

  // open example state button
  if (openStateBtn) {
    openStateBtn.addEventListener('click', () => {
      const d = diseaseSelect ? diseaseSelect.value : '';
      const y = yearSelect ? yearSelect.value : '';
      if (!d || !y) return alert('Choose disease and year');
      window.location.href = `state.html?state=California&disease=${encodeURIComponent(d)}&year=${encodeURIComponent(y)}`;
    });
  }

  // hero button: open map (if disease/year selected, use them, else open plain map)
  if (heroOpenMap) {
    heroOpenMap.addEventListener('click', () => {
      const d = diseaseSelect ? diseaseSelect.value : '';
      const y = yearSelect ? yearSelect.value : '';
      if (d && y) {
        window.location.href = `map.html?disease=${encodeURIComponent(d)}&year=${encodeURIComponent(y)}`;
      } else {
        window.location.href = 'map.html';
      }
    });
  }

  // --------- enable/disable action buttons based on selections ----------
  // Buttons remain disabled until user picks both a disease and a year
  function isYearValid(val) {
    if (!val) return false;
    const s = String(val).trim().toLowerCase();
    if (s === '' || s === 'no data' || s === 'loading...' || s === 'select year') return false;
    return !Number.isNaN(Number(val));
  }

  function isDiseaseValid(val) {
    if (!val) return false;
    const s = String(val).trim().toLowerCase();
    return !(s === '' || s === 'select disease');
  }

  function updateActionButtons() {
    try {
      const d = diseaseSelect ? diseaseSelect.value : '';
      const y = yearSelect ? yearSelect.value : '';
      const enabled = isDiseaseValid(d) && isYearValid(y);

      if (viewMapBtn) {
        viewMapBtn.disabled = !enabled;
        if (viewMapBtn.disabled) {
          viewMapBtn.classList.add('disabled');
          viewMapBtn.setAttribute('aria-disabled', 'true');
        } else {
          viewMapBtn.classList.remove('disabled');
          viewMapBtn.removeAttribute('aria-disabled');
        }
      }

      if (openStateBtn) {
        openStateBtn.disabled = !enabled;
        if (openStateBtn.disabled) {
          openStateBtn.classList.add('disabled');
          openStateBtn.setAttribute('aria-disabled', 'true');
        } else {
          openStateBtn.classList.remove('disabled');
          openStateBtn.removeAttribute('aria-disabled');
        }
      }

      console.debug('updateActionButtons:', { disease: d, year: y, enabled });
    } catch (err) {
      console.error('updateActionButtons error', err);
    }
  }

  // initialize and wire change events
  updateActionButtons();
  if (yearSelect) yearSelect.addEventListener('change', updateActionButtons);

  // Watch for year select option changes (useful when populateYearsForDisease replaces options)
  if (yearSelect && typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(() => {
      clearTimeout(window.__year_watch_timeout__);
      window.__year_watch_timeout__ = setTimeout(updateActionButtons, 40);
    });
    mo.observe(yearSelect, { childList: true, subtree: true });
  }

})();


