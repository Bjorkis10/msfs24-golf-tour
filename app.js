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
  const FLIGHTS_KEY = 'msfs24-world-golf-tour-flights';
  const FLIGHT_COLOR = '#22d3ee';
  const data = TOUR_DATA;
  const CATS = data.categories;
  const okField = data.okField;

  // Build the aircraft list from the fleet definitions
  const AIRCRAFT = []; // { label, cat }
  CATS.forEach(function (cat) {
    const f = data.fleet[cat];
    if (!f || !f.planes) return;
    f.planes.split(',').forEach(function (p) {
      const label = p.trim().replace(/^\+/, '').trim();
      if (!label) return;
      AIRCRAFT.push({ label: label, cat: cat });
    });
  });

  // ---------- State ----------
  let played = new Set();
  let flownAircraft = {}; // courseId -> { ac: label, t: timestamp|null }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Legacy format: plain array of course ids
        played = new Set(parsed.map(Number));
      } else {
        Object.keys(parsed).forEach(function (k) {
          const v = parsed[k];
          flownAircraft[k] = (typeof v === 'string') ? { ac: v, t: null } : v;
        });
        played = new Set(Object.keys(flownAircraft).map(Number));
      }
    }
  } catch (e) { /* ignore */ }

  // One-time remap of saved course ids after the tour was extended from 66 to 80
  // courses (every id >= 18 shifted). Runs only once, then marks itself done.
  const MIGRATED_KEY = 'msfs24-world-golf-tour-v2-migrated';
  const ID_MIGRATION = { 18:22, 19:23, 20:24, 21:25, 22:26, 23:27, 24:28, 25:29, 26:30, 27:31, 28:32, 29:33, 30:34, 31:38, 32:39, 33:40, 34:41, 35:43, 36:44, 37:46, 38:47, 39:48, 40:49, 41:50, 42:53, 43:54, 44:55, 45:56, 46:57, 47:58, 48:59, 49:61, 50:62, 51:63, 52:64, 53:65, 54:66, 55:67, 56:68, 57:69, 58:70, 59:71, 60:72, 61:73, 62:74, 63:77, 64:78, 65:79, 66:80 };
  try {
    if (!localStorage.getItem(MIGRATED_KEY) && localStorage.getItem(STORAGE_KEY)) {
      const mapped = {};
      Object.keys(flownAircraft).forEach(function (k) {
        const id = Number(k);
        mapped[ID_MIGRATION[id] || id] = flownAircraft[k];
      });
      const mPlayed = new Set();
      played.forEach(function (id) { mPlayed.add(ID_MIGRATION[id] || id); });
      flownAircraft = mapped;
      played = mPlayed;
      localStorage.setItem(MIGRATED_KEY, '1');
      savePlayed();
    }
  } catch (e) { /* ignore */ }

  let selectedAircraft = 'all';

  // Logged flights from SimBrief (localStorage)
  let flights = [];
  try {
    const rawFlights = localStorage.getItem(FLIGHTS_KEY);
    if (rawFlights) {
      const parsed = JSON.parse(rawFlights);
      if (Array.isArray(parsed)) flights = parsed;
    }
  } catch (e) { /* ignore */ }
  let flightsVisible = true;
  let flightStyle = 'straight';
  let nextFlightId = flights.reduce(function (m, f) { return Math.max(m, f.id || 0); }, 0) + 1;

  function savePlayed() { localStorage.setItem(STORAGE_KEY, JSON.stringify(flownAircraft)); }
  function saveFlights() { localStorage.setItem(FLIGHTS_KEY, JSON.stringify(flights)); }

  function acName(rec) { return (rec && rec.ac) ? rec.ac : (rec || ''); }

  // ---------- Helpers ----------
  function catOk(obj, cat) {
    if (cat === 'all') return true;
    return !!obj[okField[cat]];
  }

  // Runway of each airport, derived from leg destinations (the tour is one continuous route).
  const airportRunway = {};
  data.legs.forEach(function (l) { airportRunway[l.to] = l.runway; });
  function legFromRunway(l) {
    return (airportRunway[l.from] != null) ? airportRunway[l.from] : l.runway;
  }
  function catOkLeg(l, cat) {
    if (cat === 'all') return true;
    const t = data.thresholds[cat];
    if (!t || t.min == null) return true;
    return Math.min(legFromRunway(l), l.runway) >= t.min;
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

  function fmtDur(min) {
    if (min == null || !isFinite(min) || min <= 0) return '—';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    if (h === 0) return m + 'm';
    if (m === 0) return h + 'h';
    return h + 'h ' + m + 'm';
  }

  function starsHtml(rating) {
    const full = Math.floor(rating);
    let s = '';
    for (let i = 0; i < full; i++) s += '\u2605';
    if (rating - full >= 0.5) s += '\u00BD';
    return s;
  }

  function okChipHtml(cat, ok, isRek) {
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
  const flightGroup = L.layerGroup();

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
        CATS.map(function (cat) { return okChipHtml(cat, catOk(c, cat), c.category === cat); }).join(' ') +
      '</div>';

    if (played.has(c.id)) {
      const rec = flownAircraft[c.id];
      html += '<div class="popup-row popup-flown">Flown' + (rec ? ' with <b>' + acName(rec) + '</b>' : '') + '</div>';
    }

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
    const fromRw = legFromRunway(l);
    return '<div class="popup-title">Leg #' + l.id + ': ' + l.from + ' \u2192 ' + l.to + '</div>' +
      '<div class="popup-sub">' + l.fromName + ' \u2192 ' + l.toName + '</div>' +
      '<div class="popup-row"><b>Distance:</b> ' + fmtNum(l.distance) + ' nm</div>' +
      '<div class="popup-row"><b>Flight time:</b> ' + l.flightTime + ' (' + fmtNum(l.speed) + ' kt)</div>' +
      '<div class="popup-row"><b>Runways:</b> ' + fmtNum(fromRw) + ' ft \u2192 ' + fmtNum(l.runway) + ' ft</div>' +
      (Math.min(fromRw, l.runway) < l.runway
        ? '<div class="popup-row popup-warn" style="border-radius:8px;padding:6px 8px">\u26A0 Takeoff strip (' + fmtNum(fromRw) + ' ft) is the limiting runway</div>'
        : '') +
      '<div class="popup-row"><b>Recommended:</b> ' + l.category + '</div>' +
      '<div class="popup-row"><b>Can fly:</b> ' +
        CATS.map(function (cat) { return okChipHtml(cat, catOkLeg(l, cat), l.category === cat); }).join(' ') +
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
    if (catOkLeg(l, selectedAircraft)) return { color: '#34d399', weight: 2, opacity: 0.7 };
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
    return data.legs.filter(function (l) { return catOkLeg(l, cat); }).length;
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
      captionEl.innerHTML = 'Pick an aircraft to see which courses and routes you can fly. ' +
        '<b class="accent">Gold = recommended aircraft</b>, green = can fly (takeoff + landing), red = cannot.';
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

      const flownEl = document.createElement('div');
      flownEl.className = 'flown-line';
      flownEl.title = 'Change aircraft';

      info.appendChild(name);
      info.appendChild(sub);
      info.appendChild(meta);
      info.appendChild(chipsEl);
      info.appendChild(statusEl);
      info.appendChild(flownEl);

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
      flownEl.addEventListener('click', function (e) {
        e.stopPropagation();
        if (played.has(c.id)) buildAircraftPicker(c, true);
      });

      listEl.appendChild(row);
      courseRows.set(c.id, { row: row, num: num, name: name, chipsEl: chipsEl, statusEl: statusEl, flownEl: flownEl });
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

      entry.chipsEl.innerHTML = CATS.map(function (cat) { return okChipHtml(cat, catOk(c, cat), c.category === cat); }).join(' ');

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

      if (played.has(c.id)) {
        const rec = flownAircraft[c.id];
        entry.flownEl.innerHTML = rec
          ? 'Flown with <b>' + acName(rec) + '</b> <span class="change-hint">\u00B7 change</span>'
          : 'Flown';
      } else {
        entry.flownEl.innerHTML = '';
      }

      const m = courseMarkers.get(c.id);
      if (show && m) { if (!map.hasLayer(m)) m.addTo(map); }
      else if (m) { m.remove(); }
    });
  }

  function refreshCourseVisuals(id) {
    const c = data.courses.find(function (x) { return x.id === id; });
    const m = courseMarkers.get(id);
    if (c && m) {
      m.setIcon(markerIcon(c, played.has(id)));
      m.setPopupContent(coursePopup(c));
    }
    refreshCourseRows();
    refreshLegRows();
    refreshLegSummary();
    updateStats();
  }

  // ---------- Aircraft picker modal ----------
  const modalEl = document.getElementById('aircraft-modal');
  const modalGroupsEl = document.getElementById('modal-groups');

  function closeModal() {
    modalEl.classList.add('hidden');
  }

  function buildAircraftPicker(c, changeMode) {
    const current = changeMode ? flownAircraft[c.id] : null;
    document.querySelector('#aircraft-modal .modal-title').innerHTML = changeMode
      ? 'Change aircraft for <b>' + c.name + '</b>'
      : 'Fly to <b>' + c.name + '</b>';
    document.querySelector('#aircraft-modal .modal-sub').textContent = changeMode
      ? (current ? 'Currently recorded: ' + acName(current) + '. Pick the aircraft you actually flew.' : 'Pick the aircraft you actually flew.')
      : 'Which aircraft did you fly with?';
    modalGroupsEl.innerHTML = '';

    const ordered = [c.category].concat(CATS.filter(function (cat) { return cat !== c.category; }));
    ordered.forEach(function (cat) {
      const planes = AIRCRAFT.filter(function (a) { return a.cat === cat; });
      if (!planes.length) return;
      const group = document.createElement('div');
      group.className = 'modal-group' + (cat === c.category ? ' rek' : '');
      const head = document.createElement('div');
      head.className = 'modal-group-head';
      head.textContent = cat + (cat === c.category ? ' \u00B7 recommended' : '');
      group.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'modal-grid';
      planes.forEach(function (a) {
        const btn = document.createElement('button');
        btn.className = 'modal-ac';
        if (current && acName(current) === a.label) btn.className += ' current';
        btn.textContent = a.label;
        btn.addEventListener('click', function () { confirmPlayed(c.id, a.label); });
        grid.appendChild(btn);
      });
      group.appendChild(grid);
      modalGroupsEl.appendChild(group);
    });

    modalEl.classList.remove('hidden');
  }

  function confirmPlayed(id, aircraft) {
    const prev = flownAircraft[id];
    played.add(id);
    flownAircraft[id] = { ac: aircraft, t: (prev && prev.t) ? prev.t : Date.now() };
    savePlayed();
    closeModal();
    refreshCourseVisuals(id);
  }

  function togglePlayed(id) {
    if (played.has(id)) {
      played.delete(id);
      delete flownAircraft[id];
      savePlayed();
      refreshCourseVisuals(id);
    } else {
      const c = data.courses.find(function (x) { return x.id === id; });
      if (c) buildAircraftPicker(c);
    }
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

  function isLegFlown(l) {
    const c = findCourseByCode(l.to);
    return !!(c && played.has(c.id));
  }

  function nextLegId() {
    for (let i = 0; i < data.legs.length; i++) {
      const c = findCourseByCode(data.legs[i].to);
      if (!c || !played.has(c.id)) return data.legs[i].id;
    }
    return null;
  }

  function refreshLegRows() {
    const hideFlown = document.getElementById('toggle-hide-flown').checked;
    const nextId = nextLegId();
    legRows.forEach(function (entry, i) {
      const l = data.legs[i];
      entry.chipsEl.innerHTML = CATS.map(function (cat) { return okChipHtml(cat, catOkLeg(l, cat), l.category === cat); }).join('');

      let cls = '';
      if (selectedAircraft !== 'all') {
        if (l.category === selectedAircraft) cls = 'status-rek';
        else if (catOkLeg(l, selectedAircraft)) cls = 'status-ok';
        else cls = 'status-no';
      }
      const flown = isLegFlown(l);
      const isNext = !flown && l.id === nextId;
      entry.row.className = 'leg-row' + (cls ? ' ' + cls : '') + (flown ? ' flown' : '') + (isNext ? ' next' : '');
      entry.row.style.display = (flown && hideFlown) ? 'none' : '';
    });
  }

  function refreshLegSummary() {
    let html;
    if (selectedAircraft === 'all') {
      html = 'Total <b>' + data.legs.length + ' legs</b> \u00B7 <b>' + fmtNum(data.stats.distanceNm) + ' nm</b>. ' +
        'Pick an aircraft above to see which legs you can fly.';
    } else {
      const ok = legCount(selectedAircraft);
      const no = data.legs.length - ok;
      html = 'With <b>' + shortOf(selectedAircraft) + '</b> you can do <span class="ok-num">' + ok + '</span> of ' +
        data.legs.length + ' legs' + (no ? ' \u2014 <span class="no-num">' + no + ' cannot be landed</span>' : '') +
        '. Gold = recommended.';
    }
    const nextId = nextLegId();
    const next = nextId != null ? data.legs.find(function (l) { return l.id === nextId; }) : null;
    if (next) {
      html += ' <span class="next-num">\u00BB Next: #' + next.id + ' ' + next.from + ' \u2192 ' + next.to + '</span>';
    } else if (data.legs.length) {
      html += ' <b style="color:var(--accent)">All legs flown!</b>';
    }
    legSummaryEl.innerHTML = html;
  }

  function flyToLeg(id) {
    const l = data.legs.find(function (x) { return x.id === id; });
    const entry = legLayers[id - 1];
    if (!l || !entry) return;
    legRows.forEach(function (e) { e.row.classList.toggle('active', parseInt(e.row.dataset.id) === id); });
    map.flyTo([(l.fromLat + l.toLat) / 2, (l.fromLon + l.toLon) / 2], 6);
    setTimeout(function () { entry.polyline.openPopup(); }, 480);
  }

  // ---------- Stats (topbar) ----------
  function updateStats() {
    const total = data.courses.length;
    const done = data.courses.filter(function (c) { return played.has(c.id); }).length;
    const pct = Math.round(done / total * 100);
    document.getElementById('stat-played').textContent = done + '/' + total;
    document.getElementById('stat-completion').textContent = pct + '%';
    document.getElementById('stat-distance').textContent = fmtNum(data.stats.distanceNm) + ' nm';
    document.getElementById('stat-time').textContent = fmtTime(data.stats.flightTimeH);
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
    if (flights.length) {
      html += '<div class="ml-row" style="margin-top:6px"><span class="line" style="background:' + FLIGHT_COLOR + '"></span> My flights (' + flights.length + ')</div>';
    }
    mapLegendEl.innerHTML = html;
    mapLegendEl.classList.add('show');
  }

  // ---------- Logged flights (SimBrief) ----------
  const flightModalEl = document.getElementById('flight-modal');
  const fmErrorEl = document.getElementById('fm-error');
  const fmPreviewEl = document.getElementById('fm-preview');
  let pendingFlight = null;

  function showFmError(msg) {
    fmErrorEl.textContent = msg;
    fmErrorEl.classList.remove('hidden');
  }
  function clearFmError() {
    fmErrorEl.textContent = '';
    fmErrorEl.classList.add('hidden');
  }

  function openFlightModal() {
    clearFmError();
    fmPreviewEl.classList.add('hidden');
    fmPreviewEl.innerHTML = '';
    pendingFlight = null;
    const saved = localStorage.getItem('msfs24-world-golf-tour-simbrief');
    if (saved) document.getElementById('fm-username').value = saved;
    flightModalEl.classList.remove('hidden');
  }
  function closeFlightModal() {
    flightModalEl.classList.add('hidden');
    pendingFlight = null;
  }

  function rememberSimbriefId(val) {
    if (val) localStorage.setItem('msfs24-world-golf-tour-simbrief', val);
  }

  function flightPopupHtml(f) {
    const hdr = (f.legId ? 'Leg #' + f.legId + ' \u00B7 ' : '') + f.from + ' \u2192 ' + f.to;
    return '<div class="popup-title">' + hdr + '</div>' +
      '<div class="popup-sub">Logged flight #' + f.id + ' \u00B7 SimBrief</div>' +
      (f.aircraft ? '<div class="popup-row"><b>Aircraft:</b> ' + f.aircraft + '</div>' : '') +
      '<div class="popup-row"><b>Distance:</b> ' + fmtNum(Math.round(f.distanceNm)) + ' nm</div>' +
      '<div class="popup-row"><b>Time:</b> ' + fmtDur(f.timeMin) + '</div>' +
      '<div class="popup-row"><b>Logged:</b> ' + new Date(f.t).toLocaleString() + '</div>';
  }

  function rebuildFlightsLayer() {
    flightGroup.clearLayers();
    flights.forEach(function (f) {
      if (!f.path || !f.path.length) return;
      const latlngs = f.path.map(function (p) { return [p.lat, p.lon]; });
      const lineLatlngs = (flightStyle === 'full' || latlngs.length < 2)
        ? latlngs
        : [latlngs[0], latlngs[latlngs.length - 1]];
      const weight = flightStyle === 'full' ? 3 : 2.5;
      const pl = L.polyline(lineLatlngs, { color: FLIGHT_COLOR, weight: weight, opacity: 0.85 });
      const start = L.circleMarker(latlngs[0], { radius: 4, color: '#0a0f1a', weight: 2, fillColor: FLIGHT_COLOR, fillOpacity: 1 });
      const end = L.circleMarker(latlngs[latlngs.length - 1], { radius: 5, color: '#0a0f1a', weight: 2, fillColor: FLIGHT_COLOR, fillOpacity: 1 });
      const popup = flightPopupHtml(f);
      pl.bindPopup(popup);
      start.bindPopup(popup);
      end.bindPopup(popup);
      flightGroup.addLayer(pl);
      flightGroup.addLayer(start);
      flightGroup.addLayer(end);
    });
    if (flightsVisible && flights.length) {
      if (!map.hasLayer(flightGroup)) flightGroup.addTo(map);
    } else {
      map.removeLayer(flightGroup);
    }
  }

  function findLegFor(from, to) {
    return data.legs.find(function (l) { return l.from === from && l.to === to; }) || null;
  }
  function hubCode(c) { return (c.hub || '').split(' ')[0].toUpperCase(); }
  function closerCode(c) { return (c.closer || '').split(' ')[0].toUpperCase(); }
  function findCourseByCode(icao) {
    if (!icao) return null;
    const ic = String(icao).toUpperCase().trim();
    let byHub = null, byCloser = null;
    for (let i = 0; i < data.courses.length; i++) {
      const c = data.courses[i];
      if (c.arrival === ic) return c;
      if (!byHub && hubCode(c) === ic) byHub = c;
      if (!byCloser && closerCode(c) === ic) byCloser = c;
    }
    return byHub || byCloser;
  }

  function matchFleetAircraft(name) {
    if (!name) return null;
    const n = name.toLowerCase();
    let best = null, bestLen = 0;
    AIRCRAFT.forEach(function (a) {
      const l = a.label.toLowerCase();
      if (n.indexOf(l) !== -1 || l.indexOf(n) !== -1) {
        if (l.length > bestLen) { best = a.label; bestLen = l.length; }
      }
    });
    return best;
  }

  function markCoursePlayedFromFlight(course, aircraft, aircraftIcao) {
    const fleet = matchFleetAircraft(aircraft);
    const label = fleet || aircraftIcao || aircraft || course.category;
    const prev = flownAircraft[course.id];
    played.add(course.id);
    flownAircraft[course.id] = { ac: label, t: (prev && prev.t) ? prev.t : Date.now(), icao: fleet ? '' : (aircraftIcao || '') };
    savePlayed();
    refreshCourseVisuals(course.id);
  }

  function reconcileFlightsWithCourses() {
    flights.forEach(function (f) {
      if (!f.to) return;
      const course = findCourseByCode(f.to);
      if (course && !played.has(course.id)) {
        markCoursePlayedFromFlight(course, f.aircraft || '', f.icao || '');
      }
    });
  }

  function parseHMM(s) {
    if (!s) return 0;
    const m = String(s).match(/(\d+):(\d+)/);
    if (!m) return 0;
    return (+m[1]) * 60 + (+m[2]);
  }

  function parseSimbriefJson(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const g = obj.general || {};
    const orig = obj.origin || {};
    const dest = obj.destination || {};
    const times = obj.times || {};
    const ac = obj.aircraft || {};
    const nav = obj.navlog;
    let fixes = [];
    if (Array.isArray(nav)) fixes = nav;
    else if (nav && Array.isArray(nav.fix)) fixes = nav.fix;
    else if (nav && nav.fix && typeof nav.fix === 'object') fixes = [nav.fix];
    const path = [];
    fixes.forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      const lat = parseFloat(f.pos_lat);
      const lon = parseFloat(f.pos_long);
      if (!isNaN(lat) && !isNaN(lon)) path.push({ lat: lat, lon: lon, ident: f.ident, name: f.name });
    });
    const api = obj.api_params || {};
    return {
      from: String(orig.icao_code || g.origin || api.orig || '').toUpperCase(),
      to: String(dest.icao_code || g.destination || api.dest || '').toUpperCase(),
      aircraft: g.aircraft || ac.name || ac.base_type || ac.icaocode || '',
      aircraftIcao: ac.icaocode || '',
      dist: parseFloat(g.route_distance) || 0,
      timeMin: parseHMM(times.est_time_enroute || g.est_time_enroute),
      path: path,
      wpts: path.map(function (p) { return p.ident; })
    };
  }

  function parseSimbriefXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const gen = doc.querySelector('general');
    const q = function (sel) { const n = gen ? gen.querySelector(sel) : null; return n ? n.textContent.trim() : ''; };
    const path = [];
    doc.querySelectorAll('fix').forEach(function (fx) {
      const latEl = fx.querySelector('pos_lat');
      const lonEl = fx.querySelector('pos_long');
      const lat = parseFloat(latEl ? latEl.textContent : '');
      const lon = parseFloat(lonEl ? lonEl.textContent : '');
      if (!isNaN(lat) && !isNaN(lon)) {
        path.push({ lat: lat, lon: lon, ident: (fx.querySelector('ident') ? fx.querySelector('ident').textContent : '').trim() });
      }
    });
    return {
      from: q('origin').toUpperCase(),
      to: q('destination').toUpperCase(),
      aircraft: q('aircraft'),
      dist: parseFloat(q('route_distance')) || 0,
      timeMin: parseHMM(q('est_time_enroute')),
      path: path,
      wpts: path.map(function (p) { return p.ident; })
    };
  }

  function buildFlightPreview(parsed, source) {
    const leg = findLegFor(parsed.from, parsed.to);
    const course = findCourseByCode(parsed.to);
    let html =
      '<div class="fm-preview-row"><b>' + parsed.from + ' \u2192 ' + parsed.to + '</b></div>' +
      (parsed.aircraft ? '<div class="fm-preview-row">Aircraft: ' + parsed.aircraft + '</div>' : '') +
      '<div class="fm-preview-row">' + fmtNum(Math.round(parsed.dist)) + ' nm \u00B7 ' + fmtDur(parsed.timeMin) +
        ' \u00B7 ' + parsed.path.length + ' waypoints</div>';
    if (course) {
      html += '<div class="fm-match">\u2713 Destination matches tour course <b>' + course.name + '</b>' +
        (leg ? ' (Leg #' + leg.id + ')' : '') + '</div>' +
        '<label class="fm-check-row"><input type="checkbox" id="fm-check" checked> Check off <b>' + course.name + '</b> as played</label>';
    } else {
      html += '<div class="fm-match no">Destination is not a tour course \u2014 the flight will only be drawn on the map.</div>';
    }
    html += '<div class="modal-actions"><button id="fm-save" class="btn-primary">Save flight</button></div>';
    fmPreviewEl.innerHTML = html;
    fmPreviewEl.classList.remove('hidden');
    pendingFlight = { parsed: parsed, leg: leg, course: course, source: source };
  }

  function savePendingFlight() {
    const p = pendingFlight;
    if (!p) return;
    const f = {
      id: nextFlightId++,
      legId: p.leg ? p.leg.id : null,
      from: p.parsed.from,
      to: p.parsed.to,
      aircraft: p.parsed.aircraft,
      icao: p.parsed.aircraftIcao || '',
      t: Date.now(),
      distanceNm: p.parsed.dist,
      timeMin: p.parsed.timeMin,
      path: p.parsed.path,
      wpts: p.parsed.wpts,
      source: p.source
    };
    flights.push(f);
    saveFlights();
    rebuildFlightsLayer();
    updateMapLegend();
    const checkEl = document.getElementById('fm-check');
    if (p.course && (!checkEl || checkEl.checked)) {
      markCoursePlayedFromFlight(p.course, p.parsed.aircraft, p.parsed.aircraftIcao);
    }
    closeFlightModal();
  }

  function fetchPlan(params) {
    const url = 'https://www.simbrief.com/api/xml.fetcher.php?' + params;
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) {
        return r.json().then(function (body) {
          const msg = (body && body.fetch && body.fetch.status) ? body.fetch.status : ('HTTP ' + r.status);
          throw new Error(msg);
        }, function () {
          throw new Error('SimBrief returned HTTP ' + r.status);
        });
      }
      return r.json();
    }).then(function (obj) {
      const item = Array.isArray(obj) ? obj[0] : obj;
      const st = (item && item.fetch && item.fetch.status) || '';
      if (/error/i.test(st)) throw new Error(st);
      const parsed = parseSimbriefJson(item);
      if (!parsed || !parsed.from || !parsed.to) {
        const keys = Object.keys(item || {}).join(', ');
        throw new Error('No flight plan found for this user.' + (keys ? ' (Got keys: ' + keys + ')' : ''));
      }
      return parsed;
    });
  }

  function handleFetch() {
    const u = document.getElementById('fm-username').value.trim();
    const fn = document.getElementById('fm-flightnum').value.trim();
    if (!u) { showFmError('Enter your SimBrief username or Pilot ID first.'); return; }
    clearFmError();
    const who = /^\d+$/.test(u) ? 'userid=' + encodeURIComponent(u) : 'username=' + encodeURIComponent(u);
    const btn = document.getElementById('fm-fetch');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Fetching\u2026';
    const fail = function (err) {
      btn.disabled = false;
      btn.textContent = orig;
      showFmError('Could not fetch: ' + err.message + '. If you have a plan, try pasting the XML below.');
    };
    fetchPlan(who + '&json=v2' + (fn ? '&flightnumber=' + encodeURIComponent(fn) : ''))
      .then(function (parsed) { rememberSimbriefId(u); buildFlightPreview(parsed, 'simbrief'); })
      .catch(function (err) {
        if (fn) {
          fetchPlan(who + '&json=v2')
            .then(function (parsed) { rememberSimbriefId(u); buildFlightPreview(parsed, 'simbrief'); })
            .catch(function (err2) {
              btn.disabled = false;
              btn.textContent = orig;
              showFmError('Could not fetch (tried with and without flight number): ' + err2.message +
                '. If you have a plan, try pasting the XML below.');
            });
        } else {
          fail(err);
        }
      });
  }

  function handlePasteXml() {
    const text = document.getElementById('fm-paste').value.trim();
    if (!text) { showFmError('Paste the SimBrief XML first.'); return; }
    clearFmError();
    try {
      const parsed = parseSimbriefXml(text);
      if (!parsed.from || !parsed.to) throw new Error('Could not find a flight plan in that XML.');
      buildFlightPreview(parsed, 'xml');
    } catch (e) {
      showFmError('Could not parse XML: ' + e.message);
    }
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

  document.getElementById('toggle-flights').addEventListener('change', function () {
    flightsVisible = this.checked;
    if (flightsVisible && flights.length) {
      if (!map.hasLayer(flightGroup)) flightGroup.addTo(map);
    } else {
      map.removeLayer(flightGroup);
    }
  });

  document.getElementById('reset-all').addEventListener('click', function () {
    if (!confirm('Reset all progress? This clears your checklist AND all logged flights (map lines and flight stats).')) return;
    played.clear();
    flownAircraft = {};
    savePlayed();
    flights = [];
    saveFlights();
    flightGroup.clearLayers();
    flightsVisible = false;
    document.getElementById('toggle-flights').checked = false;
    map.removeLayer(flightGroup);
    data.courses.forEach(function (c) {
      const m = courseMarkers.get(c.id);
      if (m) m.setIcon(markerIcon(c, false));
    });
    refreshCourseRows();
    refreshLegRows();
    refreshLegSummary();
    updateStats();
  });

  document.getElementById('toggle-hide-flown').addEventListener('change', refreshLegRows);

  document.getElementById('flight-style').addEventListener('change', function () {
    flightStyle = this.value;
    rebuildFlightsLayer();
  });

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  modalEl.addEventListener('click', function (e) { if (e.target === modalEl) closeModal(); });

  document.getElementById('log-flight').addEventListener('click', openFlightModal);
  document.getElementById('fm-fetch').addEventListener('click', handleFetch);
  document.getElementById('fm-paste-btn').addEventListener('click', handlePasteXml);
  document.getElementById('fm-cancel').addEventListener('click', closeFlightModal);
  flightModalEl.addEventListener('click', function (e) { if (e.target === flightModalEl) closeFlightModal(); });
  fmPreviewEl.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'fm-save') savePendingFlight();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !flightModalEl.classList.contains('hidden')) closeFlightModal();
    else if (e.key === 'Escape' && !modalEl.classList.contains('hidden')) closeModal();
  });

  // ---------- Init ----------
  buildAircraftPills();
  buildCourseList();
  buildLegList();
  buildSidebarLegend();
  updateCaption();
  reconcileFlightsWithCourses();
  refreshCourseRows();
  refreshLegRows();
  refreshLegSummary();
  updateMapLegend();
  updateStats();
  rebuildFlightsLayer();
})();
