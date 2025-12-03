/* state.js - final, robust version
   - robust Leaflet init (wait for container, fitBounds, invalidateSize)
   - scaled charts, tooltips, safe-destroy
   - prefers .json dataset if available
*/

const p = new URLSearchParams(window.location.search);
const stateParam = p.get('state');
const diseaseKey = p.get('disease');
const selectedYear = p.get('year');

if (!stateParam || !diseaseKey) {
  const titleEl = document.getElementById('stateTitle');
  if (titleEl) titleEl.textContent = 'Missing parameters';
  throw new Error('Missing parameters: state or disease');
}
document.getElementById('stateTitle').textContent = `${stateParam} — Detailed Report`;

/* dataset mapping */
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

/* helpers */
function formatTick(v){
  if (v === null || v === undefined) return '';
  if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
  if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(1).replace(/\.0$/,'') + 'k';
  return String(v);
}
function roundUpNice(n){
  if (!isFinite(n)) return n;
  if (n <= 10) return Math.ceil(n);
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  return Math.ceil(n / p) * p;
}
function niceSuggestedMaxForArr(arr){
  const maxVal = Math.max(...(arr||[0]));
  if (!isFinite(maxVal) || maxVal <= 0) return 10;
  const raw = maxVal * 1.15;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  return Math.ceil(raw / p) * p;
}
function safeDestroy(chartVar) {
  try { if (chartVar && typeof chartVar.destroy === 'function') chartVar.destroy(); } catch(e) { console.warn('safeDestroy failed', e); }
}

/* prefer json candidate if present */
async function pickFilenameForKey(key){
  const base = datasetsMap[key];
  if (!base) throw new Error('No dataset mapping for ' + key);
  const jsonCandidate = base.replace(/\.xlsx$/i, '.json');
  try {
    const r = await fetch(jsonCandidate, { method: 'HEAD' });
    if (r.ok) return jsonCandidate;
  } catch(e){}
  return base;
}

/* fetch rows: supports json, csv, xlsx */
async function fetchRows(name){
  if (!name) throw new Error('No filename');
  const n = name.toLowerCase();
  if (n.endsWith('.json')) {
    const r = await fetch(name);
    if (!r.ok) throw new Error(`Failed to fetch ${name} (${r.status})`);
    return await r.json();
  }
  if (n.endsWith('.csv')) {
    const txt = await (await fetch(name)).text();
    const lines = txt.trim().split('\n').filter(Boolean);
    const headers = lines[0].split(',').map(h=>h.trim());
    return lines.slice(1).map(l => {
      const cols = l.split(',');
      const obj = {};
      headers.forEach((h,i)=> obj[h] = cols[i]);
      return obj;
    });
  }
  // xlsx using SheetJS
  const buf = await (await fetch(name)).arrayBuffer();
  const wb = XLSX.read(buf);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet);
}

