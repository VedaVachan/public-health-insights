/* map.js - improved, robust, and user-friendly
   - Adds showAppStatus helper and robust loading/parsing
   - Keeps existing UI flow: year dropdown, draw map, charts, heatmap fallback
*/

const params = new URLSearchParams(window.location.search);
let diseaseKey = params.get('disease') || sessionStorage.getItem('lastDisease') || 'HIV';
let selectedYear = params.get('year') || sessionStorage.getItem('lastYear') || (new Date()).getFullYear() - 1;

// mapping disease key -> filename(s) (prefer JSON if present)
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

// DOM elements (may or may not exist depending on page)
const dsSelectHeader = document.getElementById('dsSelectHeader');
const yearSelectHeader = document.getElementById('yearSelectHeader');
const loadHeader = document.getElementById('loadHeader');
const downloadCSVHeader = document.getElementById('downloadCSVHeader');
const themeToggleHeader = document.getElementById('themeToggleHeader');

if (dsSelectHeader) dsSelectHeader.value = diseaseKey;

// theme persist
const setTheme = (t) => {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  if (themeToggleHeader) themeToggleHeader.textContent = t === 'dark' ? '☀️' : '🌙';
};
setTheme(localStorage.getItem('theme') || 'light');
if (themeToggleHeader) themeToggleHeader.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark') );

// ---------- Status helper ----------
function showAppStatus(message, type = 'warn', autoHideMs = 0) {
  const el = document.getElementById('app-status');
  if (!el) {
    console.info('[status]', message);
    return;
  }
  el.textContent = message;
  el.className = ''; // reset
  el.style.display = 'block';
  if (type === 'error') el.classList.add('error');
  else if (type === 'ok') el.classList.add('ok');
  else el.classList.add('warn');

  if (autoHideMs && autoHideMs > 0) {
    setTimeout(() => { el.style.display = 'none'; }, autoHideMs);
  }
}

// ---------- Utilities ----------
function isJSONFile(name) { const s = String(name||'').toLowerCase(); return s.endsWith('.json') || s.endsWith('.csv'); }

function csvLineToCols(line) {
  // split CSV line supporting quoted fields with commas
  // regex splits on commas not inside double quotes
  const re = /,(?=(?:[^"]*"[^"]*")*[^"]*$)/;
  const cols = line.split(re).map(c => {
    let v = c.trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/""/g, '"');
    return v;
  });
  return cols;
}

// Tiny CSV->rows parser (handles quoted commas minimally)
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = csvLineToCols(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = csvLineToCols(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cols[j] !== undefined ? cols[j] : null;
    rows.push(row);
  }
  return rows;
}

// ---------- pick filename (prefer .json if available) ----------
async function pickFilenameForKey(key) {
  const base = datasetsMap[key];
  if (!base) throw new Error('No dataset mapping for ' + key);
  const jsonCandidate = base.replace(/\.xlsx$/i, '.json');

  try {
    // Use HEAD to detect quickly
    const r = await fetch(jsonCandidate, { method: 'HEAD' });
    if (r.ok) return jsonCandidate;
  } catch (e) {
    // ignore - candidate likely not present
  }
  // fallback to the base (likely .xlsx)
  return base;
}

// ---------- fetch rows from file (json/csv/xlsx) ----------
async function fetchRowsFromFile(name) {
  if (!name) throw new Error('No filename provided');
  try {
    if (isJSONFile(name)) {
      const r = await fetch(name);
      if (!r.ok) throw new Error(`Failed to fetch ${name}: ${r.status}`);
      if (name.toLowerCase().endsWith('.json')) return await r.json();
      // csv
      const txt = await r.text();
      return parseCSV(txt);
    } else {
      // XLSX
      const r = await fetch(name);
      if (!r.ok) throw new Error(`Failed to fetch ${name}: ${r.status}`);
      const buf = await r.arrayBuffer();
      // ensure XLSX library is available
      if (typeof XLSX === 'undefined') {
        // attempt to load library synchronously by injecting script (best-effort)
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        }).catch(err => {
          console.warn('Failed to load XLSX library from CDN', err);
        });
      }
      if (typeof XLSX === 'undefined') throw new Error('XLSX library not available to parse .xlsx');

      // read workbook from array buffer
      const data = new Uint8Array(buf);
      let wb;
      try {
        wb = XLSX.read(data, { type: 'array' });
      } catch (err) {
        // fallback try: read as binary string
        try {
          const bin = new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), '');
          wb = XLSX.read(bin, { type: 'binary' });
        } catch (err2) {
          throw new Error('XLSX.parse failed: ' + (err2 || err).message);
        }
      }
      if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) return [];
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
      return rows;
    }
  } catch (err) {
    throw err;
  }
}

