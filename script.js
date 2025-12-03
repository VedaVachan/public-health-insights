// script.js - index page behavior (keeps existing IDs & functions)
(function(){
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
  'HIV': 'HIV_data.xlsx',
  'TB': 'TB.xlsx',
  'Diabetes': 'Diabetes.xlsx',
  'Hepatitis-B': 'HepatitisB.xlsx',
  'Hepatitis-A': 'HepatitisA.xlsx',
  'Hepatitis-C': 'HepatitisC.xlsx',
  'Gonorrhea':'Gonorrhea.xlsx',
  'Chlamydia':'Chlamydia.xlsx',
  'syphilis':'syphilis.xlsx',
};

  const diseaseSelect = document.getElementById('diseaseSelect');
  const yearSelect = document.getElementById('yearInput');
  async function ensureXLSX() {
    if (typeof XLSX !== 'undefined') return;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  async function populateYearsForDisease(diseaseKey) {
    if (!diseaseKey || !datasetsMap[diseaseKey]) return;
    const base = datasetsMap[diseaseKey];
    // try .json then .xlsx
    const candidates = [ base.replace(/\.xlsx$/i, '.json'), base ];
    let rows = null;
    for (const c of candidates) {
      try {
        const resp = await fetch(c);
        if (!resp.ok) continue;
        if (c.toLowerCase().endsWith('.json')) {
          rows = await resp.json();
        } else {
          const buf = await resp.arrayBuffer();
          await ensureXLSX();
          const wb = XLSX.read(buf);
          const sheet = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(sheet);
        }
        if (Array.isArray(rows) && rows.length) break;
      } catch (e) {
        console.warn('populateYearsForDisease fetch failed for', c, e);
      }
    }
    yearSelect.innerHTML = '';
    if (!rows || !rows.length) {
      const opt = document.createElement('option'); opt.textContent = 'No data'; opt.value=''; yearSelect.appendChild(opt); return;
    }
    const years = [...new Set(rows.map(r => Number(r.Year)).filter(Boolean))].sort((a,b)=>a-b);
    years.forEach(y => { const opt = document.createElement('option'); opt.value = y; opt.textContent = y; yearSelect.appendChild(opt); });
  }

  (async () => {
    try { await ensureXLSX(); } catch(e){ console.warn('XLSX CDN failed', e); }
    if (diseaseSelect) await populateYearsForDisease(diseaseSelect.value);
  })();

  if (diseaseSelect) diseaseSelect.addEventListener('change', () => populateYearsForDisease(diseaseSelect.value));

  const viewMapBtn = document.getElementById('viewMap');
  if (viewMapBtn) viewMapBtn.addEventListener('click', () => {
    const d = diseaseSelect.value, y = yearSelect.value;
    if (!d || !y) return alert('Choose disease and year');
    window.location.href = `map.html?disease=${encodeURIComponent(d)}&year=${encodeURIComponent(y)}`;
  });

  const openStateBtn = document.getElementById('openState');
  if (openStateBtn) openStateBtn.addEventListener('click', () => {
    const d = diseaseSelect.value, y = yearSelect.value;
    if (!d || !y) return alert('Choose disease and year');
    window.location.href = `state.html?state=California&disease=${encodeURIComponent(d)}&year=${encodeURIComponent(y)}`;
  });

  // hero button
  const heroOpenMap = document.getElementById('heroOpenMap');
  if (heroOpenMap) heroOpenMap.addEventListener('click', () => {
    const d = diseaseSelect.value, y = yearSelect.value;
    if (d && y) window.location.href = `map.html?disease=${encodeURIComponent(d)}&year=${encodeURIComponent(y)}`;
    else window.location.href = 'map.html';
  });
})();
