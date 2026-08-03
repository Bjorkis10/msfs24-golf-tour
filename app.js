(function () {
  'use strict';

  const REGION_COLORS = {
    'Europe': '#5ea2ef',
    'Africa': '#ed8936',
    'Asia': '#48bb78',
    'Oceania': '#b06fd1',
    'Pacific': '#22d3ee',
    'North America': '#f56565',
    'South America': '#ecc94b'
  };

  const CATEGORY_COLORS = {
    'GA / Light Jet': '#f56565',
    'Regional (ATR/ERJ)': '#48bb78',
    'Narrowbody (A320/737)': '#5ea2ef',
    'Widebody (A340/A350/777/MD-11)': '#ed8936'
  };

  const SHORT = {
    'GA / Light Jet': 'GA',
    'Regional (ATR/ERJ)': 'REG',
    'Narrowbody (A320/737)': 'NB',
    'Widebody (A340/A350/777/MD-11)': 'WB'
  };

  const STORAGE_KEY = 'msfs24-world-golf-tour-played';
  const data = TOUR_DATA;
  const CATS = data.categories;
  const okField = data.okField;

  // ---------- State ----------
  let played = new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) played = new Set(arr.map(Number)); }
  } catch (e) { /* ignore */ }

  let selectedAircraft = 'all';

  function savePlayed() { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(played))); }

  // ---------- Helpers ----------
  function catOk(obj, cat) {
    if (cat === 'all') return true;
    return !!obj[okField[cat]];
  }

  function shortOf(cat) { return SHORT[cat] || cat; }

  function thresholdText(cat) {
    const t = data.thresholds[cat];
    if (!t || t.min == null) return 'No minimum';
    return '\u2265 ' + t.min.toLocaleString('en-US') + ' ft runway';
  }

  function fmtNum(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('en-US');
  }

  function fmtTime(h) {
    if (h == null) return '—';
    return Number(h).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' h';
  }

  function starsHtml(rating) {
    const full = Math.floor(rating);
    let s = '';
    for (let i = 0; i < full; i++) s += '\u2605';
    if (rating - full >= 0.5) s += '\u00BD';
    return s;
  }

  function okChipHtml(cat, obj, isRek) {
    const ok = catOk(obj, cat);
    const cls = isRek ? 'rek' : (ok ? 'ok' : 'no');
    return '<span class="ok-chip ' + cls + '" title="' + cat + (isRek ? ' \u2014 recommended' : '') + '">' + shortOf(cat) + (isRek ? ' \u2605' : (ok ? ' \u2713' : ' \u2717')) + '</span>';
  }

  function runwayStatus(c, cat) {
    const ok = catOk(c, cat);
    const rw = fmtNum(c.runway) + ' ft';
    const t = data.thresholds[cat];
    if (ok) return { text: 'Can land \u00B7 runway ' + rw, cls: 'ok' };
    if (!t || t.min == null) return { text: 'Cannot land \u00B7 runway ' + rw, cls: 'no' };
    return { text: 'Cannot land \u00B7 runway ' + rw + ' requires \u2265 ' + fmtNum(t.min) + ' ft', cls: 'no' };
  }

  // ---------- Map ----------
  const map = L.map('map', { worldCopyJump: true, minZoom: 2 });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19
  }).addTo(map);

  const courseMarkers = new Map();
  const legLayers = []; // { polyline, label }

  function markerIcon(c, isPlayed) {
    let bg, ring, extra = '';
    if (isPlayed) { bg = '#2c3f50'; ring = '#3a4f61'; extra = ' played'; }
    else if (selectedAircraft === 'all') { bg = REGION_COLORS[c.region]; ring = 'rgba(255,255,255,.9)'; }
    else if (c.category === selectedAircraft) { bg = '#f5b942'; ring = '#fff'; extra = ' rek'; }
    else if (catOk(c, selectedAircraft)) { bg = '#34d399'; ring = '#fff'; }
    else { bg = '#f97066'; ring = 'rgba(255,255,255,.7)'; extra = ' no'; }
    return L.divIcon({
      className: 'course-icon-wrap',
      html: '<div class="course-icon' + extra + '" style="background:' + bg + ';border-color:' + ring + '">' + c.id + '</div>',
      iconSize: [25, 25],
      iconAnchor: [12, 12]
    });
  }

  function coursePopup(c) {
    let html =
      '<div class="popup-title">' + c.name + '</div>' +
      '<div class="popup-sub">' + c.country + ' \u00B7 ' + c.region + '</div>' +
      '<div class="popup-row"><b>Arrival:</b> ' + c.arrival +
        (c.closer ? ' (nearest: ' + c.closer.split(' ')[0] + ')' : '') + '</div>' +
      '<div class="popup-row"><b>Runway:</b> ' + fmtNum(c.runway) + ' ft</div>' +
      '<div class="popup-row"><b>Recommended:</b> ' + c.category + '</div>' +
      '<div class="popup-row"><span class="stars">' + starsHtml(c.rating) + '</span> <span class="rank">' + c.ranking + '</span></div>' +
      '<div class="popup-row"><b>Can land:</b> ' +
        CATS.map(function (cat) { return okChipHtml(cat, c, c.category === cat); }).join(' ') +
      '</div>';

    if (selectedAircraft !== 'all') {
      if (c.category === selectedAircraft) html += '<div class="popup-rek">\u2B50 Recommended aircraft for this course</div>';
      else if (catOk(c, selectedAircraft)) html += '<div class="popup-ok">\u2713 ' + shortOf(selectedAircraft) + ' can land here \u00B7 runway ' + fmtNum(c.runway) + ' ft</div>';
      else {
        const rs = runwayStatus(c, selectedAircraft);
        html += '<div class="popup-warn">\u26A0 ' + shortOf(selectedAircraft) + ' can NOT land here \u00B7 ' + rs.text.replace('Cannot land \u00B7 ', '') + '</div>';
      }
    }

    if (c.majors && c.majors !== 'None') html += '<div class="popup-majors">' + c.majors + '</div>';
    return html;
  }

  function legPopup(l) {
    return '<div class="popup-title">Leg #' + l.id + ': ' + l.from + ' \u2192 ' + l.to + '</div>' +
      '<div class="popup-sub">' + l.fromName + ' \u2192 ' + l.toName + '</div>' +
      '<div class="popup-row"><b>Distance:</b> ' + fmtNum(l.distance) + ' nm</div>' +
      '<div class="popup-row"><b>Flight time:</b> ' + l.flightTime + ' (' + fmtNum(l.speed) + ' kt)</div>' +
      '<div class="popup-row"><b>Runway:</b> ' + fmtNum(l.runway) + ' ft</div>' +
      '<div class="popup-row"><b>Recommended:</b> ' + l.category + '</div>' +
      '<div class="popup-row"><b>Can land:</b> ' +
        CATS.map(function (cat) { return okChipHtml(cat, l, l.category === cat); }).join(' ') +
      '</div>';
  }

  // Course markers
  data.courses.forEach(function (c) {
    if (c.lat == null) return;
    const m = L.marker([c.lat, c.lon], { icon: markerIcon(c, played.has(c.id)), title: c.name });
    m.bindPopup(coursePopup(c));
    m.on('click', function () { highlightCourse(c.id); });
    m.addTo(map);
    courseMarkers.set(c.id, m);
  });

  // Leg routes
  data.legs.forEach(function (l) {
    const latlngs = [[l.fromLat, l.fromLon], [l.toLat, l.toLon]];
    const pl = L.polyline(latlngs, routeStyle(l));
    pl.bindPopup(legPopup(l));
    pl.addTo(map);

    const label = L.marker([(l.fromLat + l.toLat) / 2, (l.fromLon + l.toLon) / 2], {
      icon: L.divIcon({
        className: 'route-label-bg' + (l.category === selectedAircraft && selectedAircraft !== 'all' ? ' rek' : ''),
        html: '#' + l.id,
        iconSize: [32, 16],
        iconAnchor: [16, 8]
      }),
      interactive: false
    });
    label.addTo(map);
    legLayers.push({ polyline: pl, label: label });
  });

  const pts = data.courses.filter(function (c) { return c.lat != null; }).map(function (c) { return [c.lat, c.lon]; });
  map.fitBounds(L.latLngBounds(pts).pad(0.05), { maxZoom: 7 });

  function routeStyle(l) {
    if (selectedAircraft === 'all') {
      return { color: CATEGORY_COLORS[l.category], weight: 2, opacity: 0.6 };
    }
    if (l.category === selectedAircraft) return { color: '#f5b942', weight: 3.5, opacity: 0.95 };
    if (catOk(l, selectedAircraft)) return { color: '#34d399', weight: 2, opacity: 0.7 };
    return { color: '#f97066', weight: 2, opacity: 0.35, dashArray: '6 6' };
  }

  function applyMapAircraft() {
    data.courses.forEach(function (c) {
      const m = courseMarkers.get(c.id);
      if (m && map.hasLayer(m)) m.setIcon(markerIcon(c, played.has(c.id)));
    });
    legLayers.forEach(function (entry, i) {
      const l = data.legs[i];
      entry.polyline.setStyle(routeStyle(l));
      const cls = l.category === selectedAircraft && selectedAircraft !== 'all' ? ' rek' : '';
      entry.label.setIcon(L.divIcon({
        className: 'route-label-bg' + cls,
        html: '#' + l.id,
        iconSize: [32, 16],
        iconAnchor: [16, 8]
      }));
    });
  }

  // ---------- Aircraft bar ----------
  const pillsEl = document.getElementById('aircraft-pills');
  const captionEl = document.getElementById('aircraft-caption');
  const hintEl = document.getElementById('aircraft-hint');

  function legCount(cat) {
    if (cat === 'all') return data.legs.length;
    return data.legs.filter(function (l) { return catOk(l, cat); }).length;
  }
  function courseCount(cat) {
    if (cat === 'all') return data.courses.length;
    return data.courses.filter(function (c) { return catOk(c, cat); }).length;
  }

  function buildAircraftPills() {
    pillsEl.innerHTML = '';
    const opts = [{ cat: 'all', label: 'All aircraft' }].concat(CATS.map(function (c) { return { cat: c, label: c }; }));
    opts.forEach(function (opt) {
      const btn = document.createElement('button');
      btn.className = 'pill' + (selectedAircraft === opt.cat ? ' active' : '');
      btn.dataset.cat = opt.cat;
      const short = opt.cat === 'all' ? 'ALL' : shortOf(opt.cat);
      btn.innerHTML = '<span>' + (opt.cat === 'all' ? opt.label : short) + '</span><span class="count">' + legCount(opt.cat) + ' legs</span>';
      btn.title = opt.cat === 'all' ? 'Show all' : opt.label + ' \u2014 can do ' + courseCount(opt.cat) + ' of ' + data.courses.length + ' courses';
      btn.addEventListener('click', function () { selectAircraft(opt.cat); });
      pillsEl.appendChild(btn);
    });
  }

  function updateCaption() {
    if (selectedAircraft === 'all') {
      hintEl.textContent = '';
      captionEl.innerHTML = 'Pick an aircraft to see which courses and routes you can land on. ' +
        '<b class="accent">Gold = recommended aircraft</b>, green = can land, red = cannot land.';
    } else {
      const fleet = data.fleet[selectedAircraft];
      const okC = courseCount(selectedAircraft);
      const okL = legCount(selectedAircraft);
      const noC = data.courses.length - okC;
      hintEl.textContent = '\u2014 can do ' + okL + ' of ' + data.legs.length + ' legs';
      captionEl.innerHTML =
        '<b>' + selectedAircraft + '</b> &middot; Your fleet: ' + (fleet ? fleet.planes : '') +
        ' &middot; Requirement: ' + thresholdText(selectedAircraft) +
        ' &middot; Can do <b class="accent">' + okC + '</b> of ' + data.courses.length + ' courses' +
        (noC ? ' \u2014 <span style="color:var(--red)">' + noC + ' cannot be landed</span>' : '');
    }
  }

  function selectAircraft(cat) {
    selectedAircraft = cat;
    pillsEl.querySelectorAll('.pill').forEach(function (p) { p.classList.toggle('active', p.dataset.cat === cat); });
    updateCaption();
    applyMapAircraft();
    refreshCourseRows();
    refreshLegRows();
    refreshLegSummary();
    updateMapLegend();
  }

  // ---------- Course list ----------
  const listEl = document.getElementById('course-list');
  const regionEl = document.getElementById('region-filters');
  const courseRows = new Map();

  let regionState = {};
  data.regions.forEach(function (r) { regionState[r] = true; });

  data.regions.forEach(function (r) {
    const chip = document.createElement('label');
    chip.className = 'region-chip on';
    chip.style.setProperty('--chip', REGION_COLORS[r]);
    chip.innerHTML = '<span class="dot"></span>' + r;
    chip.addEventListener('click', function () {
      chip.classList.toggle('on');
      regionState[r] = chip.classList.contains('on');
      applyFilters();
    });
    regionEl.appendChild(chip);
  });

  function buildCourseList() {
    listEl.innerHTML = '';
    data.courses.forEach(function (c) {
      const row = document.createElement('div');
      row.className = 'course-item';
      row.dataset.id = c.id;
      row.style.setProperty('--chip', REGION_COLORS[c.region]);

      const num = document.createElement('div');
      num.className = 'num';
      num.textContent = c.id;

      const info = document.createElement('div');
      info.className = 'course-info';

      const name = document.createElement('div');
      name.className = 'course-name';
      name.textContent = c.name;

      const sub = document.createElement('div');
      sub.className = 'course-sub';
      sub.textContent = c.country + ' \u00B7 ' + c.arrival;

      const meta = document.createElement('div');
      meta.className = 'course-meta';
      const bStars = document.createElement('span');
      bStars.className = 'stars';
      bStars.textContent = starsHtml(c.rating);
      const bRank = document.createElement('span');
      bRank.className = 'rank';
      bRank.textContent = c.ranking;
      const bRun = document.createElement('span');
      bRun.className = 'badge';
      bRun.textContent = fmtNum(c.runway) + ' ft';
      meta.appendChild(bStars);
      meta.appendChild(bRank);
      meta.appendChild(bRun);

      const chipsEl = document.createElement('div');
      chipsEl.className = 'course-meta';

      const statusEl = document.createElement('div');
      statusEl.className = 'status-line';

      info.appendChild(name);
      info.appendChild(sub);
      info.appendChild(meta);
      info.appendChild(chipsEl);
      info.appendChild(statusEl);

      const check = document.createElement('div');
      check.className = 'check';
      check.textContent = '\u2713';
      check.title = 'Mark as played';

      row.appendChild(num);
      row.appendChild(info);
      row.appendChild(check);

      row.addEventListener('click', function (e) {
        if (e.target === check) return;
        flyToCourse(c.id);
      });
      check.addEventListener('click', function (e) {
        e.stopPropagation();
        togglePlayed(c.id);
      });

      listEl.appendChild(row);
      courseRows.set(c.id, { row: row, num: num, name: name, chipsEl: chipsEl, statusEl: statusEl });
    });
  }

  function refreshCourseRows() {
    const q = document.getElementById('search').value.trim().toLowerCase();
    const playedOnly = document.getElementById('toggle-played-only').checked;

    data.courses.forEach(function (c) {
      const entry = courseRows.get(c.id);
      if (!entry) return;

      let show = true;
      if (regionState[c.region] === false) show = false;
      if (playedOnly && played.has(c.id)) show = false;
      if (q) {
        const hay = (c.name + ' ' + c.country + ' ' + c.region + ' ' + c.arrival + ' ' +
          (c.hub || '') + ' ' + (c.closer || '')).toLowerCase();
        if (!hay.includes(q)) show = false;
      }
      entry.row.style.display = show ? '' : 'none';
      entry.row.classList.toggle('played', played.has(c.id));

      entry.chipsEl.innerHTML = CATS.map(function (cat) { return okChipHtml(cat, c, c.category === cat); }).join(' ');

      let statusCls = '';
      let statusText = '';
      if (selectedAircraft !== 'all') {
        if (c.category === selectedAircraft) { statusCls = 'rek'; statusText = '\u2B50 Recommended aircraft for this course'; }
        else {
          const rs = runwayStatus(c, selectedAircraft);
          statusCls = rs.cls;
          statusText = rs.text;
        }
      }
      entry.statusEl.className = 'status-line' + (statusCls ? ' ' + statusCls : '');
      entry.statusEl.textContent = statusText;

      const m = courseMarkers.get(c.id);
      if (show && m) { if (!map.hasLayer(m)) m.addTo(map); }
      else if (m) { m.remove(); }
    });
  }

  function togglePlayed(id) {
    if (played.has(id)) played.delete(id); else played.add(id);
    savePlayed();
    const c = data.courses.find(function (x) { return x.id === id; });
    const m = courseMarkers.get(id);
    if (m) {
      m.setIcon(markerIcon(c, played.has(id)));
      m.setPopupContent(coursePopup(c));
    }
    refreshCourseRows();
    updateStats();
  }

  function flyToCourse(id) {
    const c = data.courses.find(function (x) { return x.id === id; });
    const m = courseMarkers.get(id);
    if (!c || !m) return;
    highlightCourse(id);
    map.flyTo([c.lat, c.lon], Math.max(map.getZoom(), 9));
    setTimeout(function () { m.openPopup(); }, 480);
  }

  function highlightCourse(id) {
    courseRows.forEach(function (entry, cid) {
      entry.row.classList.toggle('active', cid === id);
    });
    const entry = courseRows.get(id);
    if (entry) entry.row.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Leg list ----------
  const legListEl = document.getElementById('leg-list');
  const legSummaryEl = document.getElementById('leg-summary');
  const legRows = [];

  function buildLegList() {
    const head = document.getElementById('leg-head');
    head.innerHTML =
      '<div>#</div><div>Route</div><div style="text-align:right">Distance</div><div style="text-align:right">Time</div><div style="text-align:right">Can land</div>';

    legListEl.innerHTML = '';
    data.legs.forEach(function (l) {
      const row = document.createElement('div');
      row.className = 'leg-row';
      row.dataset.id = l.id;
      row.innerHTML =
        '<div class="leg-num">' + l.id + '</div>' +
        '<div class="leg-route">' + l.from + ' \u2192 ' + l.to + '<span class="sub">' + l.fromName.split(' ').slice(1).join(' ') + ' \u2192 ' + l.toName.split(' ').slice(1).join(' ') + '</span></div>' +
        '<div class="leg-dist">' + fmtNum(l.distance) + ' nm</div>' +
        '<div class="leg-time">' + l.flightTime + '</div>' +
        '<div class="leg-chips"></div>';
      row.addEventListener('click', function () { flyToLeg(l.id); });
      legListEl.appendChild(row);
      legRows.push({ row: row, chipsEl: row.querySelector('.leg-chips') });
    });
  }

  function refreshLegRows() {
    legRows.forEach(function (entry, i) {
      const l = data.legs[i];
      entry.chipsEl.innerHTML = CATS.map(function (cat) { return okChipHtml(cat, l, l.category === cat); }).join('');

      let cls = '';
      if (selectedAircraft !== 'all') {
        if (l.category === selectedAircraft) cls = 'status-rek';
        else if (catOk(l, selectedAircraft)) cls = 'status-ok';
        else cls = 'status-no';
      }
      entry.row.className = 'leg-row' + (cls ? ' ' + cls : '');
    });
  }

  function refreshLegSummary() {
    if (selectedAircraft === 'all') {
      legSummaryEl.innerHTML = 'Total <b>' + data.legs.length + ' legs</b> \u00B7 <b>' + fmtNum(data.stats.distanceNm) + ' nm</b>. ' +
        'Pick an aircraft above to see which legs you can fly.';
    } else {
      const ok = legCount(selectedAircraft);
      const no = data.legs.length - ok;
      legSummaryEl.innerHTML = 'With <b>' + shortOf(selectedAircraft) + '</b> you can do <span class="ok-num">' + ok + '</span> of ' +
        data.legs.length + ' legs' + (no ? ' \u2014 <span class="no-num">' + no + ' cannot be landed</span>' : '') +
        '. Gold = recommended.';
    }
  }

  function flyToLeg(id) {
    const l = data.legs.find(function (x) { return x.id === id; });
    const entry = legLayers[id - 1];
    if (!l || !entry) return;
    legRows.forEach(function (e) { e.row.classList.toggle('active', parseInt(e.row.dataset.id) === id); });
    map.flyTo([(l.fromLat + l.toLat) / 2, (l.fromLon + l.toLon) / 2], 6);
    setTimeout(function () { entry.polyline.openPopup(); }, 480);
  }

  // ---------- Info tab ----------
  function buildInfoTab() {
    const el = document.getElementById('info-content');
    const s = data.stats;
    const total = data.courses.length;

    let catBars = '';
    CATS.forEach(function (cat) {
      const count = data.legsByCategory[cat] || 0;
      const pct = Math.round(count / data.legs.length * 100);
      catBars += '<div class="cat-bar"><div class="row"><span>' + cat + '</span><span><b>' + count + '</b> legs \u00B7 ' + pct + '%</span></div>' +
        '<div class="track"><div class="fill" style="width:' + pct + '%;background:' + CATEGORY_COLORS[cat] + '"></div></div></div>';
    });

    let fleetRows = '';
    CATS.forEach(function (cat) {
      const f = data.fleet[cat];
      fleetRows += '<tr><td><b>' + cat + '</b></td><td>' + (f ? f.planes : '—') + '</td><td>' + (f ? fmtNum(f.speed) : '—') + ' kt</td><td>' + thresholdText(cat) + '</td></tr>';
    });

    el.innerHTML =
      '<div class="info-wrap">' +
        '<div class="info-card"><h3>Tour progress</h3>' +
          '<div class="big-num" id="info-played">0 <span class="small">/ ' + total + ' courses</span></div>' +
          '<div class="progress-track"><div class="progress-fill" id="info-fill" style="width:0%"></div></div>' +
          '<div style="margin-top:8px;font-size:12px;color:var(--muted)"><b style="color:var(--accent)" id="info-pct">0%</b> of the tour completed</div>' +
        '</div>' +
        '<div class="info-grid">' +
          '<div class="info-card"><h3>Total distance</h3><div class="big-num">' + fmtNum(s.distanceNm) + ' <span class="small">nm</span></div></div>' +
          '<div class="info-card"><h3>Total distance</h3><div class="big-num">' + fmtNum(s.distanceKm) + ' <span class="small">km</span></div></div>' +
          '<div class="info-card"><h3>Flight time</h3><div class="big-num">' + fmtTime(s.flightTimeH) + '</div></div>' +
          '<div class="info-card"><h3>Flight legs</h3><div class="big-num">' + s.totalLegs + '</div></div>' +
        '</div>' +
        '<div class="info-card"><h3>Legs per recommended category</h3>' + catBars + '</div>' +
        '<div class="info-card"><h3>Your fleet &amp; runway requirements</h3>' +
          '<table class="detail"><tr><th>Category</th><th>Aircraft</th><th>Speed</th><th>Runway requirement</th></tr>' + fleetRows + '</table>' +
          '<div class="note" style="margin-top:10px"><b>Rule:</b> an aircraft can only land if the runway meets the requirement for its category. ' +
          'GA has no practical minimum (the shortest runway on the route is 2,881 ft). Check the "Can land" row on every course or leg before you fly!</div>' +
        '</div>' +
      '</div>';
  }

  // ---------- Stats ----------
  function updateStats() {
    const total = data.courses.length;
    const done = data.courses.filter(function (c) { return played.has(c.id); }).length;
    const pct = Math.round(done / total * 100);
    document.getElementById('stat-played').textContent = done + '/' + total;
    document.getElementById('stat-completion').textContent = pct + '%';
    document.getElementById('stat-distance').textContent = fmtNum(data.stats.distanceNm) + ' nm';
    document.getElementById('stat-time').textContent = fmtTime(data.stats.flightTimeH);
    const fill = document.getElementById('info-fill');
    const pctEl = document.getElementById('info-pct');
    const playedEl = document.getElementById('info-played');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (playedEl) playedEl.innerHTML = done + ' <span class="small">/ ' + total + ' courses</span>';
  }

  // ---------- Legends ----------
  const sidebarLegendEl = document.getElementById('sidebar-legend');
  const mapLegendEl = document.getElementById('map-legend');

  function buildSidebarLegend() {
    sidebarLegendEl.innerHTML = '<h4>Regions</h4>' + data.regions.map(function (r) {
      return '<div class="legend-row"><span class="dot" style="background:' + REGION_COLORS[r] + '"></span>' + r + '</div>';
    }).join('');
    sidebarLegendEl.classList.add('show');
  }

  function updateMapLegend() {
    let html = '';
    if (selectedAircraft === 'all') {
      html = '<div class="ml-row" style="font-weight:700;margin-bottom:2px">Routes by aircraft type</div>' +
        CATS.map(function (cat) {
          return '<div class="ml-row"><span class="line" style="background:' + CATEGORY_COLORS[cat] + '"></span>' + shortOf(cat) + ' \u00B7 ' + data.legsByCategory[cat] + ' legs</div>';
        }).join('') +
        '<div class="ml-row" style="margin-top:6px"><span class="dot" style="background:var(--accent-2);border-color:#fff"></span> Course \u2014 click for info</div>';
    } else {
      html = '<div class="ml-row" style="font-weight:700;margin-bottom:2px">' + shortOf(selectedAircraft) + '</div>' +
        '<div class="ml-row"><span class="line" style="background:var(--gold)"></span><span class="dot" style="background:var(--gold);border-color:#fff"></span> Recommended</div>' +
        '<div class="ml-row"><span class="line" style="background:var(--accent)"></span><span class="dot" style="background:var(--accent);border-color:#fff"></span> Can land</div>' +
        '<div class="ml-row"><span class="line dashed" style="background:var(--red)"></span><span class="dot" style="background:var(--red);border-color:#fff"></span> Cannot land</div>';
    }
    mapLegendEl.innerHTML = html;
    mapLegendEl.classList.add('show');
  }

  // ---------- Events ----------
  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.tab-pane').forEach(function (p) {
        p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab);
      });
    });
  });

  document.getElementById('toggle-routes').addEventListener('change', function () {
    const on = this.checked;
    legLayers.forEach(function (entry) {
      if (on) { entry.polyline.addTo(map); entry.label.addTo(map); }
      else { map.removeLayer(entry.polyline); map.removeLayer(entry.label); }
    });
  });

  document.getElementById('search').addEventListener('input', refreshCourseRows);
  document.getElementById('toggle-played-only').addEventListener('change', refreshCourseRows);

  document.getElementById('reset-all').addEventListener('click', function () {
    if (!confirm('Mark all courses as unplayed? This resets your checklist.')) return;
    played.clear();
    savePlayed();
    data.courses.forEach(function (c) {
      const m = courseMarkers.get(c.id);
      if (m) m.setIcon(markerIcon(c, false));
    });
    refreshCourseRows();
    updateStats();
  });

  // ---------- Init ----------
  buildAircraftPills();
  buildCourseList();
  buildLegList();
  buildInfoTab();
  buildSidebarLegend();
  updateCaption();
  refreshCourseRows();
  refreshLegRows();
  refreshLegSummary();
  updateMapLegend();
  updateStats();
})();
