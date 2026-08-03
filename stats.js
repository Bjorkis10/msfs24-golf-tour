(function () {
  'use strict';

  const data = TOUR_DATA;
  const CATS = data.categories;
  const STORAGE_KEY = 'msfs24-world-golf-tour-played';
  const FLIGHTS_KEY = 'msfs24-world-golf-tour-flights';
  const NM2KM = 1.852;

  const SHORT = {
    'GA / Light Jet': 'GA',
    'Regional (ATR/ERJ)': 'REG',
    'Narrowbody (A320/737)': 'NB',
    'Widebody (A340/A350/777/MD-11)': 'WB'
  };

  const CATEGORY_COLORS = {
    'GA / Light Jet': '#f56565',
    'Regional (ATR/ERJ)': '#48bb78',
    'Narrowbody (A320/737)': '#5ea2ef',
    'Widebody (A340/A350/777/MD-11)': '#ed8936'
  };

  const PALETTE = ['#34d399', '#5ea2ef', '#f5b942', '#f97066', '#b06fd1', '#22d3ee', '#ed8936', '#48bb78', '#f56565', '#ecc94b', '#60a5fa', '#f472b6'];

  // Plane -> category
  const PLANE_CAT = {};
  CATS.forEach(function (cat) {
    const f = data.fleet[cat];
    if (!f || !f.planes) return;
    f.planes.split(',').forEach(function (p) {
      const label = p.trim().replace(/^\+/, '').trim();
      if (label) PLANE_CAT[label] = cat;
    });
  });

  // Best category for an ICAO type code not in our fleet (e.g. from SimBrief)
  function classifyAircraftByType(icao) {
    const t = String(icao || '').toUpperCase();
    if (!t) return '';
    if (/^(A300|A310|A330|A332|A333|A338|A339|A340|A342|A343|A345|A346|A350|A351|A359|A35K|A380|A388|B741|B742|B743|B744|B748|B77|B78|B762|B763|B764|MD11|IL86|IL96|L101|D10)/.test(t)) return 'Widebody (A340/A350/777/MD-11)';
    if (/^(A318|A319|A320|A321|A322|A19|A20|A21|BCS|B712|B717|B72|B73|B37|B38|B39|MD8|MD9)/.test(t)) return 'Narrowbody (A320/737)';
    if (/^(ATR|AT4|AT5|AT7|CRJ|CR1|CR2|CR7|CR9|E14|E17|E19|E75|E90|E145|ERJ|DH8|DH4|SF34|F50|F70|F100|BA4|RJ1|RJ7|RJ8|J328|ARJ)/.test(t)) return 'Regional (ATR/ERJ)';
    if (/^(C1|C2|C25|C5|C6|C7|C8|C90|P28|PA2|PA3|PA4|PA6|PA7|SR2|SR1|TBM|PC1|PC2|DA4|DA6|BE1|BE2|BE3|BE4|BE5|BE6|BE8|BE9|M20|P46|E55|G2|G3|G4|G5|G6|G7|LJ|CL3|CL6|HA4|F2|S22)/.test(t)) return 'GA / Light Jet';
    return '';
  }

  function catOf(ac, rec) {
    if (PLANE_CAT[ac]) return PLANE_CAT[ac];
    if (rec && rec.icao) return classifyAircraftByType(rec.icao);
    return '';
  }

  // ---------- Load state (shared with the map page) ----------
  let flownAircraft = {}; // id -> { ac, t }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(function (id) { flownAircraft[id] = { ac: null, t: null }; });
      } else {
        Object.keys(parsed).forEach(function (k) {
          const v = parsed[k];
          flownAircraft[k] = (typeof v === 'string') ? { ac: v, t: null } : v;
        });
      }
    }
  } catch (e) { /* ignore */ }

  const playedIds = Object.keys(flownAircraft).map(Number);
  const playedSet = new Set(playedIds);

  // Logged flights from SimBrief (shared with the map page)
  let loggedFlights = [];
  try {
    const raw = localStorage.getItem(FLIGHTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) loggedFlights = parsed;
    }
  } catch (e) { /* ignore */ }

  // ---------- Helpers ----------
  // Leg i flies to course i+1
  function legForCourse(cid) { return (cid >= 2 && data.legs[cid - 2]) ? data.legs[cid - 2] : null; }

  function parseTimeH(s) {
    if (!s) return 0;
    const m = String(s).match(/(\d+)h\s*(\d+)m/);
    if (!m) return 0;
    return (+m[1]) + (+m[2]) / 60;
  }

  function fmtNum(n) { return (n == null) ? '—' : Number(n).toLocaleString('en-US'); }

  function fmtDur(h) {
    if (h == null) return '—';
    const total = Math.round(h * 60);
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    if (hh === 0) return mm + 'm';
    if (mm === 0) return hh + 'h';
    return hh + 'h ' + mm + 'm';
  }

  function shortOf(cat) { return SHORT[cat] || cat; }

  function thresholdText(cat) {
    const t = data.thresholds[cat];
    if (!t || t.min == null) return 'No minimum';
    return '\u2265 ' + fmtNum(t.min) + ' ft runway';
  }

  function fmtDate(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ---------- Aggregates ----------
  const total = data.courses.length;
  const done = playedIds.length;
  const pct = Math.round(done / total * 100);

  let flownNm = 0;
  let flownH = 0;
  let flights = 0;
  const byPlane = {}; // ac -> { count, nm, h, tFirst, tLast, cat }

  playedIds.forEach(function (id) {
    const rec = flownAircraft[id];
    const ac = (rec && rec.ac) ? rec.ac : '(not recorded)';
    const leg = legForCourse(id);
    if (leg) { flights++; flownNm += leg.distance; flownH += parseTimeH(leg.flightTime); }
    const b = byPlane[ac] || (byPlane[ac] = { count: 0, nm: 0, h: 0, tFirst: Infinity, tLast: 0 });
    if (!b.cat) b.cat = catOf(ac, rec);
    b.count++;
    if (leg) { b.nm += leg.distance; b.h += parseTimeH(leg.flightTime); }
    if (rec && rec.t) {
      if (rec.t < b.tFirst) b.tFirst = rec.t;
      if (rec.t > b.tLast) b.tLast = rec.t;
    }
  });

  // ---------- Logged flights aggregates ----------
  let fCount = loggedFlights.length;
  let fNm = 0;
  let fMin = 0;
  loggedFlights.forEach(function (f) {
    fNm += (f.distanceNm || 0);
    fMin += (f.timeMin || 0);
  });

  // ---------- Empty banner ----------
  if (done === 0) {
    document.getElementById('empty-banner').style.display = 'block';
    document.getElementById('empty-banner').innerHTML = 'No courses checked off yet — open the <b>Map</b>, check a course and pick the aircraft you flew. Your distance, time and graphs will appear here.';
  }

  // ---------- Hero cards ----------
  function heroCard(label, value, sub) {
    return '<div class="info-card"><div class="big-num">' + value + '</div>' +
      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-top:4px">' + label + '</div>' +
      (sub ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + sub + '</div>' : '') + '</div>';
  }

  document.getElementById('stat-hero').innerHTML =
    heroCard('Courses played', done + '<span class="small"> / ' + total + '</span>', pct + '% of the tour') +
    heroCard('Distance flown', fmtNum(Math.round(flownNm)) + ' <span class="small">nm</span>', '\u2248 ' + fmtNum(Math.round(flownNm * NM2KM)) + ' km') +
    heroCard('Time flown', fmtDur(flownH), flights + ' flights completed') +
    heroCard('Distance remaining', fmtNum(Math.round(Math.max(0, data.stats.distanceNm - flownNm))) + ' <span class="small">nm</span>', Math.round((1 - flownNm / data.stats.distanceNm) * 100) + '% of the tour left') +
    heroCard('Flights logged', fCount, fCount ? fmtNum(Math.round(fNm)) + ' nm \u00B7 ' + fmtDur(fMin / 60) + ' \u00B7 SimBrief' : 'From SimBrief');

  // ---------- Progress ----------
  document.getElementById('p-fill').style.width = pct + '%';
  document.getElementById('p-pct').textContent = pct + '%';
  document.getElementById('p-note').textContent = '(' + done + ' of ' + total + ' courses)';

  // ---------- Aircraft table ----------
  const names = Object.keys(byPlane).sort(function (a, b) { return byPlane[b].count - byPlane[a].count; });
  let tblHtml;
  if (!names.length) {
    tblHtml = '<div class="empty-note">Nothing flown yet.</div>';
  } else {
    tblHtml = '<table class="detail ac-table"><tr><th>Aircraft</th><th>Cat</th><th style="text-align:right">Courses</th><th style="text-align:right">Distance</th><th style="text-align:right">Time</th></tr>';
    names.forEach(function (ac) {
      const b = byPlane[ac];
      const cat = b.cat ? shortOf(b.cat) : '—';
      tblHtml += '<tr><td><b>' + ac + '</b></td><td>' + cat +
        '</td><td style="text-align:right">' + b.count +
        '</td><td style="text-align:right">' + fmtNum(Math.round(b.nm)) + ' nm' +
        '</td><td style="text-align:right">' + fmtDur(b.h) + '</td></tr>';
    });
    tblHtml += '</table>';
  }
  document.getElementById('aircraft-table').innerHTML = tblHtml;

  // ---------- Legs per category bars ----------
  let bars = '';
  CATS.forEach(function (cat) {
    const count = data.legsByCategory[cat] || 0;
    const p = Math.round(count / data.legs.length * 100);
    bars += '<div><div class="row" style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span>' + cat + '</span><span><b>' + count + '</b> legs \u00B7 ' + p + '%</span></div>' +
      '<div style="height:9px;border-radius:999px;background:var(--surface-3);overflow:hidden"><div style="height:100%;width:' + p + '%;background:' + CATEGORY_COLORS[cat] + '"></div></div></div>';
  });
  document.getElementById('cat-bars').innerHTML = bars;

  // ---------- Fleet card ----------
  let fleetRows = '';
  CATS.forEach(function (cat) {
    const f = data.fleet[cat];
    fleetRows += '<tr><td><b>' + shortOf(cat) + '</b></td><td>' + (f ? f.planes : '—') + '</td><td>' + (f ? fmtNum(f.speed) : '—') + ' kt</td><td>' + thresholdText(cat) + '</td></tr>';
  });
  document.getElementById('fleet-card').innerHTML =
    '<table class="detail"><tr><th>Category</th><th>Aircraft</th><th>Speed</th><th>Runway requirement</th></tr>' + fleetRows + '</table>';

  // ---------- Logged flights table ----------
  let flHtml;
  if (!fCount) {
    flHtml = '<div class="empty-note">No flights logged yet \u2014 open the <b>Map</b> and use <b>Log flight</b> to fetch your latest SimBrief flight plan and draw it on the map.</div>';
  } else {
    flHtml = '<table class="detail fl-table"><tr><th>When</th><th>Route</th><th>Aircraft</th><th style="text-align:right">Distance</th><th style="text-align:right">Time</th></tr>';
    loggedFlights.slice().sort(function (a, b) { return (a.t || 0) - (b.t || 0); }).forEach(function (f) {
      flHtml += '<tr><td>' + fmtDate(f.t) + '</td>' +
        '<td><b>' + f.from + ' \u2192 ' + f.to + '</b>' + (f.legId ? ' <span style="color:var(--muted)">(leg #' + f.legId + ')</span>' : '') + '</td>' +
        '<td>' + (f.aircraft || '—') + '</td>' +
        '<td style="text-align:right">' + fmtNum(Math.round(f.distanceNm)) + ' nm</td>' +
        '<td style="text-align:right">' + fmtDur(f.timeMin / 60) + '</td></tr>';
    });
    flHtml += '</table>';
  }
  document.getElementById('flight-log').innerHTML = flHtml;

  // ---------- Charts ----------
  if (typeof Chart === 'undefined') {
    document.querySelectorAll('.chart-box').forEach(function (box) {
      box.classList.add('note-box');
      box.innerHTML = '<div class="empty-note">Charts could not load (Chart.js unavailable).</div>';
    });
    return;
  }

  Chart.defaults.color = '#8ea3ba';
  Chart.defaults.borderColor = 'rgba(36, 55, 80, 0.6)';
  Chart.defaults.font.family = 'Outfit, sans-serif';

  const acLabels = names.map(function (n) { return n === '(not recorded)' ? 'Not recorded' : n; });
  const acCounts = names.map(function (n) { return byPlane[n].count; });
  const acNm = names.map(function (n) { return Math.round(byPlane[n].nm); });

  // Doughnut: courses by aircraft
  new Chart(document.getElementById('ch-aircraft'), {
    type: 'doughnut',
    data: {
      labels: acLabels,
      datasets: [{ data: acCounts, backgroundColor: PALETTE, borderWidth: 2, borderColor: '#101a2c' }]
    },
    options: {
      cutout: '60%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
        tooltip: { callbacks: { label: function (ctx) { return ' ' + ctx.label + ': ' + ctx.parsed + (ctx.parsed === 1 ? ' course' : ' courses'); } } }
      }
    }
  });

  // Stacked bar: courses per region
  const regs = data.regions;
  const playedReg = {};
  const totalReg = {};
  regs.forEach(function (r) { playedReg[r] = 0; totalReg[r] = 0; });
  data.courses.forEach(function (c) {
    totalReg[c.region]++;
    if (playedSet.has(c.id)) playedReg[c.region]++;
  });
  new Chart(document.getElementById('ch-region'), {
    type: 'bar',
    data: {
      labels: regs,
      datasets: [
        { label: 'Played', data: regs.map(function (r) { return playedReg[r]; }), backgroundColor: '#34d399' },
        { label: 'Remaining', data: regs.map(function (r) { return totalReg[r] - playedReg[r]; }), backgroundColor: '#1f2f4a' }
      ]
    },
    options: {
      indexAxis: 'y',
      stacked: true,
      scales: {
        x: { stacked: true, ticks: { precision: 0 } },
        y: { stacked: true }
      },
      plugins: { legend: { position: 'bottom' } }
    }
  });

  // Bar: distance flown by aircraft
  new Chart(document.getElementById('ch-distance'), {
    type: 'bar',
    data: {
      labels: acLabels,
      datasets: [{ label: 'nm flown', data: acNm, backgroundColor: PALETTE }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: function (v) { return fmtNum(v) + ' nm'; } } } }
    }
  });

  // Line: cumulative courses flown over time
  const timed = playedIds
    .filter(function (id) { return flownAircraft[id] && flownAircraft[id].t; })
    .map(function (id) { return { id: id, t: flownAircraft[id].t }; })
    .sort(function (a, b) { return a.t - b.t; });

  const timeBox = document.getElementById('ch-time').parentElement;
  if (timed.length < 2) {
    timeBox.classList.add('note-box');
    timeBox.innerHTML = '<div class="empty-note">Played dates are only recorded for newly checked-off courses. Check off at least two courses to see your progress over time.</div>';
  } else {
    let run = 0;
    const tl = [];
    const tc = [];
    timed.forEach(function (e, i) {
      run++;
      tl.push(fmtDate(e.t));
      tc.push(run);
    });
    new Chart(document.getElementById('ch-time'), {
      type: 'line',
      data: {
        labels: tl,
        datasets: [{
          data: tc,
          borderColor: '#34d399',
          backgroundColor: 'rgba(52, 211, 153, 0.15)',
          fill: true,
          tension: 0.3,
          pointRadius: 3
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { precision: 0 } } }
      }
    });
  }
})();