// ---------- UI references used by charts/map ----------
const totalCasesEl = document.getElementById('totalCases');
const selectedInfoEl = document.getElementById('selectedInfo');
const legendWrap = document.getElementById('legendWrap');
const matrixCanvas = document.getElementById('matrixHeatmap');

// chart globals
let barChart = null, lineChart = null, histChart = null;
let matrixChartRef = null, leafletMap = null;
let geoCache = null;

// ---------- Load geojson
async function loadGeo() {
  if (geoCache) return geoCache;
  try {
    const r = await fetch('usa_states.geojson');
    if (!r.ok) throw new Error('Failed to load usa_states.geojson');
    geoCache = await r.json();
    return geoCache;
  } catch (err) {
    throw err;
  }
}

// ---------- Color ramp (simple)
function colorRamp(v, min, max) {
  if (v == null || isNaN(v)) return '#efefef';
  const ratio = (v - min) / (max - min || 1);
  const r = Math.round(220 * ratio + 30 * (1 - ratio));
  const g = Math.round(230 - 180 * ratio);
  const b = Math.round(80 + 120 * (1 - ratio));
  return `rgb(${r},${g},${b})`;
}

// ---------- Populate year select (header) ----------
async function populateYearSelectForDisease(key) {
  try {
    if (!yearSelectHeader) return;
    yearSelectHeader.innerHTML = '';
    const fname = await pickFilenameForKey(key);
    showAppStatus('Detecting available years for ' + key + ' ...', 'warn', 0);
    const rows = await fetchRowsFromFile(fname);
    const years = Array.from(new Set((rows || []).map(r => {
      const v = r.Year || r.year || r.YearReported || r.yearReported || null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }).filter(Boolean))).sort((a, b) => a - b);

    if (!years.length) {
      yearSelectHeader.innerHTML = '<option value="">No years</option>';
      showAppStatus('No year data available for ' + key, 'warn', 4000);
      return;
    }

    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      yearSelectHeader.appendChild(opt);
    });

    // set selectedYear if present and valid
    if (selectedYear && years.includes(Number(selectedYear))) yearSelectHeader.value = selectedYear;
    else yearSelectHeader.value = String(years[years.length - 1]);

    showAppStatus('Years loaded for ' + key, 'ok', 1500);
  } catch (err) {
    console.warn('populateYearSelect error', err);
    if (yearSelectHeader) yearSelectHeader.innerHTML = '<option value="">No years</option>';
    showAppStatus('Failed to load year list: ' + (err.message || err), 'error', 5000);
  }
}

// ---------- Map drawing ----------
function restoreMapState() {
  try { return JSON.parse(sessionStorage.getItem('mapState') || 'null'); } catch (e) { return null; }
}
function saveMapState() {
  try {
    if (!leafletMap) return;
    const c = leafletMap.getCenter();
    sessionStorage.setItem('mapState', JSON.stringify({ center: [c.lat, c.lng], zoom: leafletMap.getZoom(), disease: diseaseKey, year: selectedYear }));
  } catch (e) { /* swallow */ }
}

