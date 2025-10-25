// client/app.js
// Bulk Combo Checker — safe test app
// NOTE: Only point this at servers you own or have express permission to test.

(() => {
  // Elements
  const endpointInput = document.getElementById('endpoint');
  const comboInput = document.getElementById('comboInput');
  const fileInput = document.getElementById('fileInput');
  const loadSampleBtn = document.getElementById('loadSample');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const concurrencyInput = document.getElementById('concurrency');
  const delayInput = document.getElementById('delay');
  const retriesInput = document.getElementById('retries');

  const totalEl = document.getElementById('total');
  const checkedEl = document.getElementById('checked');
  const hitsEl = document.getElementById('hits');
  const failsEl = document.getElementById('fails');
  const errorsEl = document.getElementById('errors');
  const progressFill = document.getElementById('progressFill');

  const resultsTableBody = document.querySelector('#resultsTable tbody');
  const exportCsvBtn = document.getElementById('exportCsv');
  const clearResultsBtn = document.getElementById('clearResults');

  // State
  let combos = []; // { raw, user, pass }
  let results = []; // {combo, status, detail}
  let stopRequested = false;

  // Helpers
  function parseCombosFromText(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = [];
    for (const l of lines) {
      // Accept formats: user:pass or user|pass or user,pass
      const sep = l.includes(':') ? ':' : (l.includes('|') ? '|' : (l.includes(',') ? ',' : null));
      if (!sep) {
        continue;
      }
      const [u, p] = l.split(sep);
      if (!u || !p) continue;
      out.push({ raw: `${u}:${p}`, user: u.trim(), pass: p.trim() });
    }
    return out;
  }

  function dedupe(arr) {
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      if (!seen.has(item.raw)) {
        seen.add(item.raw);
        out.push(item);
      }
    }
    return out;
  }

  function updateStats() {
    totalEl.textContent = combos.length;
    const checked = results.length;
    checkedEl.textContent = checked;
    hitsEl.textContent = results.filter(r => r.status === 'hit').length;
    failsEl.textContent = results.filter(r => r.status === 'fail').length;
    errorsEl.textContent = results.filter(r => r.status === 'error').length;
    progressFill.style.width = combos.length ? `${(checked / combos.length) * 100}%` : '0%';
  }

  function appendResultRow(index, combo, status, detail) {
    const tr = document.createElement('tr');
    const idxTd = document.createElement('td');
    idxTd.textContent = index;
    const comboTd = document.createElement('td');
    comboTd.textContent = combo.raw;
    const statusTd = document.createElement('td');
    statusTd.textContent = status.toUpperCase();
    statusTd.className = status === 'hit' ? 'result-hit' : (status === 'fail' ? 'result-fail' : '');
    const detailTd = document.createElement('td');
    detailTd.textContent = detail;

    tr.appendChild(idxTd);
    tr.appendChild(comboTd);
    tr.appendChild(statusTd);
    tr.appendChild(detailTd);
    resultsTableBody.appendChild(tr);
  }

  function exportCSV() {
    const header = ['index','combo','status','detail'];
    const rows = results.map((r, i) => [i+1, r.combo.raw, r.status, r.detail.replace(/\n/g, ' ')]);
    const csv = [header, ...rows].map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `results_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Concurrency pool: takes tasks and runs up to concurrency simultaneously
  async function runChecks(endpoint, concurrency = 8, delayMs = 0, retries = 1) {
    stopRequested = false;
    results = [];
    resultsTableBody.innerHTML = '';
    updateStats();

    let index = 0;
    let active = 0;
    let done = 0;

    return new Promise((resolve) => {
      function next() {
        if (stopRequested) {
          resolve();
          return;
        }
        while (active < concurrency && index < combos.length) {
          const combo = combos[index];
          const thisIndex = index;
          index++;
          active++;
          (async () => {
            try {
              const res = await tryCheck(endpoint, combo, retries);
              results.push({ combo, status: res.status, detail: res.detail });
              appendResultRow(thisIndex+1, combo, res.status, res.detail);
            } catch (e) {
              results.push({ combo, status: 'error', detail: String(e) });
              appendResultRow(thisIndex+1, combo, 'error', String(e));
            } finally {
              active--;
              done++;
              updateStats();
              if (done === combos.length || stopRequested) {
                resolve();
              } else {
                if (delayMs && done % concurrency === 0) {
                  setTimeout(next, delayMs);
                } else {
                  setTimeout(next, 0);
                }
              }
            }
          })();
        }
      }
      next();
    });
  }

  // Do a single check with retries.
  // The client POSTS JSON {username, password} to endpoint and expects 200 for success.
  async function tryCheck(endpoint, combo, retries) {
    const payload = { username: combo.user, password: combo.pass };
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (resp.ok) {
          const data = await resp.json().catch(()=>({}));
          return { status: 'hit', detail: data.msg || 'OK' };
        } else if (resp.status === 401) {
          return { status: 'fail', detail: 'Invalid credentials' };
        } else {
          const text = await resp.text().catch(()=>String(resp.status));
          lastError = `HTTP ${resp.status} ${text}`;
        }
      } catch (err) {
        lastError = String(err);
      }

      // small backoff before retry
      await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
    }
    return { status: 'error', detail: lastError || 'Unknown error' };
  }

  // UI events
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      comboInput.value = reader.result;
    };
    reader.readAsText(f);
  });

  loadSampleBtn.addEventListener('click', (e) => {
    comboInput.value = [
      'alice@example.com:Password123!',
      'bob@example.com:hunter2',
      'testuser:letmein',
      'invalid@example.com:wrongpass'
    ].join('\n');
  });

  startBtn.addEventListener('click', async () => {
    // Parse and prepare
    const rawText = comboInput.value || '';
    let parsed = parseCombosFromText(rawText);
    parsed = dedupe(parsed);
    combos = parsed;
    results = [];
    resultsTableBody.innerHTML = '';
    updateStats();

    if (!combos.length) {
      alert('No valid combos found. Paste lines like user:pass');
      return;
    }

    startBtn.disabled = true;
    stopBtn.disabled = false;
    const concurrency = Math.max(1, Math.min(50, Number(concurrencyInput.value) || 8));
    const delayMs = Math.max(0, Number(delayInput.value) || 0);
    const retries = Math.max(0, Math.min(5, Number(retriesInput.value) || 1));
    const endpoint = endpointInput.value.trim();

    try {
      await runChecks(endpoint, concurrency, delayMs, retries);
    } finally {
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });

  stopBtn.addEventListener('click', () => {
    stopRequested = true;
    stopBtn.disabled = true;
  });

  exportCsvBtn.addEventListener('click', () => exportCSV());
  clearResultsBtn.addEventListener('click', () => {
    results = [];
    resultsTableBody.innerHTML = '';
    updateStats();
  });

  // init
  updateStats();
})();
