// script.js - index page behavior (keeps existing IDs & functions)
// Cleaned up and hardened version

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

  /**
   * Ensure XLSX library is loaded (injects CDN script if needed).
   * Resolves if loaded, rejects on error.
   */
  async function ensureXLSX() {
    if (typeof XLSX !== 'undefined') return;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = () => {
        // small timeout to ensure globals set
        setTimeout(resolve, 10);
      };
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
        const url = candidate;
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) {
          // Not found or server error - try next candidate
          continue;
        }

        if (candidate.toLowerCase().endsWith('.json')) {
          const json = await resp.json();
          if (Array.isArray(json) && json.length) return json;
          continue;
        }

        // handle xlsx
        const arrayBuffer = await resp.arrayBuffer();
        try {
          await ensureXLSX(); // ensure XLSX loaded
        } catch (err) {
          console.warn('XLSX library could not be loaded:', err);
          continue;
        }

        // read workbook from array buffer
        const data = new Uint8Array(arrayBuffer);
        let wb;
        try {
          wb = XLSX.read(data, { type: 'array' });
        } catch (err) {
          // Some hosts may require different reading; warn and continue
          console.warn('XLSX.read failed for', candidate, err);
          continue;
        }

        if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) continue;
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
        if (Array.isArray(rows) && rows.length) return rows;
      } catch (err) {
        // network or parsing error - continue to next candidate
        console.warn('Failed to fetch/parse', candidate, err);
      }
    }

    // no candidate succeeded
    return null;
  }

  /**
   * Populate the year select based on rows obtained from the dataset.
   * Normalizes Year field (handles Year/ year / numeric strings).
   */
  async function populateYearsForDisease(diseaseKey) {
    if (!yearSelect) return;
    yearSelect.innerHTML = ''; // clear while loading

    if (!diseaseKey || !datasetsMap[diseaseKey]) {
      const opt = document.createElement('option');
      opt.textContent = 'No data';
      opt.value = '';
      yearSelect.appendChild(opt);
      return;
    }

    const base = datasetsMap[diseaseKey];
    const rows = await fetchRowsFromCandidates(base);

    if (!rows || !rows.length) {
      const opt = document.createElement('option');
      opt.textContent = 'No data';
      opt.value = '';
      yearSelect.appendChild(opt);
      return;
    }

    // extract years - accept 'Year' or 'year' or numeric-looking values
    const yearSet = new Set();
    for (const r of rows) {
      // search possible keys
      let val = null;
      if (Object.prototype.hasOwnProperty.call(r, 'Year')) val = r['Year'];
      else if (Object.prototype.hasOwnProperty.call(r, 'year')) val = r['year'];
      else {
        // fallback: find any numeric value that looks like a year
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

    years.forEach((y) => {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      yearSelect.appendChild(opt);
    });

    // try to select a sensible default - 2010 if available, else latest
    if (years.includes(2010)) yearSelect.value = '2010';
    else yearSelect.value = String(years[years.length - 1]);
  }

  // on load: try to populate year list for current disease selection
  (async () => {
    try {
      // attempt to preload XLSX lib (not mandatory)
      await ensureXLSX().catch(() => {
        // ignore - we will try to load per-file if needed later
      });
    } catch (e) {
      // ignore
    }
    if (diseaseSelect && diseaseSelect.value) {
      populateYearsForDisease(diseaseSelect.value);
    } else if (diseaseSelect) {
      // if no selection, still call with current value
      populateYearsForDisease(diseaseSelect.value);
    } else if (yearSelect) {
      // fallback: if no disease select, fill a safe year range 2008..current year
      yearSelect.innerHTML = '';
      const now = new Date().getFullYear();
      for (let y = 2008; y <= now; y++) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        yearSelect.appendChild(opt);
      }
      yearSelect.value = '2010';
    }
  })();

  // when disease changes, refresh year list
  if (diseaseSelect) {
    diseaseSelect.addEventListener('change', () => populateYearsForDisease(diseaseSelect.value));
  }

  // view map button -> open map with selected disease & year
  const viewMapBtn = document.getElementById('viewMap');
  if (viewMapBtn) {
    viewMapBtn.addEventListener('click', () => {
      const d = diseaseSelect ? diseaseSelect.value : '';
      const y = yearSelect ? yearSelect.value : '';
      if (!d || !y) return alert('Choose disease and year');
      window.location.href = `map.html?disease=${encodeURIComponent(d)}&year=${encodeURIComponent(y)}`;
    });
  }

  // open example state button
  const openStateBtn = document.getElementById('openState');
  if (openStateBtn) {
    openStateBtn.addEventListener('click', () => {
      const d = diseaseSelect ? diseaseSelect.value : '';
      const y = yearSelect ? yearSelect.value : '';
      if (!d || !y) return alert('Choose disease and year');
      window.location.href = `state.html?state=California&disease=${encodeURIComponent(d)}&year=${encodeURIComponent(y)}`;
    });
  }

  // hero button: open map (if disease/year selected, use them, else open plain map)
  const heroOpenMap = document.getElementById('heroOpenMap');
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
})();