/* robust: wait for an element to exist */
function waitForElement(selector, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const timer = setTimeout(() => { observer && observer.disconnect(); reject(new Error('Element not found: ' + selector)); }, timeout);
    const observer = new MutationObserver(() => {
      const e = document.querySelector(selector);
      if (e) { clearTimeout(timer); observer.disconnect(); resolve(e); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/* Leaflet map init & highlight */
async function initStateMapAndHighlight(geoJson, stateName) {
  try {
    const container = await waitForElement('#stateMap', 3000);
    container.innerHTML = '';
    const map = L.map(container, { scrollWheelZoom:false }).setView([37.8, -96], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    let matchedFeature = null;
    L.geoJson(geoJson, {
      style: feature => {
        const name = (feature.properties.NAME || feature.properties.name || feature.properties.NAME_1 || '').toString().trim().toLowerCase();
        const isTarget = name === stateName.toString().trim().toLowerCase();
        if (isTarget) matchedFeature = feature;
        return { fillColor: isTarget ? '#ff6b6b' : '#d1d5db', weight: 1, color: '#fff', fillOpacity: isTarget ? 0.85 : 0.5 };
      },
      onEachFeature: (feature, layer) => {
        const nm = feature.properties.NAME || feature.properties.name || 'Unknown';
        layer.bindPopup(`<b>${nm}</b>`);
      }
    }).addTo(map);

    if (matchedFeature) {
      const tmp = L.geoJson(matchedFeature);
      const bounds = tmp.getBounds();
      if (bounds && bounds.isValid && bounds.isValid()) map.fitBounds(bounds.pad(0.12));
    } else console.warn('[state.js] state not found in geojson:', stateName);

    map.invalidateSize();
    setTimeout(() => map.invalidateSize(), 250);
    return map;
  } catch (err) {
    console.error('[state.js] initStateMapAndHighlight error:', err);
    const wrap = document.getElementById('stateMap');
    if (wrap) wrap.innerHTML = `<div style="padding:12px;color:var(--muted)">State map unavailable: ${err.message}</div>`;
    return null;
  }
}

/* main loader */
async function loadState() {
  try {
    const fname = await pickFilenameForKey(diseaseKey);
    console.log('[state.js] loading dataset:', fname);
    const rows = await fetchRows(fname);

    // filter rows for the requested state (case-insensitive)
    let stateRows = rows.filter(r => String(r.State || r.state || '').trim().toLowerCase() === String(stateParam).trim().toLowerCase());
    if (!stateRows.length) {
      stateRows = rows.filter(r => String(r.State || r.state || '').toLowerCase().includes(String(stateParam).toLowerCase()));
    }
    if (!stateRows.length) {
      const rawTable = document.getElementById('rawTable');
      if (rawTable) rawTable.innerHTML = '<tr><td>No data for state</td></tr>';
      return;
    }

    // render raw table
    const cols = Object.keys(stateRows[0]);
    const th = '<tr>' + cols.map(c => `<th style="padding:8px;text-align:left">${c}</th>`).join('') + '</tr>';
    const body = stateRows.map(r => '<tr>' + cols.map(c => `<td style="padding:8px">${r[c] ?? ''}</td>`).join('') + '</tr>').join('');
    const rawTable = document.getElementById('rawTable');
    if (rawTable) rawTable.innerHTML = th + body;

    // timeseries
    const ts = stateRows.map(r => ({ year: Number(r.Year || r.year), cases: Number(r.Cases || r.cases) || 0 }))
                        .filter(x => !isNaN(x.year))
                        .sort((a,b) => a.year - b.year);
    const years = ts.map(t => t.year);
    const cases = ts.map(t => t.cases);

    // map + highlight
    let geoJson;
    try { geoJson = await (await fetch('usa_states.geojson')).json(); }
    catch(e){ console.warn('[state.js] could not load usa_states.geojson', e); }
    if (geoJson) await initStateMapAndHighlight(geoJson, stateParam);

    // summary
    const latest = ts.length ? ts[ts.length - 1] : null;
    const summaryEl = document.getElementById('stateSummary');
    if (summaryEl) summaryEl.textContent = latest ? `Latest (${latest.year}): ${latest.cases.toLocaleString()} cases` : '';

    // LINE chart
    safeDestroy(window._lineChart);
    const lineEl = document.getElementById('lineChart');
    if (lineEl) {
      window._lineChart = new Chart(lineEl.getContext('2d'), {
        type: 'line',
        data: { labels: years, datasets: [{ label: 'Cases', data: cases, borderColor: '#0f6ef6', backgroundColor: 'rgba(15,110,246,0.08)', fill:true, tension:0.25 }]},
        options: {
          responsive:true, maintainAspectRatio:false,
          plugins:{ tooltip:{ callbacks:{ label: ctx => `${ctx.raw.toLocaleString()} cases` } } },
          scales: { y: { beginAtZero:true, suggestedMax: roundUpNice(Math.max(...cases || [0]) * 1.08), ticks: { callback: formatTick } } }
        }
      });
    }

    // SCATTER chart
    safeDestroy(window._scatterChart);
    const scEl = document.getElementById('scatterChart');
    if (scEl) {
      window._scatterChart = new Chart(scEl.getContext('2d'), {
        type:'scatter',
        data:{ datasets:[ { label:'Cases', data: years.map((y,i)=>({ x:y, y:cases[i] })), backgroundColor:'#06b6d4', pointRadius:6 } ]},
        options:{ responsive:true, maintainAspectRatio:false, plugins:{ tooltip:{ callbacks:{ label: it => `${it.raw.y.toLocaleString()} cases (${it.raw.x})` } } }, scales:{ x:{ title:{ display:true, text:'Year' } }, y:{ beginAtZero:true, ticks:{ callback: formatTick } } } }
      });
    }

    // BAR chart
    safeDestroy(window._stateBarChart);
    const barEl = document.getElementById('barChart');
    if (barEl) {
      const barSuggested = niceSuggestedMaxForArr(cases);
      window._stateBarChart = new Chart(barEl.getContext('2d'), {
        type:'bar',
        data:{ labels: years, datasets:[{ label:'Yearly Cases', data: cases, backgroundColor:'rgba(16,185,129,0.9)', maxBarThickness:48, borderWidth:1, borderColor:'rgba(255,255,255,0.06)'}] },
        options:{
          responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ title: items => items && items.length ? `Year ${items[0].label}` : '', label: ctx => `${ctx.raw.toLocaleString()} cases` } } },
          scales:{ y:{ beginAtZero:true, suggestedMax: barSuggested, ticks:{ callback: formatTick } }, x:{ ticks:{ autoSkip:true, maxRotation:30 } } }
        }
      });
    }

    // HISTOGRAM
    safeDestroy(window._stateHistChart);
    const histEl = document.getElementById('histChart');
    if (histEl) {
      (function(){
        const vals = cases.slice();
        const n = vals.length || 1;
        const sorted = vals.slice().sort((a,b)=>a-b);
        const q1 = sorted[Math.floor((sorted.length-1)*0.25)] || 0;
        const q3 = sorted[Math.floor((sorted.length-1)*0.75)] || 0;
        const iqr = Math.max(0, q3 - q1);
        let bins;
        if (iqr > 0) {
          const h = 2 * iqr / Math.cbrt(n);
          const range = Math.max(...vals) - Math.min(...vals) || 1;
          bins = Math.max(4, Math.min(12, Math.round(range / h) || Math.round(Math.sqrt(n))));
        } else {
          bins = Math.max(4, Math.min(12, Math.round(Math.sqrt(n))));
        }
        const minV = vals.length ? Math.min(...vals) : 0;
        const maxV = vals.length ? Math.max(...vals) : 0;
        const width = (maxV - minV) / (bins || 1) || 1;
        const counts = new Array(bins).fill(0);
        vals.forEach(v => { const idx = Math.min(bins-1, Math.floor((v-minV)/width)); counts[idx] += 1; });
        const labels = new Array(bins).fill(0).map((_,i)=> `${Math.round(minV + i*width)}–${Math.round(minV + (i+1)*width)}`);
        window._stateHistChart = new Chart(histEl.getContext('2d'), {
          type:'bar',
          data:{ labels, datasets:[{ label:'Count', data:counts, backgroundColor:'rgba(99,102,241,0.9)', maxBarThickness:40 }]},
          options:{ responsive:true, maintainAspectRatio:false, plugins:{ tooltip:{ callbacks:{ title: it => it && it.length ? it[0].label : '', label: ctx => `${ctx.raw} states` } } }, scales:{ y:{ beginAtZero:true }, x:{ ticks:{ autoSkip:true, maxRotation:30 } } } }
        });
      })();
    }

  } catch (err) {
    console.error('[state.js] loadState error:', err);
    const rawTable = document.getElementById('rawTable');
    if (rawTable) rawTable.innerHTML = `<tr><td>Error loading state data: ${err.message}</td></tr>`;
    const mapWrap = document.getElementById('stateMap');
    if (mapWrap) mapWrap.innerHTML = `<div style="padding:12px;color:var(--muted)">State map unavailable: ${err.message}</div>`;
  }
}

/* theme toggle */
const tbtn = document.getElementById('themeToggleState');
const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
if (tbtn) {
  tbtn.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  tbtn.addEventListener('click', () => {
    const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
    tbtn.textContent = t === 'dark' ? '☀️' : '🌙';
  });
}

/* start loading */
loadState();