async function drawChoropleth(geo, stateValues, minV, maxV) {
  if (!leafletMap) {
    leafletMap = L.map('map', { scrollWheelZoom: false }).setView([37.8, -96], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap);
  } else {
    // remove GeoJSON feature layers (keep tile layers)
    leafletMap.eachLayer(layer => {
      if (layer && layer.feature && layer.feature.type === 'Feature') leafletMap.removeLayer(layer);
    });
  }

  function style(f) {
    const v = stateValues[f.properties.NAME];
    return { fillColor: colorRamp(v, minV, maxV), weight: 1, color: '#fff', fillOpacity: 0.92 };
  }
  function onEach(f, layer) {
    const name = f.properties.NAME;
    const v = stateValues[name] != null ? stateValues[name] : 'No data';
    layer.bindTooltip(`<strong>${name}</strong><br/>Cases: ${typeof v === 'number' ? v.toLocaleString() : v}`, { direction: 'auto' });
    layer.on('click', () => {
      saveMapState();
      window.location.href = `state.html?state=${encodeURIComponent(name)}&disease=${encodeURIComponent(diseaseKey)}&year=${encodeURIComponent(selectedYear)}`;
    });
  }

  L.geoJson(geo, { style, onEachFeature: onEach }).addTo(leafletMap);

  const st = restoreMapState();
  if (st && st.disease === diseaseKey && String(st.year) === String(selectedYear)) {
    try { leafletMap.setView(st.center, st.zoom); } catch (e) { /* ignore */ }
  }
}

// ---------- helper: safe destroy chart ----------
function safeDestroy(c) { try { if (c && typeof c.destroy === 'function') c.destroy(); } catch (e) { /* ignore */ } }

// ---------- charts ----------
function formatTick(v) {
  if (v === null || v === undefined) return '';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return '' + v;
}
function roundUpNice(n) {
  if (!isFinite(n)) return n;
  if (n <= 10) return Math.ceil(n);
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  return Math.ceil(n / p) * p;
}

function niceSuggestedMax(arr) {
  const maxVal = Math.max(...(arr||[0]));
  if (!isFinite(maxVal) || maxVal <= 0) return 10;
  const raw = maxVal * 1.15;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = Math.ceil(raw / p);
  return nice * p;
}

function drawLine(rows) {
  if (!rows || !rows.length) return;
  const yearAgg = {};
  rows.forEach(r => { const y = Number(r.Year || r.year); if (!y) return; yearAgg[y] = (yearAgg[y] || 0) + (Number(r.Cases || r.cases) || 0); });
  const yrs = Object.keys(yearAgg).map(Number).sort((a, b) => a - b);
  const vals = yrs.map(y => yearAgg[y]);
  safeDestroy(lineChart);
  const ctxEl = document.getElementById('casesLine');
  if (!ctxEl) return;
  const ctx = ctxEl.getContext('2d');
  lineChart = new Chart(ctx, {
    type: 'line',
    data: { labels: yrs, datasets: [{ label: 'USA total', data: vals, borderColor: '#0f6ef6', backgroundColor: 'rgba(15,110,246,0.08)', fill: true, tension: 0.3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: it => `${it.raw.toLocaleString()} cases` } } }, scales: { y: { beginAtZero: true, suggestedMax: roundUpNice(Math.max(...vals || [0]) * 1.08), ticks: { callback: formatTick } } } }
  });
}

function drawBar(stateValues, year, minV, maxV) {
  const ctxEl = document.getElementById('casesBar');
  if (!ctxEl) return;
  const ctx = ctxEl.getContext('2d');
  const labels = Object.keys(stateValues);
  const data = Object.values(stateValues);
  const bg = data.map(v => colorRamp(v, minV, maxV));
  safeDestroy(barChart);
  const suggestedMax = niceSuggestedMax(data);
  barChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: `Cases (${year})`, data, backgroundColor: bg, maxBarThickness: 44, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items && items.length ? items[0].label : '',
            label: (ctx) => {
              const idx = ctx.dataIndex;
              const lab = labels[idx];
              const val = ctx.raw;
              return `${lab} — ${typeof val === 'number' ? val.toLocaleString() : val} cases`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 14 }, grid: { display: false } },
        y: { beginAtZero: true, suggestedMax: suggestedMax, ticks: { callback: val => formatTick(val) } }
      }
    }
  });
}

