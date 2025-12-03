// script.js - improved: auto-select first available year & status messages
(function () {
  const themeToggle = document.getElementById('themeToggle');
  const statusEl = document.getElementById('app-status');
  function showStatus(msg, type='ok', timeout=4000) {
    if (!statusEl) return;
    statusEl.className = '';
    statusEl.classList.add(type);
    statusEl.textContent = msg;
    statusEl.style.display = 'block';
    if (timeout) setTimeout(() => { statusEl.style.display = 'none'; }, timeout);
  }

  if (themeToggle) {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    function updateThemeIcon(){ themeToggle.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙'; }
    updateThemeIcon();
    themeToggle.addEventListener('click', () => {
      const now = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', now);
      localStorage.setItem('theme', now);
      updateThemeIcon();
    });
  }

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

  async function ensureXLSX() {
    if (typeof XLSX !== 'undefined') return;
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = () => setTimeout(res, 10);
      s.onerror = () => rej(new Error('XLSX load fail'));
      document.head.appendChild(s);
    });
  }

  async function fetchRowsFromCandidates(baseFilename) {
    const candidates = [ baseFilename.replace(/\.xlsx$/i, '.json'), baseFilename ];
    console.debug('fetchRows candidates', candidates);
    for (const c of candidates) {
      try {
        const r = await fetch(c, { cache:'no-store' });
        console.debug('fetch', c, 'status', r.status);
        if (!r.ok) continue;
        if (c.toLowerCase().endsWith('.json')) {
          const json = await r.json();
          if (Array.isArray(json) && json.length) return { rows: json, source: c };
          continue;
        }
        // xlsx
        const buf = await r.arrayBuffer();
        try { await ensureXLSX(); } catch (e) { console.warn('XLSX not available', e); }
        if (typeof XLSX === 'undefined') {
          console.warn('XLSX missing after load attempt; skipping xlsx parse');
          continue;
        }
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
        if (Array.isArray(rows) && rows.length) return { rows, source: c };
      } catch (err) {
        console.warn('fetchRowsFromCandidates error for', c, err);
      }
    }
    return null;
  }

  async function populateYearsForDisease(diseaseKey) {
    if (!yearSelect) return null;
    yearSelect.innerHTML = '';
    const loading = document.createElement('option');
    loading.value = ''; loading.disabled = true; loading.selected = true; loading.textContent = 'Loading...';
    yearSelect.appendChild(loading);

    if (!diseaseKey || !datasetsMap[diseaseKey]) {
      yearSelect.innerHTML = '<option value="">No data</option>';
      updateActionButtons();
      return null;
    }

    showStatus('Loading dataset for ' + diseaseKey + '...', 'ok', 2000);
    const result = await fetchRowsFromCandidates(datasetsMap[diseaseKey]);
    if (!result) {
      yearSelect.innerHTML = '<option value="">No data</option>';
      showStatus('No data file found for ' + diseaseKey + '.', 'warn', 5000);
      updateActionButtons();
      return null;
    }

    const rows = result.rows;
    console.debug('rows loaded from', result.source, rows.length, 'rows');
    // extract years robustly
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
          if (!Number.isNaN(num) && num > 1900 && num < 2100) { val = num; break; }
        }
      }
      if (val == null) continue;
      const num = Number(val);
      if (!Number.isNaN(num)) yearSet.add(num);
    }

    const years = Array.from(yearSet).sort((a,b)=>a-b);
    yearSelect.innerHTML = '';
    if (!years.length) {
      yearSelect.innerHTML = '<option value="">No data</option>';
      showStatus('Dataset loaded but no Year column found.', 'warn', 6000);
      updateActionButtons();
      return null;
    }

    // insert a friendly placeholder and the years
    const ph = document.createElement('option');
    ph.value=''; ph.disabled=true; ph.selected=true; ph.textContent='Select year';
    yearSelect.appendChild(ph);
    years.forEach(y => {
      const o = document.createElement('option'); o.value = String(y); o.textContent = String(y);
      yearSelect.appendChild(o);
    });

    // Auto-select behavior:
    // If there's at least one valid year, auto-select the first (so buttons become enabled).
    // This reduces friction — user can still change it.
    const first = years[0];
    if (first) {
      yearSelect.value = String(first);
      showStatus('Auto-selected year ' + first + ' for ' + diseaseKey + '.', 'ok', 2000);
    }

    updateActionButtons();
    return years;
  }

  // initial load
  (async () => {
    try { await ensureXLSX().catch(()=>{}); } catch(e){console.warn(e);}
    if (diseaseSelect && diseaseSelect.value && diseaseSelect.value !== '') {
      await populateYearsForDisease(diseaseSelect.value);
    } else {
      // keep initial placeholder state
      if (yearSelect && yearSelect.options.length === 0) {
        yearSelect.innerHTML = '<option value="" disabled selected>Select year</option>';
      }
      updateActionButtons();
    }
  })();

  if (diseaseSelect) diseaseSelect.addEventListener('change', async () => {
    // when disease changes, populate years and auto-select if available
    await populateYearsForDisease(diseaseSelect.value).catch(err => {
      console.warn('populateYearsForDisease failed:', err);
      showStatus('Failed to load years for ' + diseaseSelect.value, 'error', 5000);
    });
  });

  if (viewMapBtn) {
    viewMapBtn.addEventListener('click', () => {
      const d = diseaseSelect?.value || '';
      const y = yearSelect?.value || '';
      if (!d || !y) return alert('Choose disease and year');
      window.location.href = `map.html?disease=${encodeURIComponent(d)}&year=${encodeURIComponent(y)}`;
    });
  }
  if (openStateBtn) {
    openStateBtn.addEventListener('click', () => {
      const d = diseaseSelect?.value || '';
      const y = yearSelect?.value || '';
      if (!d || !y) return alert('Choose disease and year');
      window.location.href = `state.html?state=California&disease=${encodeURIComponent(d)}&year=${encodeURIComponent(y)}`;
    });
  }
  if (heroOpenMap) {
    heroOpenMap.addEventListener('click', () => {
      const d = diseaseSelect?.value || '';
      const y = yearSelect?.value || '';
      if (d && y) {
        window.location.href = `map.html?disease=${encodeURIComponent(d)}&year=${encodeURIComponent(y)}`;
      } else {
        window.location.href = 'map.html';
      }
    });
  }

  function isYearValid(val) {
    if (!val) return false;
    const s = String(val).trim().toLowerCase();
    if (['','no data','loading...','select year'].includes(s)) return false;
    return !Number.isNaN(Number(val));
  }
  function isDiseaseValid(val) {
    if (!val) return false;
    const s = String(val).trim().toLowerCase();
    return s !== '' && s !== 'select disease';
  }

  function updateActionButtons() {
    try {
      const d = diseaseSelect?.value || '';
      const y = yearSelect?.value || '';
      const enabled = isDiseaseValid(d) && isYearValid(y);
      if (viewMapBtn) {
        viewMapBtn.disabled = !enabled;
        viewMapBtn.classList.toggle('disabled', !enabled);
        viewMapBtn.setAttribute('aria-disabled', String(!enabled));
      }
      if (openStateBtn) {
        openStateBtn.disabled = !enabled;
        openStateBtn.classList.toggle('disabled', !enabled);
        openStateBtn.setAttribute('aria-disabled', String(!enabled));
      }
      console.debug('updateActionButtons', { disease: d, year: y, enabled });
    } catch (err) {
      console.error('updateActionButtons error', err);
    }
  }

  // wire handlers and observers
  updateActionButtons();
  if (yearSelect) yearSelect.addEventListener('change', updateActionButtons);
  if (yearSelect && window.MutationObserver) {
    const mo = new MutationObserver(() => { setTimeout(updateActionButtons, 30); });
    mo.observe(yearSelect, { childList:true, subtree:true });
  }

})();