function drawHist(values) {
  const ctxEl = document.getElementById('casesHist');
  if (!ctxEl) return;
  const ctx = ctxEl.getContext('2d');

  const n = values.length || 1;
  const iqr = (() => {
    if (n < 4) return 0;
    const s = values.slice().sort((a, b) => a - b);
    const q1 = s[Math.floor((s.length - 1) * 0.25)];
    const q3 = s[Math.floor((s.length - 1) * 0.75)];
    return (q3 - q1) || 0;
  })();
  let bins;
  if (iqr > 0) {
    const h = 2 * iqr / Math.cbrt(n);
    const range = Math.max(...values) - Math.min(...values) || 1;
    bins = Math.max(4, Math.min(12, Math.round(range / h) || Math.round(Math.sqrt(n))));
  } else {
    bins = Math.max(4, Math.min(12, Math.round(Math.sqrt(n))));
  }

  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const width = (maxV - minV) / (bins || 1) || 1;
  const counts = new Array(bins).fill(0);
  values.forEach(v => {
    const idx = Math.min(bins - 1, Math.floor((v - minV) / width));
    counts[idx] += 1;
  });
  const labels = new Array(bins).fill(0).map((_, i) => {
    const a = Math.round(minV + i * width);
    const b = Math.round(minV + (i + 1) * width);
    return `${a}–${b}`;
  });

  safeDestroy(histChart);
  histChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Count', data: counts, backgroundColor: 'rgba(99,102,241,0.9)', maxBarThickness: 40 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items && items.length ? items[0].label : '',
            label: (ctx) => `${ctx.raw} states`
          }
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => v } },
        x: { ticks: { autoSkip: true, maxRotation: 30 } }
      }
    }
  });
}

// ---------- Matrix heatmap with fallback ----------
async function drawMatrixHeatmap(pivot, years, states, minV, maxV) {
  function syncWrapperHeight() {
    const mapEl = document.getElementById('map');
    const wrap = document.getElementById('heatmapWrapper');
    if (!wrap || !mapEl) return;
    const h = Math.max(240, mapEl.getBoundingClientRect().height || 420);
    wrap.style.height = (h) + 'px';
    const canvas = document.getElementById('matrixHeatmap');
    if (canvas) {
      canvas.width = canvas.clientWidth;
      canvas.style.height = wrap.style.height;
      canvas.height = Math.round(parseFloat(wrap.style.height));
    }
  }

  syncWrapperHeight();
  window.addEventListener('resize', syncWrapperHeight);

  try {
    const hasMatrix = window.Chart && (Chart.registry && typeof Chart.registry.getController === 'function' ? !!Chart.registry.getController('matrix') : !!Chart.controllers && !!Chart.controllers.matrix);
    if (!hasMatrix) throw new Error('matrix plugin not loaded');

    const xLabels = years.map(String);
    const yLabels = states.slice();
    const data = [];
    years.forEach((yr, xi) => states.forEach((st, yi) => data.push({ x: xi, y: yi, v: pivot[st][yr] || 0 })));

    if (matrixChartRef) safeDestroy(matrixChartRef);

    const canvasEl = document.getElementById('matrixHeatmap');
    if (!canvasEl) throw new Error('matrixHeatmap canvas not found');

    syncWrapperHeight();
    const ctx = canvasEl.getContext('2d');

    matrixChartRef = new Chart(ctx, {
      type: 'matrix',
      data: {
        datasets: [{
          label: 'State×Year',
          data,
          width: ({ chart }) => Math.max(6, (chart.chartArea.width / xLabels.length) - 1),
          height: ({ chart }) => Math.max(6, (chart.chartArea.height / yLabels.length) - 1),
          backgroundColor: ctx => colorRamp(ctx.dataset.data[ctx.dataIndex].v, minV, maxV)
        }]
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              title: items => {
                const it = items[0]; const dp = it.dataset.data[it.dataIndex]; return `${yLabels[dp.y]} — ${xLabels[dp.x]}`;
              },
              label: items => `Cases: ${items.raw ? items.raw.v : items.dataset.data[items.dataIndex].v}`
            }
          }
        },
        scales: {
          x: { type: 'category', labels: xLabels, position: 'bottom', grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 12 } },
          y: { type: 'category', labels: yLabels, grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 40 } }
        },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const el = elements[0];
          const dp = matrixChartRef.data.datasets[el.datasetIndex].data[el.index];
          const year = xLabels[dp.x], state = yLabels[dp.y];
          try { const c = leafletMap.getCenter(); sessionStorage.setItem('mapState', JSON.stringify({ center: [c.lat, c.lng], zoom: leafletMap.getZoom(), disease: diseaseKey, year: selectedYear })); } catch (e) {}
          window.location.href = `state.html?state=${encodeURIComponent(state)}&disease=${encodeURIComponent(diseaseKey)}&year=${year}`;
        }
      }
    });

    return;
  } catch (err) {
    console.warn('matrix plugin missing or error — fallback table:', err);
    const wrapper = document.getElementById('heatmapWrapper');
    const canvas = document.getElementById('matrixHeatmap');
    if (canvas) canvas.style.display = 'none';

    if (!wrapper) return;

    const yearsToShow = years.slice();
    const statesToShow = states.slice();

    let html = '<div class="heatmap-fallback" style="padding:10px; background:transparent;">';
    html += '<div style="font-weight:700;margin-bottom:8px;">Heatmap (fallback)</div>';
    html += '<div style="overflow:auto; max-height:100%;">';
    html += '<table style="min-width:600px;">';
    html += '<thead><tr><th>State</th>';
    yearsToShow.forEach(y => html += `<th>${y}</th>`);
    html += '</tr></thead><tbody>';
    statesToShow.forEach(s => {
      html += `<tr><td style="font-weight:600; text-align:left;">${s}</td>`;
      yearsToShow.forEach(y => {
        const v = pivot[s] && pivot[s][y] ? pivot[s][y] : 0;
        const bg = colorRamp(v, minV, maxV);
        html += `<td style="background:${bg};">${v}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';

    let fb = wrapper.querySelector('.heatmap-fallback');
    if (fb) fb.outerHTML = html;
    else wrapper.insertAdjacentHTML('beforeend', html);

    syncWrapperHeight();

    // make fallback table rows clickable to go to state page
    const table = wrapper.querySelector('tbody');
    if (table) {
      table.querySelectorAll('tr').forEach((tr) => {
        tr.addEventListener('click', () => {
          const first = tr.querySelector('td');
          if (!first) return;
          const stateName = first.textContent.trim();
          try { const c = leafletMap.getCenter(); sessionStorage.setItem('mapState', JSON.stringify({ center: [c.lat, c.lng], zoom: leafletMap.getZoom(), disease: diseaseKey, year: selectedYear })); } catch (e) {}
          window.location.href = `state.html?state=${encodeURIComponent(stateName)}&disease=${encodeURIComponent(diseaseKey)}&year=${selectedYear}`;
        });
      });
    }

    return;
  }
}

// ---------- CSV export ----------
function exportVisibleCSV() {
  if (matrixChartRef && matrixChartRef.data && matrixChartRef.data.datasets && matrixChartRef.data.datasets[0]) {
    const xLabels = matrixChartRef.options.scales.x.labels;
    const yLabels = matrixChartRef.options.scales.y.labels;
    const data = matrixChartRef.data.datasets[0].data;
    const grid = {};
    data.forEach(d => { const yr = xLabels[d.x], st = yLabels[d.y]; grid[st] = grid[st] || {}; grid[st][yr] = d.v; });
    const header = ['State', ...xLabels]; const rows = [header.join(',')];
    yLabels.forEach(st => { const row = ['"' + st.replace(/"/g, '""') + '"']; xLabels.forEach(yr => row.push(String(grid[st] && grid[st][yr] ? grid[st][yr] : 0))); rows.push(row.join(',')); });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' }); const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'heatmap_export.csv'; a.click(); URL.revokeObjectURL(u); return;
  }
  const fbTable = document.querySelector('.heatmap-fallback table');
  if (fbTable) {
    const rows = []; fbTable.querySelectorAll('tr').forEach(tr => { const cols = Array.from(tr.querySelectorAll('th,td')).map(td => `"${td.textContent.replace(/"/g, '""')}"`); rows.push(cols.join(',')); });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' }); const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'heatmap_export.csv'; a.click(); URL.revokeObjectURL(u); return;
  }
  alert('No heatmap data to export');
}

// ---------- Main loader ----------
async function loadAll() {
  diseaseKey = dsSelectHeader ? dsSelectHeader.value : diseaseKey;
  selectedYear = yearSelectHeader ? yearSelectHeader.value : selectedYear;
  sessionStorage.setItem('lastDisease', diseaseKey);
  sessionStorage.setItem('lastYear', selectedYear);
  if (selectedInfoEl) selectedInfoEl.textContent = `Dataset: ${diseaseKey} · Year: ${selectedYear}`;
  if (totalCasesEl) totalCasesEl.textContent = 'Loading...';
  showAppStatus(`Loading ${diseaseKey} (${selectedYear}) ...`, 'warn');

  try {
    const fname = await pickFilenameForKey(diseaseKey);
    const rows = await fetchRowsFromFile(fname);
    if (!rows || !rows.length) throw new Error('No data rows found in ' + fname);

    // extract years & states robustly
    const years = Array.from(new Set(rows.map(r => {
      const v = r.Year || r.year || null; const n = Number(v); return Number.isFinite(n) ? n : null;
    }).filter(Boolean))).sort((a,b)=>a-b);

    const states = Array.from(new Set(rows.map(r => String(r.State || r.state || '').trim()).filter(Boolean))).sort();

    if (yearSelectHeader) {
      yearSelectHeader.innerHTML = '';
      years.forEach(y => {
        const o = document.createElement('option');
        o.value = y;
        o.textContent = y;
        yearSelectHeader.appendChild(o);
      });
    }

    if (years.includes(Number(selectedYear))) {
      if (yearSelectHeader) yearSelectHeader.value = selectedYear;
    } else {
      selectedYear = years[years.length - 1];
      if (yearSelectHeader) yearSelectHeader.value = selectedYear;
    }

    // pivot data by state × year
    const pivot = {}; states.forEach(s => pivot[s] = {});
    rows.forEach(r => {
      const s = String(r.State || r.state || '').trim();
      const y = Number(r.Year || r.year);
      const c = Number(r.Cases || r.cases) || 0;
      if (!s || !y) return;
      pivot[s][y] = (pivot[s][y] || 0) + c;
    });

    const stateValues = {}; states.forEach(s => stateValues[s] = pivot[s][selectedYear] || 0);
    const vals = Object.values(stateValues).map(v => Number(v) || 0);
    const minV = vals.length ? Math.min(...vals) : 0, maxV = vals.length ? Math.max(...vals) : 0;
    const total = vals.reduce((a,b)=>a+(Number(b)||0), 0);
    if (totalCasesEl) totalCasesEl.textContent = `Total USA Cases (${selectedYear}): ${total.toLocaleString()}`;

    // draw
    const geo = await loadGeo();
    await drawChoropleth(geo, stateValues, minV, maxV);
    drawBar(stateValues, selectedYear, minV, maxV);
    drawLine(rows);
    drawHist(vals);
    await drawMatrixHeatmap(pivot, years, states, minV, maxV);

    if (legendWrap) legendWrap.innerHTML = `<div class="note">Color scale from ${minV} → ${maxV}</div>`;
    showAppStatus('Data loaded successfully', 'ok', 2000);
  } catch (err) {
    console.error('loadAll error', err);
    if (totalCasesEl) totalCasesEl.textContent = 'Failed to load data';
    if (selectedInfoEl) selectedInfoEl.textContent = `Error: ${err.message || err}`;
    showAppStatus('Error loading data: ' + (err.message || err), 'error', 6000);
  }
}

// wire buttons
if (loadHeader) loadHeader.addEventListener('click', loadAll);
if (downloadCSVHeader) downloadCSVHeader.addEventListener('click', exportVisibleCSV);
if (dsSelectHeader) dsSelectHeader.addEventListener('change', () => populateYearSelectForDisease(dsSelectHeader.value));

// init
populateYearSelectForDisease(diseaseKey).then(() => {
  // set yearSelectHeader value if present
  if (yearSelectHeader && selectedYear) yearSelectHeader.value = selectedYear;
  loadAll();
}).catch(e => { console.warn('init populate fail', e); loadAll(); });





