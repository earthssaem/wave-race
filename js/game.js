/* ============================================================
 * 파도 레이스 — 진행·화면 (js/game.js)
 * 패독 → 베팅 → 레이스 → 정산 → 도감 → 다음 경기
 * ============================================================ */
(function () {
  'use strict';

  const P = window.Physics, R = window.Races, O = window.Otter;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const $ = (sel, root) => (root || document).querySelector(sel);

  /* ---------- 유틸 ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    for (const c of children) if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  }
  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const fmtNum = n => Math.round(n).toLocaleString('ko-KR');
  function fmtTime(sec) {
    if (sec == null || !isFinite(sec)) return '—';
    const s = Math.round(sec);
    if (s < 60) return `${s}초`;
    if (s < 3600) return `${Math.floor(s / 60)}분 ${s % 60}초`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
    return `${Math.floor(s / 86400)}일 ${Math.floor((s % 86400) / 3600)}시간`;
  }
  function fmtClock(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return `${h}시간 ${String(m).padStart(2, '0')}분`;
  }
  function fmtSpeed(c) {
    if (c >= 50) return `${Math.round(c)} m/s`;
    return `${c.toFixed(1)} m/s`;
  }
  function fmtDist(m) {
    if (m >= 100000) return `${fmtNum(m / 1000)} km`;
    return `${fmtNum(m)} m`;
  }
  function fmtDepth(h) {
    if (h >= 1000) return `${fmtNum(h / 1000)} km`;
    if (h >= 10) return `${Math.round(h)} m`;
    return `${(Math.round(h * 10) / 10)} m`;
  }
  const wait = ms => new Promise(res => setTimeout(res, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- 저장 (도감·진행도만) ---------- */
  const STORE_KEY = 'waveRace.progress.v1';
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') return { cleared: p.cleared || {}, codex: p.codex || {} };
      }
    } catch (e) { /* 저장소 사용 불가 — 무시 */ }
    return { cleared: {}, codex: {} };
  }
  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* 무시 */ }
  }
  function resetProgress() {
    progress = { cleared: {}, codex: {} };
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 무시 */ }
  }
  let progress = loadProgress();

  /* ---------- 세션 (화면에만, 저장 안 함) ---------- */
  const session = { points: 0, streak: 0, results: [], speed: 1 };

  /* ---------- DOM ---------- */
  const app = $('#app'), topbar = $('#topbar'), casterBar = $('#casterBar');
  const bubbleText = $('#bubbleText'), actionsEl = $('#actions'), overlay = $('#overlay');
  const tbWorld = $('#tbWorld'), tbRace = $('#tbRace'), tbPoints = $('#tbPoints');

  $('#btnHome').addEventListener('click', () => { Flow.abort(); showTitle(); });
  $('#btnCodex').addEventListener('click', () => { const back = Flow.current ? () => Flow.current.resume() : showTitle; showCodex(back); });
  $('#btnTheme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.getAttribute('data-theme') !== 'dark';
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    $('#btnTheme').textContent = dark ? '☀️' : '🌙';
  });

  function setTopbar(worldName, raceName) {
    tbWorld.textContent = worldName || '';
    tbRace.textContent = raceName || '';
  }
  function setChrome({ top = true, caster = true } = {}) {
    topbar.hidden = !top;
    casterBar.hidden = !caster;
  }
  function setActions(...buttons) {
    actionsEl.innerHTML = '';
    for (const b of buttons) if (b) actionsEl.appendChild(b);
  }
  function btn(label, onClick, cls) {
    return el('button', { type: 'button', class: 'btn ' + (cls || ''), onclick: onClick }, label);
  }
  function renderPoints() { tbPoints.textContent = fmtNum(session.points); }
  function awardPoints(n) {
    if (!n) return;
    session.points += n;
    renderPoints();
    tbPoints.classList.remove('bump'); void tbPoints.offsetWidth; tbPoints.classList.add('bump');
    const rect = tbPoints.getBoundingClientRect();
    const pop = el('div', { class: 'point-pop' }, `+${n}`);
    pop.style.left = (rect.left + rect.width / 2) + 'px';
    pop.style.top = (rect.bottom + 6) + 'px';
    overlay.appendChild(pop);
    setTimeout(() => pop.remove(), 1300);
  }

  /* ---------- 해달 캐스터 ---------- */
  const Caster = {
    queue: [], busyUntil: 0,
    say(text) {
      if (!text) return;
      this.queue.length = 0;
      this._show(text);
      this.busyUntil = performance.now() + 1200;
    },
    event(text, hold) {
      if (!text) return;
      if (this.queue.length >= 3) this.queue.shift();
      this.queue.push({ text, hold: hold || 1800 });
    },
    _show(text) {
      bubbleText.textContent = text;
      bubbleText.classList.remove('pop'); void bubbleText.offsetWidth; bubbleText.classList.add('pop');
    },
    tick() {
      const now = performance.now();
      if (this.queue.length && now >= this.busyUntil) {
        const m = this.queue.shift();
        this._show(m.text);
        this.busyUntil = now + m.hold;
      }
    },
  };
  setInterval(() => Caster.tick(), 120);
  const line = (key, ctx, raceId) => O.pick(key, ctx, raceId);

  /* ---------- 카운트다운 ---------- */
  async function countdown() {
    const steps = ['3', '2', '1', '출발!'];
    for (const s of steps) {
      overlay.innerHTML = '';
      const d = el('div', { class: 'countdown' }, s);
      overlay.appendChild(d);
      await wait(reduceMotion ? 550 : 800);
    }
    overlay.innerHTML = '';
  }

  /* ---------- 코스 단면 SVG (패독·편집기·도감용) ---------- */
  function depthMapper(hMax, y0, yMax) {
    const denom = Math.log(1 + hMax / 0.5);
    const span = yMax - y0 - 6;
    return h => y0 + 6 + span * Math.log(1 + Math.max(h, 0) / 0.5) / denom;
  }
  function courseSVG(bathy, length, opts = {}) {
    const vw = 1000, vh = opts.vh || 160, pad = 14, y0 = Math.round(vh * 0.3);
    const svg = svgEl('svg', { viewBox: `0 0 ${vw} ${vh}`, class: opts.class || 'course-svg', role: 'img', 'aria-label': '코스 단면' });
    const hMax = P.maxDepth(bathy);
    const yOf = depthMapper(hMax, y0, vh);
    const px = x => pad + x / length * (vw - 2 * pad);
    svgEl('rect', { x: 0, y: y0, width: vw, height: vh - y0, fill: 'var(--sea)' }, svg);
    let d = `M0,${vh} L0,${yOf(bathy[0][1])}`;
    for (let x = 0; x <= length; x += length / 200) d += ` L${px(x).toFixed(1)},${yOf(P.depthAt(bathy, x)).toFixed(1)}`;
    d += ` L${vw},${yOf(bathy[bathy.length - 1][1]).toFixed(1)} L${vw},${vh} Z`;
    svgEl('path', { d, fill: 'var(--sand)', stroke: 'var(--sand-3)', 'stroke-width': 1.5 }, svg);
    svgEl('line', { x1: 0, y1: y0, x2: vw, y2: y0, stroke: 'var(--sea-deep)', 'stroke-width': 1.5 }, svg);
    svgEl('line', { x1: px(length), y1: y0 - 12, x2: px(length), y2: vh, class: 'finish', stroke: 'var(--coral)', 'stroke-width': 3, 'stroke-dasharray': '8 6' }, svg);
    if (opts.window) {
      const [a, b] = opts.window;
      svgEl('rect', { x: px(a), y: y0 - 12, width: px(b) - px(a), height: vh - y0 + 12, fill: 'var(--sun)', opacity: .35 }, svg);
      const t = svgEl('text', { x: (px(a) + px(b)) / 2, y: y0 - 16, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--coral-2)', 'font-family': 'Jua, sans-serif' }, svg);
      t.textContent = '목표 쇄파 구간';
    }
    if (opts.startLine) {
      svgEl('line', { x1: px(opts.startLine), y1: y0 - 10, x2: px(opts.startLine), y2: vh, stroke: 'var(--ink-2)', 'stroke-width': 2, 'stroke-dasharray': '4 4' }, svg);
    }
    // 수심 눈금(최소한): 시작·끝 수심
    const t1 = svgEl('text', { x: 8, y: yOf(bathy[0][1]) - 4, 'font-size': 12, fill: 'var(--ink-2)', 'font-family': 'Noto Sans KR, sans-serif' }, svg);
    t1.textContent = `수심 ${fmtDepth(bathy[0][1])}`;
    const t2 = svgEl('text', { x: vw - 8, y: yOf(bathy[bathy.length - 1][1]) - 4, 'text-anchor': 'end', 'font-size': 12, fill: 'var(--ink-2)', 'font-family': 'Noto Sans KR, sans-serif' }, svg);
    t2.textContent = `${fmtDepth(bathy[bathy.length - 1][1])}`;
    const t3 = svgEl('text', { x: px(length) - 8, y: y0 - 6, 'text-anchor': 'end', 'font-size': 12, fill: 'var(--ink-2)', 'font-family': 'Noto Sans KR, sans-serif' }, svg);
    t3.textContent = `${fmtDist(length)} 결승선`;
    return svg;
  }

  /* ============================================================
   * 레이스 화면 (레인 · 파열 · 깃발 · 뱃지 · 격차 미터)
   * ============================================================ */
  function laneSpecText(race, laneSpec, wave) {
    const parts = [];
    if (race.hideLambda) parts.push(`T = ${laneSpec.wave.T} s`);
    else parts.push(`λ₀ ${fmtDist(wave.lambda0)}`);
    if (laneSpec.courseName) parts.push(laneSpec.courseName);
    return parts.join(' · ');
  }
  const REGIME_LABEL = { deep: '심해파', transition: '천이 구간', shallow: '천해파', broken: '쇄파', finished: '골인' };

  class RaceView {
    constructor(container, race, heat, sim) {
      this.container = container; this.race = race; this.heat = heat; this.sim = sim;
      this.lanes = [];
      this.gapHistory = [];
      this.maxGap = 0;
      this.lastHeadUpdate = 0;
      this.build();
      this._onResize = () => { clearTimeout(this._rt); this._rt = setTimeout(() => this.rebuildSVGs(), 150); };
      window.addEventListener('resize', this._onResize);
    }
    destroy() { window.removeEventListener('resize', this._onResize); clearTimeout(this._rt); }

    build() {
      const race = this.race, heat = this.heat;
      const top = el('div', { class: 'race-top' });
      if (heat.label) top.appendChild(el('div', { class: 'heat-label' }, heat.label));
      this.gapEl = el('div', { class: 'gap-meter', role: 'status' },
        el('span', { class: 'label' }, '격차 미터'),
        el('div', { class: 'bar' }, el('i')),
        el('span', { class: 'val' }, '0 m'));
      this.gapBar = $('.bar > i', this.gapEl); this.gapVal = $('.val', this.gapEl);
      top.appendChild(this.gapEl);
      if (race.clock) { this.clockEl = el('div', { class: 'race-clock num' }, '경과 0시간 00분'); top.appendChild(this.clockEl); }
      this.container.appendChild(top);
      if (race.scaleNote) this.container.appendChild(el('div', { class: 'scale-note' }, race.scaleNote));
      const lanesEl = el('div', { class: 'lanes' });
      lanesEl.style.setProperty('--lane-count', String(this.sim.lanes.length));
      this.container.appendChild(lanesEl);
      this.sim.lanes.forEach((ln, i) => {
        const spec = heat.lanes[i];
        const head = el('div', { class: 'lane-head' },
          el('span', { class: 'emoji' }, ln.wave.emoji || '🌊'),
          el('span', { class: 'name' }, ln.wave.name),
          el('span', { class: 'spec' }, laneSpecText(race, spec, ln.wave) + (spec.start ? ` · ${fmtNum(spec.start)} m 앞 출발` : '')),
          el('span', { class: 'stat' }, el('span', { class: 'badge deep' }, '심해파'), el('span', { class: 'speed num' }, '')));
        const laneEl = el('div', { class: 'lane' }, head);
        lanesEl.appendChild(laneEl);
        const lv = { ln, spec, laneEl, badge: $('.badge', head), speed: $('.speed', head), svg: null };
        this.lanes.push(lv);
      });
      this.rebuildSVGs();
    }

    rebuildSVGs() {
      for (const lv of this.lanes) {
        if (lv.svg) lv.svg.remove();
        this.buildLaneSVG(lv);
      }
      this.draw(performance.now(), true);
    }

    buildLaneSVG(lv) {
      const { ln } = lv;
      const svg = svgEl('svg', { class: 'lane-svg', 'aria-hidden': 'true' });
      lv.laneEl.appendChild(svg);
      const cssW = Math.max(200, svg.clientWidth || 800), cssH = Math.max(60, svg.clientHeight || 150);
      const vw = 1000, vh = Math.round(vw * cssH / cssW);
      svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
      const pad = 14, L = this.sim.length;
      const pxPerM = (vw - 2 * pad) / L;
      const y0 = Math.round(vh * 0.42);
      const hPx = (this.race.hPx || 14) * (vh / 187);      // 파고 1 m당 px
      const lminUnits = 22 * vw / cssW;                     // 화면상 최소 파장(약 22 css px)
      const hMax = P.maxDepth(ln.bathy);
      const yOf = depthMapper(hMax, y0, vh);
      const xToPx = x => pad + x * pxPerM;
      // 룩업 테이블 (2 단위 간격)
      const n = Math.floor(vw / 2) + 1;
      const kDisp = new Float32Array(n), Hpx = new Float32Array(n), brokenAmp = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const X = clamp((2 * i - pad) / pxPerM, 0, L);
        const h = P.depthAt(ln.bathy, X);
        const st = P.waveState(ln.wave, h);
        const lamPx = Math.max(st.lambda * pxPerM, lminUnits);
        kDisp[i] = P.TWO_PI / lamPx;
        Hpx[i] = Math.min(st.H, P.BREAK_RATIO * h) * hPx;
        brokenAmp[i] = P.BREAK_RATIO * h * hPx * 0.5 * 0.75;
      }
      lv.geom = { vw, vh, pad, pxPerM, y0, hPx, xToPx, kDisp, Hpx, brokenAmp, n, yOf };

      // 물 → 해수면 선 → 거품 → 모래 → 선 → 깃발
      lv.water = svgEl('path', { class: 'water' }, svg);
      lv.surface = svgEl('path', { class: 'surface' }, svg);
      lv.foam = svgEl('path', { class: 'foam' }, svg);
      lv.foamDots = svgEl('path', { class: 'foam-dots' }, svg);
      let d = `M0,${vh} L0,${yOf(P.depthAt(ln.bathy, 0)).toFixed(1)}`;
      for (let px = 0; px <= vw; px += 4) {
        const X = clamp((px - pad) / pxPerM, 0, L);
        d += ` L${px},${yOf(P.depthAt(ln.bathy, X)).toFixed(1)}`;
      }
      d += ` L${vw},${vh} Z`;
      svgEl('path', { class: 'sand', d }, svg);
      if (this.race.design && this.race.design.window && ln.wave.name === '너울') {
        const [a, b] = this.race.design.window;
        svgEl('rect', { class: 'window', x: xToPx(a), y: 0, width: xToPx(b) - xToPx(a), height: vh }, svg);
      }
      if (ln.start > 0) svgEl('line', { class: 'start', x1: xToPx(ln.start), y1: 4, x2: xToPx(ln.start), y2: vh }, svg);
      svgEl('line', { class: 'finish', x1: xToPx(L), y1: 4, x2: xToPx(L), y2: vh }, svg);
      const t1 = svgEl('text', { class: 'tick', x: 4, y: vh - 4 }, svg); t1.textContent = fmtDepth(P.depthAt(ln.bathy, 0));
      const t2 = svgEl('text', { class: 'tick', x: vw - 4, y: vh - 4, 'text-anchor': 'end' }, svg); t2.textContent = fmtDepth(P.depthAt(ln.bathy, L));
      lv.fx = svgEl('g', {}, svg);
      const flag = svgEl('g', { class: 'flag' }, svg);
      svgEl('line', { class: 'flag-pole', x1: 0, y1: 0, x2: 0, y2: -34 }, flag);
      svgEl('path', { class: 'flag-cloth', d: 'M0,-34 L24,-27 L0,-20 Z' }, flag);
      const fe = svgEl('text', { class: 'flag-emoji', x: -9, y: -38 }, flag); fe.textContent = ln.wave.emoji || '🌊';
      lv.flag = flag;
      lv.svg = svg;
    }

    drawLane(lv) {
      const { ln, geom } = lv;
      const { vw, vh, y0, xToPx, kDisp, Hpx, brokenAmp, n } = geom;
      const frontPx = xToPx(ln.x);
      const tailPx = xToPx(ln.start);
      const brokenPx = ln.broken ? xToPx(ln.brokenAt) : Infinity;
      const STEP = 2;
      const pts = [];
      let foam = '', foamStarted = false;
      let phase = 0;
      let crestY = y0;
      for (let px = frontPx; px >= tailPx - 0.001; px -= STEP) {
        const i = clamp(Math.round(px / 2), 0, n - 1);
        const isBroken = px >= brokenPx;
        let A = isBroken ? brokenAmp[i] : Hpx[i] / 2;
        const taper = Math.min(1, (px - tailPx + STEP) / 40);
        A = Math.min(A * taper, y0 - 6);
        const y = y0 - A * Math.cos(phase);
        if (px === frontPx) crestY = y;
        pts.push(px.toFixed(1) + ',' + y.toFixed(1));
        if (isBroken) { foam += (foamStarted ? ' L' : 'M') + px.toFixed(1) + ',' + y.toFixed(1); foamStarted = true; }
        phase += kDisp[i] * STEP;
      }
      pts.reverse();
      const surf = pts.length ? 'M' + pts.join(' L') : '';
      lv.water.setAttribute('d', `M0,${y0} L${tailPx.toFixed(1)},${y0} ${pts.length ? 'L' + pts.join(' L') : ''} L${vw},${y0} L${vw},${vh} L0,${vh} Z`);
      lv.surface.setAttribute('d', `M0,${y0} L${tailPx.toFixed(1)},${y0} ${pts.length ? 'L' + pts.join(' L') : ''} L${vw},${y0}`);
      lv.foam.setAttribute('d', foam);
      lv.foamDots.setAttribute('d', foam);
      lv.flag.setAttribute('transform', `translate(${frontPx.toFixed(1)},${crestY.toFixed(1)})`);
      void surf;
    }

    draw(now, force) {
      for (const lv of this.lanes) this.drawLane(lv);
      // 격차 미터
      const gap = this.sim.gap();
      if (gap > this.maxGap) this.maxGap = gap;
      this.gapBar.style.width = Math.min(100, gap / this.sim.length * 100).toFixed(1) + '%';
      this.gapHistory.push({ t: now, gap });
      while (this.gapHistory.length > 40 && now - this.gapHistory[0].t > 700) this.gapHistory.shift();
      const old = this.gapHistory[0];
      let trend = '';
      if (old && now - old.t > 300) {
        if (gap > old.gap + this.sim.length * 0.002) trend = ' <span class="trend open">▲ 벌어짐</span>';
        else if (gap < old.gap - this.sim.length * 0.002) trend = ' <span class="trend close">▼ 좁혀짐</span>';
      }
      this.gapVal.innerHTML = esc(fmtDist(gap)) + trend;
      if (this.clockEl) this.clockEl.textContent = '경과 ' + fmtClock(this.sim.t);
      if (force || now - this.lastHeadUpdate > 120) {
        this.lastHeadUpdate = now;
        for (const lv of this.lanes) {
          const ln = lv.ln;
          const reg = ln.finished ? 'finished' : ln.regime;
          lv.badge.className = 'badge ' + reg;
          lv.badge.textContent = REGIME_LABEL[reg] || reg;
          if (ln.finished) lv.speed.innerHTML = `<small>${ln.rank}위</small> ${esc(fmtTime(ln.finishTime))}`;
          else lv.speed.innerHTML = esc(fmtSpeed(ln.c)) + (ln.c >= 50 ? `<br><small>${fmtNum(ln.c * 3.6)} km/h</small>` : '');
        }
      }
    }

    wipeout(ln) {
      const lv = this.lanes[ln.index]; if (!lv) return;
      const { xToPx, y0 } = lv.geom;
      const x = xToPx(ln.brokenAt);
      const g = svgEl('g', {}, lv.fx);
      const t = svgEl('text', { class: 'wipeout' + (reduceMotion ? '' : ' wipeout-anim'), x: Math.min(x, lv.geom.vw - 150), y: y0 - 30, 'text-anchor': 'middle' }, g);
      t.setAttribute('x', clamp(x, 90, lv.geom.vw - 90));
      t.textContent = '🏄 WIPEOUT!';
      t.style.transformOrigin = `${clamp(x, 90, lv.geom.vw - 90)}px ${y0 - 30}px`;
      for (let i = 0; i < 8; i++) {
        const c = svgEl('circle', { class: 'bubble' + (reduceMotion ? '' : ' bubble-anim'), cx: x + (Math.random() - 0.5) * 50, cy: y0 - 4 - Math.random() * 14, r: 3 + Math.random() * 5 }, g);
        c.style.transformOrigin = `${c.getAttribute('cx')}px ${c.getAttribute('cy')}px`;
      }
      if (!reduceMotion) { lv.laneEl.classList.remove('shake'); void lv.laneEl.offsetWidth; lv.laneEl.classList.add('shake'); }
      setTimeout(() => g.remove(), 1800);
    }

    spray(ln) {
      const lv = this.lanes[ln.index]; if (!lv) return;
      const { xToPx, y0, vw } = lv.geom;
      const x = xToPx(this.sim.length);
      const g = svgEl('g', {}, lv.fx);
      for (let i = 0; i < 14; i++) {
        const c = svgEl('circle', { class: 'spray' + (reduceMotion ? '' : ' spray-anim'), cx: x - 6 + (Math.random() - 0.5) * 20, cy: y0 - 6, r: 2 + Math.random() * 4 }, g);
        c.style.setProperty('--dx', `${(Math.random() - 0.5) * 60}px`);
        c.style.setProperty('--dy', `${-20 - Math.random() * 50}px`);
      }
      if (ln.rank === 1) lv.laneEl.classList.add('winner');
      void vw;
      setTimeout(() => g.remove(), 1000);
    }
  }

  /* ============================================================
   * 경기 계획 (사전 계산: 결과·배속은 결정적)
   * ============================================================ */
  function buildPlan(race, design) {
    const heats = race.heats && race.heats.length ? race.heats : [{ label: null }];
    const step = race.step || 0.1;
    const plan = { race, heats: [] };
    for (const heat of heats) {
      const lanes = race.lanes.map((ls, i) => {
        const bathy = heat.bathy || ls.bathy || race.bathy || (race.design ? R.designCourse(design) : R.COURSES.deep);
        return { id: ls.wave.id || ('lane' + i), wave: ls.wave, bathy, start: ls.start || 0, courseName: ls.courseName };
      });
      const pre = P.createSim({ length: race.length, lanes });
      pre.completeAll(step, 5e6);
      const ft = l => (l.finishTime == null ? Infinity : l.finishTime);
      const ranked = pre.lanes.slice().sort((a, b) => ft(a) - ft(b));
      ranked.forEach((l, i) => { if (l.rank == null) l.rank = i + 1; });
      const winnerTime = ft(ranked[0]);
      const lastTime = Math.max(...ranked.map(l => (isFinite(ft(l)) ? ft(l) : winnerTime)));
      const timeScale = race.timeScale || Math.max(1, winnerTime / 15);
      plan.heats.push({ label: heat.label, short: heat.short, lanes, pre, ranked, winnerTime, lastTime, timeScale, step });
    }
    return plan;
  }

  /* ============================================================
   * 경기 흐름: 패독 → 베팅 → 레이스 → 정산
   * ============================================================ */
  const Flow = {
    current: null,
    abort() { if (this.current) { this.current.cancelled = true; if (this.current.view) this.current.view.destroy(); this.current = null; } },
  };

  class RaceFlow {
    constructor(race, opts = {}) {
      this.race = race; this.opts = opts;
      this.world = R.WORLDS[race.world];
      this.design = race.design ? Object.assign({}, race.design.initial) : null;
      this.choices = {};
      this.cancelled = false;
      this.stage = 'paddock';
      Flow.current = this;
    }
    begin() {
      setTopbar(this.world.name, `${this.race.no} ${this.race.title}`);
      setChrome({ top: true, caster: true });
      if (this.race.design) this.showEditor(); else this.showPaddock();
    }
    /** 도감에서 돌아올 때 */
    resume() {
      setTopbar(this.world.name, `${this.race.no} ${this.race.title}`);
      setChrome({ top: true, caster: true });
      if (this.stage === 'paddock') this.showPaddock();
      else if (this.stage === 'bet') this.showBet();
      else if (this.stage === 'editor') this.showEditor();
      else if (this.stage === 'results' && this.lastResults) this.showResults(this.lastResults);
      else this.begin();
    }

    /* ---------- 1. 패독 ---------- */
    showPaddock() {
      this.stage = 'paddock';
      const race = this.race;
      app.innerHTML = '';
      const panel = el('div', { class: 'panel' },
        el('h2', {}, `${race.no} ${race.title}`),
        el('p', { class: 'muted' }, this.world.sub));
      const sharedBathy = race.bathy || (race.heats ? null : null);
      if (race.heats) {
        race.heats.forEach(h => {
          panel.appendChild(el('h3', {}, h.label));
          panel.appendChild(courseSVG(h.bathy, race.length, { vh: 120 }));
        });
      } else if (sharedBathy) {
        panel.appendChild(courseSVG(sharedBathy, race.length, {}));
        if (race.scaleNote) panel.appendChild(el('p', { class: 'muted' }, race.scaleNote));
      }
      app.appendChild(panel);
      const cards = el('div', { class: 'wave-cards' });
      race.lanes.forEach((ls, i) => {
        const w = ls.wave;
        const card = el('div', { class: 'wave-card' },
          el('span', { class: 'lane-tag' }, `${i + 1}레인`),
          el('span', { class: 'emoji' }, w.emoji || '🌊'),
          el('span', { class: 'name' }, w.name),
          el('span', { class: 'spec' }, race.hideLambda ? `주기 T = ${w.T} s (파장 비공개)` : `파장 λ₀ = ${fmtDist(w.lambda0)} · 파고 H₀ = ${w.H0 == null ? 1 : w.H0} m`));
        if (ls.courseName) card.appendChild(el('span', { class: 'spec' }, ls.courseName));
        if (ls.start) card.appendChild(el('span', { class: 'handicap' }, `핸디캡: ${fmtNum(ls.start)} m 앞에서 출발`));
        if (ls.bathy && !race.bathy && !race.heats) card.appendChild(courseSVG(ls.bathy, race.length, { vh: 90 }));
        cards.appendChild(card);
      });
      app.appendChild(el('div', { class: 'panel' }, el('h3', {}, '출전 파도'), cards));
      Caster.say(O.has('paddock', race.id) ? line('paddock', null, race.id) : line('paddock'));
      setActions(btn('베팅하러 ▶', () => this.showBet()));
    }

    /* ---------- 2. 베팅 ---------- */
    showBet() {
      this.stage = 'bet';
      const race = this.race;
      app.innerHTML = '';
      const panel = el('div', { class: 'panel' }, el('h2', {}, '예측 베팅'), el('p', { class: 'muted' }, '틀려도 잃는 건 없습니다. 맞히면 예측 포인트가 쌓입니다.'));
      (race.bets || []).forEach((bet, bi) => {
        const q = el('p', { class: 'bet-q' }, bet.q, el('span', { class: 'bet-points' }, `+${bet.points}`));
        const opts = el('div', { class: 'bet-options', role: 'group', 'aria-label': bet.q });
        const options = betOptions(race, bet);
        options.forEach((o, oi) => {
          const b = el('button', { type: 'button', class: 'opt', 'aria-pressed': String(this.choices[bi] === oi) },
            o.emoji ? el('span', { class: 'emoji' }, o.emoji) : null,
            el('span', {}, el('span', { class: 'name' }, o.name), o.spec ? el('span', { class: 'spec' }, o.spec) : null));
          b.addEventListener('click', () => {
            this.choices[bi] = oi;
            [...opts.children].forEach((c, ci) => c.setAttribute('aria-pressed', String(ci === oi)));
            this.updateStartBtn();
          });
          opts.appendChild(b);
        });
        panel.appendChild(q); panel.appendChild(opts);
      });
      app.appendChild(panel);
      Caster.say(line('betNag'));
      this.startBtn = btn('출발! 🏁', () => this.runAll());
      setActions(btn('◀ 패독', () => this.showPaddock(), 'ghost'), this.startBtn);
      this.updateStartBtn();
    }
    updateStartBtn() {
      if (!this.startBtn) return;
      const ok = (this.race.bets || []).every((b, i) => this.choices[i] != null);
      this.startBtn.disabled = !ok;
    }

    /* ---------- 3. 레이스 ---------- */
    async runAll(mode) {
      this.mode = mode || 'official';
      this.stage = 'race';
      this.plan = buildPlan(this.race, this.design);
      this.heatViews = [];
      for (let i = 0; i < this.plan.heats.length; i++) {
        if (this.cancelled) return;
        if (i > 0) {
          const h = this.plan.heats[i];
          Caster.say(O.has('heat2', this.race.id) ? line('heat2', null, this.race.id) : `${h.label} 준비!`);
          await new Promise(res => setActions(btn(`${h.label} 출발 ▶`, res)));
          if (this.cancelled) return;
        }
        await this.runHeat(this.plan.heats[i], i);
      }
      if (this.cancelled) return;
      this.showResults(this.evaluate());
    }

    runHeat(heat, hi) {
      return new Promise(resolve => {
        const race = this.race;
        app.innerHTML = '';
        const sim = P.createSim({ length: race.length, lanes: heat.lanes });
        const view = new RaceView(app, race, heat, sim);
        this.view = view;
        let ended = false, finished = false, rafId = 0;
        let last = 0, acc = 0, ramp = 1, rampTarget = 1;
        let slomoUntil = 0, firstFinishReal = null, startReal = 0;
        let saidLead = false, saidGap = false, gapPeak = 0, lastLaneEventAt = 0;
        const shallowSaid = new Set();
        const raceId = race.id;

        const finish = (skipped) => {
          if (finished) return; finished = true;
          cancelAnimationFrame(rafId);
          view.destroy();
          setActions();
          setTimeout(() => resolve(), skipped ? 150 : 900);
        };
        const endRace = (skipped) => {
          if (ended) return; ended = true;
          if (skipped) { Caster.say(line('skip')); }
          finish(skipped);
        };
        const skipBtn = btn('결과 보기 ⏩', () => endRace(true), 'ghost small');

        const frame = (now) => {
          if (this.cancelled || ended) return;
          if (!last) { last = now; startReal = now; }
          const realDt = Math.min(0.1, (now - last) / 1000); last = now;
          ramp += (rampTarget - ramp) * Math.min(1, realDt * 2.5);
          const slow = (!reduceMotion && now < slomoUntil) ? 0.12 : 1;
          const scale = heat.timeScale * session.speed * ramp * slow;
          acc += realDt * scale;
          let n = 0;
          while (acc >= heat.step && n < 4000 && !sim.done) { sim.step(heat.step); acc -= heat.step; n++; }
          // 이벤트 처리
          while (sim.events.length) {
            const ev = sim.events.shift();
            const ln = ev.lane;
            if (ev.type === 'break') {
              view.wipeout(ln);
              Caster.event(line('breaking', { name: ln.wave.name, H: ln.state.H.toFixed(2), h: ln.brokenH.toFixed(1) }), 2000);
            } else if (ev.type === 'shallow') {
              if (now - lastLaneEventAt > 900 && !shallowSaid.has(ln.index)) {
                shallowSaid.add(ln.index); lastLaneEventAt = now;
                Caster.event(line('shallow', { name: ln.wave.name }), 1800);
              }
            } else if (ev.type === 'transition') {
              if (ln.index === sim.leader().index && now - lastLaneEventAt > 900) { lastLaneEventAt = now; Caster.event(line('transition', { name: ln.wave.name }), 1500); }
            } else if (ev.type === 'finish') {
              view.spray(ln);
              if (ev.rank === 1) {
                firstFinishReal = now;
                if (!reduceMotion) slomoUntil = now + 500;
                Caster.event(line('finishFirst', { name: ln.wave.name, time: fmtTime(ln.finishTime) }), 2200);
                if (!race.endOnFirst) {
                  const remaining = Math.max(0, heat.lastTime - sim.t);
                  rampTarget = Math.max(1, remaining / (8 * heat.timeScale * session.speed));
                } else if (O.has('mid', raceId)) {
                  Caster.event(line('mid', null, raceId), 2600);
                }
              } else {
                Caster.event(line('finishNext', { name: ln.wave.name, rank: ev.rank, time: fmtTime(ln.finishTime) }), 1500);
              }
            }
          }
          // 중계: 선두 / 격차
          const elapsed = (now - startReal) / 1000;
          if (!saidLead && elapsed > 3.5) {
            saidLead = true;
            const lead = sim.leader();
            if (hi === 0 && O.has('mid', raceId) && !race.endOnFirst) Caster.event(line('mid', null, raceId), 2600);
            else if (race.id !== 'boss') Caster.event(line('lead', { name: lead.wave.name }), 2000);
          }
          const gap = sim.gap();
          if (gap > gapPeak) gapPeak = gap;
          if (!saidGap && gapPeak > race.length * 0.15 && gap < gapPeak * 0.6 && sim.finishedCount === 0 && sim.lanes.some(l => l.seenShallow)) {
            saidGap = true; Caster.event(line('gapClose'), 2200);
          }
          view.draw(now);
          // 종료 판정
          if (sim.done) endRace(false);
          else if (race.endOnFirst && firstFinishReal && now - firstFinishReal > 2500) endRace(false);
          else if (elapsed > 120) endRace(false);
          else rafId = requestAnimationFrame(frame);
        };

        (async () => {
          Caster.say(line('countdown'));
          view.draw(performance.now(), true);
          setActions();
          await countdown();
          if (this.cancelled) return;
          Caster.say(O.has('start', raceId) ? line('start', null, raceId) : line('start'));
          setActions(skipBtn);
          rafId = requestAnimationFrame(frame);
        })();
      });
    }

    /* ---------- 정산 계산 ---------- */
    evaluate() {
      const race = this.race, plan = this.plan;
      const out = { race, plan, bets: [], gained: 0, bonus: 0, design: null, newCards: [], newCodex: [] };
      const official = this.mode === 'official';
      const h0 = plan.heats[0];
      if (race.design) {
        const d = race.design;
        const swell = h0.pre.lanes.find(l => l.wave.name === '너울');
        const ripple = h0.pre.lanes.find(l => l.wave.name === '잔물결');
        let ok = false, detail = '';
        if (d.goal === 'swellWins') { ok = swell.rank === 1; detail = ok ? '너울이 따라잡아 1위!' : `잔물결이 ${fmtTime(ripple.finishTime)}에 먼저 도착`; }
        else if (d.goal === 'rippleWins') { ok = ripple.rank === 1; detail = ok ? '잔물결이 1위를 지켰습니다!' : `너울이 ${fmtTime(swell.finishTime)}에 먼저 도착`; }
        else if (d.goal === 'breakWindow') {
          const bx = swell.brokenAt;
          ok = bx != null && bx >= d.window[0] && bx <= d.window[1];
          detail = bx == null ? '너울이 부서지지 않았습니다' : `너울 쇄파 지점: ${fmtNum(bx)} m (목표 ${fmtNum(d.window[0])}~${fmtNum(d.window[1])} m)`;
        }
        out.design = { ok, detail, points: ok && official ? d.points : 0 };
        if (ok && official) { out.gained += d.points; this.bumpStreak(out, true); }
        else if (official) this.bumpStreak(out, false);
      }
      (race.bets || []).forEach((bet, bi) => {
        const choice = this.choices[bi];
        const options = betOptions(race, bet);
        let answer = null;
        if (bet.type === 'winner') answer = h0.pre.lanes.findIndex(l => l.rank === 1);
        else if (bet.type === 'firstBreak') {
          let best = null;
          h0.pre.lanes.forEach((l, i) => { if (l.brokenT != null && (best == null || l.brokenT < h0.pre.lanes[best].brokenT)) best = i; });
          answer = best;
        } else if (bet.type === 'gap') {
          let best = 0, bestGap = -1;
          plan.heats.forEach((h, i) => { const g = h.lastTime - h.winnerTime; if (g > bestGap) { bestGap = g; best = i; } });
          answer = best;
        } else if (bet.type === 'choice') answer = bet.answer;
        const correct = answer != null && choice === answer;
        const pts = correct && official ? bet.points : 0;
        out.gained += pts;
        if (official) this.bumpStreak(out, correct);
        out.bets.push({ bet, choice, answer, correct, points: pts, choiceLabel: options[choice] ? options[choice].name : '—', answerLabel: options[answer] ? options[answer].name : '—' });
      });
      return out;
    }
    bumpStreak(out, correct) {
      if (correct) {
        session.streak++;
        if (session.streak % 3 === 0) { out.bonus += R.POINTS.streakBonus; out.gained += R.POINTS.streakBonus; }
      } else session.streak = 0;
    }

    /* ---------- 4. 정산 화면 ---------- */
    showResults(res) {
      this.stage = 'results'; this.lastResults = res;
      const race = this.race, plan = res.plan;
      const official = this.mode === 'official';
      const firstTime = !res.applied;
      app.innerHTML = '';

      // 베팅 결과
      const betPanel = el('div', { class: 'panel' }, el('h2', {}, official ? '정산' : '시운전 결과'));
      if (res.design) {
        const d = res.design;
        betPanel.appendChild(el('div', { class: 'bet-result ' + (d.ok ? 'ok' : 'bad') },
          el('span', { class: 'mark' }, d.ok ? '✔ 의뢰 성공' : '✘ 조건 미충족'),
          el('span', {}, d.detail),
          official ? el('span', { class: 'pts' }, d.ok ? `+${race.design.points}` : '+0') : null));
      }
      res.bets.forEach(b => {
        betPanel.appendChild(el('div', { class: 'bet-result ' + (b.correct ? 'ok' : 'bad') },
          el('span', { class: 'mark' }, b.correct ? '✔ 적중' : '✘ 빗나감'),
          el('span', {}, `${b.bet.q} → 내 예측: ${b.choiceLabel} / 정답: ${b.answerLabel}`),
          el('span', { class: 'pts' }, official ? `+${b.points}` : '시운전')));
      });
      if (res.bonus) betPanel.appendChild(el('div', { class: 'bet-result ok' }, el('span', { class: 'mark' }, '🔥 3연속 적중'), el('span', {}, '보너스'), el('span', { class: 'pts' }, `+${res.bonus}`)));
      app.appendChild(betPanel);

      // 순위표 (히트별)
      plan.heats.forEach(h => {
        const panel = el('div', { class: 'panel' });
        if (h.label) panel.appendChild(el('h3', {}, h.label));
        const tbl = el('table', { class: 'result-table' });
        tbl.appendChild(el('thead', {}, el('tr', {}, ...['순위', '선수', '도착 시간', '최고 → 최저 속도', '부서진 지점'].map(t => el('th', {}, t)))));
        const tb = el('tbody');
        h.ranked.forEach(ln => {
          const unfinishedBoss = race.endOnFirst && ln.rank > 1;
          const timeCell = unfinishedBoss ? `아직 태평양 한가운데… (예상 ${fmtTime(ln.finishTime)})` : (ln.finishTime == null ? '미도착' : fmtTime(ln.finishTime));
          tb.appendChild(el('tr', { class: ln.rank === 1 ? 'first' : '' },
            el('td', { class: 'rank' }, `${ln.rank}위`),
            el('td', {}, `${ln.wave.emoji || ''} ${ln.wave.name}`),
            el('td', { class: 'num' }, timeCell),
            el('td', { class: 'num' }, `${fmtSpeed(ln.maxC)} → ${fmtSpeed(ln.minC)}`),
            el('td', {}, ln.brokenAt != null ? `${fmtNum(ln.brokenAt)} m (수심 ${fmtDepth(ln.brokenH)})` : '—')));
        });
        tbl.appendChild(tb);
        panel.appendChild(el('div', { class: 'table-wrap' }, tbl));
        if (plan.heats.length > 1) panel.appendChild(el('p', { class: 'muted' }, `도착 시간 차: ${fmtTime(h.lastTime - h.winnerTime)}`));
        panel.appendChild(resultsExtra(race, h));
        app.appendChild(panel);
      });

      // 포인트·도감·카드
      if (official && firstTime) {
        res.applied = true;
        if (res.gained) setTimeout(() => awardPoints(res.gained), 300);
        const designOk = !res.design || res.design.ok;
        if (designOk) {
          progress.cleared[race.id] = true;
          const summary = raceSummary(race, plan);
          for (const cid of race.cards) if (!progress.codex[cid]) { progress.codex[cid] = { race: race.id, summary }; res.newCards.push(cid); }
          for (const wid of race.codex) if (!progress.codex[wid]) { progress.codex[wid] = { race: race.id, summary }; res.newCodex.push(wid); }
          saveProgress();
        }
        session.results.push({ race: race.id, title: `${race.no} ${race.title}`, points: res.gained });
      }
      const designOk = !res.design || res.design.ok;
      if (official && designOk && (res.newCards.length || res.newCodex.length)) {
        const row = el('div', { class: 'cards-row' });
        res.newCards.forEach((cid, i) => {
          const c = R.CARDS[cid];
          const fc = el('div', { class: 'flip-card' }, el('div', { class: 'flip-inner' },
            el('div', { class: 'flip-face flip-front' }, '?'),
            el('div', { class: 'flip-face flip-back' }, el('span', { class: 'no' }, `원리 카드 ${c.no}`), el('span', { class: 'title' }, c.title), el('span', { class: 'formula' }, c.formula), el('span', { class: 'line' }, c.line))));
          row.appendChild(fc);
          setTimeout(() => fc.classList.add('flipped'), 500 + i * 450);
        });
        res.newCodex.forEach((wid, i) => {
          const c = R.CODEX.find(x => x.id === wid);
          const fc = el('div', { class: 'flip-card' }, el('div', { class: 'flip-inner' },
            el('div', { class: 'flip-face flip-front' }, '?'),
            el('div', { class: 'flip-face flip-back' }, el('span', { class: 'no' }, '파도 도감'), el('span', { class: 'title' }, `${c.emoji} ${c.name}`), el('span', { class: 'line' }, c.desc))));
          row.appendChild(fc);
          setTimeout(() => fc.classList.add('flipped'), 500 + (res.newCards.length + i) * 450);
        });
        app.appendChild(el('div', { class: 'panel' }, el('h3', {}, '📖 도감 등록'), row));
      }

      // 캐스터 해설
      if (res.design) Caster.say(line(res.design.ok ? 'success' : 'fail', { x: plan.heats[0].pre.lanes[0].brokenAt != null ? fmtNum(plan.heats[0].pre.lanes[0].brokenAt) : '?' }, race.id));
      else {
        const anyBet = res.bets[0];
        const first = anyBet ? line(anyBet.correct ? 'betRight' : 'betWrong', { points: res.gained }) : '';
        Caster.say(first);
        if (O.has('settle', race.id)) Caster.event(line('settle', null, race.id), 6000);
        if (res.newCards.length || res.newCodex.length) Caster.event(line('codex'), 3000);
      }
      if (!official) Caster.say(line('testRun') + ' ' + (res.design ? res.design.detail : ''));

      // 행동 버튼
      const buttons = [];
      if (!official) buttons.push(btn('◀ 다시 설계', () => this.showEditor()));
      else if (res.design && !res.design.ok) buttons.push(btn('◀ 다시 설계', () => this.showEditor()));
      else {
        const idx = R.indexOf(race.id);
        const next = R.RACES[idx + 1];
        if (next) buttons.push(btn(`다음 경기: ${next.no} ▶`, () => { Flow.current = null; startRace(next.id); }));
        else buttons.push(btn('최종 결과 🏆', () => { Flow.current = null; showFinal(); }));
        if (res.design && res.design.ok && race.design) buttons.unshift(btn('다시 설계해 보기', () => this.showEditor(), 'ghost'));
      }
      buttons.unshift(btn('📖 도감', () => showCodex(() => this.resume()), 'ghost'));
      setActions(...buttons);
      window.scrollTo({ top: 0 });
    }

    /* ---------- 월드 3: 코스 편집기 ---------- */
    showEditor() {
      this.stage = 'editor';
      const race = this.race, d = race.design, st = this.design;
      app.innerHTML = '';
      const panel = el('div', { class: 'panel' },
        el('h2', {}, `${race.no} ${race.title}`),
        el('div', { class: 'brief' }, el('div', {}, d.brief), el('div', { class: 'hint' }, d.hint)));
      const grid = el('div', { class: 'editor-grid' });
      const left = el('div');
      const vw = 1000, vh = 220, pad = 14, y0 = 60;
      const svg = svgEl('svg', { viewBox: `0 0 ${vw} ${vh}`, class: 'editor-svg', role: 'img', 'aria-label': '해저 지형 편집' });
      const yOf = depthMapper(200, y0, vh);
      const hOf = y => { // depthMapper 역함수
        const denom = Math.log(1 + 200 / 0.5), span = vh - y0 - 6;
        return 0.5 * (Math.exp((y - y0 - 6) / span * denom) - 1);
      };
      const px = x => pad + x / race.length * (vw - 2 * pad);
      const xOf = p => (p - pad) / (vw - 2 * pad) * race.length;
      svgEl('rect', { x: 0, y: y0, width: vw, height: vh - y0, fill: 'var(--sea)' }, svg);
      if (d.window) {
        svgEl('rect', { x: px(d.window[0]), y: 0, width: px(d.window[1]) - px(d.window[0]), height: vh, fill: 'var(--sun)', opacity: .4 }, svg);
        const t = svgEl('text', { x: (px(d.window[0]) + px(d.window[1])) / 2, y: 18, 'text-anchor': 'middle', class: 'handle-label' }, svg); t.textContent = '목표 쇄파 구간';
      }
      const sandPath = svgEl('path', { fill: 'var(--sand)', stroke: 'var(--sand-3)', 'stroke-width': 1.5 }, svg);
      svgEl('line', { x1: 0, y1: y0, x2: vw, y2: y0, stroke: 'var(--sea-deep)', 'stroke-width': 1.5 }, svg);
      svgEl('line', { x1: px(500), y1: y0 - 10, x2: px(500), y2: vh, stroke: 'var(--ink-2)', 'stroke-width': 2, 'stroke-dasharray': '4 4' }, svg);
      const ts = svgEl('text', { x: px(500) + 4, y: vh - 8, class: 'handle-label' }, svg); ts.textContent = '잔물결 출발선 (500 m)';
      svgEl('line', { x1: px(race.length), y1: y0 - 10, x2: px(race.length), y2: vh, stroke: 'var(--coral)', 'stroke-width': 3, 'stroke-dasharray': '8 6' }, svg);
      const guide1 = svgEl('line', { class: 'depth-guide' }, svg);
      const guide2 = svgEl('line', { class: 'depth-guide' }, svg);
      const mkHandle = () => {
        const g = svgEl('g', { class: 'handle-g' }, svg);
        svgEl('circle', { class: 'handle-hit', r: 34 }, g);
        svgEl('circle', { class: 'handle', r: 15 }, g);
        return g;
      };
      const h1 = mkHandle();
      const h2 = mkHandle();
      const l1 = svgEl('text', { class: 'handle-label', 'text-anchor': 'middle' }, svg);
      const l2 = svgEl('text', { class: 'handle-label', 'text-anchor': 'middle' }, svg);
      const tick = svgEl('text', { x: 6, y: yOf(200) - 4, class: 'handle-label' }, svg); tick.textContent = '수심 200 m';
      left.appendChild(svg);

      // 슬라이더
      const HMIN = 1, HMAX = 100;
      const hToSlider = h => Math.round(Math.log(h / HMIN) / Math.log(HMAX / HMIN) * 100);
      const sliderToH = v => { const h = HMIN * Math.pow(HMAX / HMIN, v / 100); return h < 5 ? Math.round(h * 10) / 10 : Math.round(h); };
      const controls = el('div', { class: 'panel' });
      const xsVal = el('span', { class: 'val num' }), hVal = el('span', { class: 'val num' });
      const xsIn = el('input', { type: 'range', id: 'edXs', min: 100, max: 2700, step: 50, value: st.xs });
      const hIn = el('input', { type: 'range', id: 'edH', min: 0, max: 100, step: 1, value: hToSlider(st.hmid) });
      const sbIn = el('input', { type: 'checkbox', id: 'edSb' }); sbIn.checked = !!st.sandbar;
      controls.appendChild(el('div', { class: 'slider-row' }, el('label', { for: 'edXs' }, '① 얕아지기 시작 지점'), xsVal, xsIn));
      controls.appendChild(el('div', { class: 'slider-row' }, el('label', { for: 'edH' }, '② 중간(대륙붕) 수심'), hVal, hIn));
      controls.appendChild(el('div', { class: 'check-row' }, sbIn, el('label', { for: 'edSb' }, '③ 사주(수심 5 m 언덕) 넣기 — 중간 수심이 5 m보다 깊을 때만')));
      controls.appendChild(el('p', { class: 'muted' }, '해안(3,000 m) 수심은 1 m로 고정. 조절점을 드래그하거나 슬라이더를 쓰세요.'));
      const laneCards = el('div', { class: 'wave-cards' });
      race.lanes.forEach(ls => {
        laneCards.appendChild(el('div', { class: 'wave-card' }, el('span', { class: 'emoji' }, ls.wave.emoji), el('span', { class: 'name' }, ls.wave.name),
          el('span', { class: 'spec' }, `λ₀ ${fmtDist(ls.wave.lambda0)}`), ls.start ? el('span', { class: 'handicap' }, `${fmtNum(ls.start)} m 앞에서 출발`) : null));
      });
      controls.appendChild(laneCards);
      grid.appendChild(left); grid.appendChild(controls);
      panel.appendChild(grid);
      app.appendChild(panel);

      const redraw = () => {
        const bathy = R.designCourse(st);
        let dd = `M0,${vh} L0,${yOf(200)}`;
        for (let x = 0; x <= race.length; x += 10) dd += ` L${px(x).toFixed(1)},${yOf(P.depthAt(bathy, x)).toFixed(1)}`;
        dd += ` L${vw},${vh} Z`;
        sandPath.setAttribute('d', dd);
        const xe = st.xs + 150, xc = Math.max(xe, 2700), xm = (xe + xc) / 2;
        h1.setAttribute('transform', `translate(${px(st.xs)},${y0})`);
        h2.setAttribute('transform', `translate(${px(xm)},${yOf(st.hmid)})`);
        l1.setAttribute('x', px(st.xs)); l1.setAttribute('y', y0 - 22); l1.textContent = `⟷ ${fmtNum(st.xs)} m부터 얕아짐`;
        l2.setAttribute('x', px(xm)); l2.setAttribute('y', yOf(st.hmid) - 22); l2.textContent = `↕ 수심 ${fmtDepth(st.hmid)}`;
        guide1.setAttribute('x1', px(st.xs)); guide1.setAttribute('x2', px(st.xs)); guide1.setAttribute('y1', y0); guide1.setAttribute('y2', vh);
        guide2.setAttribute('x1', 0); guide2.setAttribute('x2', vw); guide2.setAttribute('y1', yOf(st.hmid)); guide2.setAttribute('y2', yOf(st.hmid));
        xsVal.textContent = `${fmtNum(st.xs)} m`; hVal.textContent = fmtDepth(st.hmid);
        if (String(xsIn.value) !== String(st.xs)) xsIn.value = st.xs;
        if (Number(hIn.value) !== hToSlider(st.hmid)) hIn.value = hToSlider(st.hmid);
        sbIn.checked = !!st.sandbar;
      };
      xsIn.addEventListener('input', () => { st.xs = Number(xsIn.value); redraw(); });
      hIn.addEventListener('input', () => { st.hmid = sliderToH(Number(hIn.value)); redraw(); });
      sbIn.addEventListener('change', () => { st.sandbar = sbIn.checked; redraw(); });
      // 드래그
      const toSvg = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
      const drag = (handle, onMove) => {
        handle.addEventListener('pointerdown', e => {
          e.preventDefault(); handle.setPointerCapture(e.pointerId);
          const move = ev => { onMove(toSvg(ev)); redraw(); };
          const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
          handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
        });
      };
      drag(h1, p => { st.xs = clamp(Math.round(xOf(p.x) / 50) * 50, 100, 2700); });
      drag(h2, p => { const h = clamp(hOf(p.y), HMIN, HMAX); st.hmid = h < 5 ? Math.round(h * 10) / 10 : Math.round(h); });
      redraw();

      Caster.say(O.has('paddock', race.id) ? line('paddock', null, race.id) : line('paddock'));
      setActions(btn('시운전 🔧', () => this.runAll('test'), 'secondary'), btn('제출 🏁', () => this.runAll('official')));
    }
  }

  /* ---------- 베팅 선택지 ---------- */
  function betOptions(race, bet) {
    if (bet.type === 'winner' || bet.type === 'firstBreak') {
      return race.lanes.map(ls => ({ emoji: ls.wave.emoji, name: ls.wave.name, spec: race.hideLambda ? `T = ${ls.wave.T} s` : `λ₀ ${fmtDist(ls.wave.lambda0)}${ls.courseName ? ' · ' + ls.courseName : ''}` }));
    }
    return (bet.options || []).map(o => ({ name: o }));
  }

  /* ---------- 정산 부가 자료 (R2·R3 공식표) ---------- */
  function resultsExtra(race, heat) {
    const box = el('div');
    if (race.extra === 'deepFormula') {
      box.appendChild(el('p', {}, el('span', { class: 'formula' }, 'c = √(gλ / 2π)'), ' ', el('span', { class: 'muted' }, '심해파 속도식 — 파장이 4배여야 속도가 2배')));
      const ul = el('ul', { class: 'summary-list' });
      heat.ranked.forEach(ln => ul.appendChild(el('li', {}, `${ln.wave.name}: λ = ${fmtNum(ln.wave.lambda0)} m → c = √(9.8 × ${fmtNum(ln.wave.lambda0)} / 6.28) ≈ ${ln.wave.c0.toFixed(1)} m/s`)));
      box.appendChild(ul);
    } else if (race.extra === 'periodFormula') {
      box.appendChild(el('p', {}, el('span', { class: 'formula' }, 'λ = gT² / 2π'), ' ', el('span', { class: 'muted' }, '숨겨졌던 파장을 주기로 환산')));
      const ul = el('ul', { class: 'summary-list' });
      heat.ranked.forEach(ln => ul.appendChild(el('li', {}, `${ln.wave.name}: T = ${ln.wave.T.toFixed(0)} s → λ = 9.8 × ${ln.wave.T.toFixed(0)}² / 6.28 ≈ ${fmtNum(ln.wave.lambdaDeep)} m → c ≈ ${ln.wave.c0.toFixed(1)} m/s`)));
      box.appendChild(ul);
    } else if (race.id === 'boss') {
      const ts = heat.pre.lanes.reduce((a, b) => (b.maxC > a.maxC ? b : a));
      box.appendChild(el('p', {}, el('span', { class: 'formula' }, `c = √(gh) = √(9.8 × 4,000) ≈ ${Math.round(Math.sqrt(9.8 * 4000))} m/s`), ' ',
        el('span', { class: 'muted' }, `17,000,000 m ÷ ${Math.round(ts.maxC)} m/s ≈ ${fmtTime(17000000 / ts.maxC)} · 1960년 칠레 지진 쓰나미 실제 약 22시간`)));
    }
    return box;
  }
  function raceSummary(race, plan) {
    const h = plan.heats[0];
    const w = h.ranked[0], l = h.ranked[h.ranked.length - 1];
    let s = `1위 ${w.wave.name} ${fmtTime(w.finishTime)}`;
    if (h.ranked.length > 1) s += ` · 꼴찌 ${l.wave.name} ${race.endOnFirst ? '약 ' : ''}${fmtTime(l.finishTime)}`;
    const broke = h.pre.lanes.filter(x => x.brokenT != null).sort((a, b) => a.brokenT - b.brokenT)[0];
    if (broke) s += ` · 먼저 부서짐 ${broke.wave.name} (${fmtNum(broke.brokenAt)} m)`;
    if (plan.heats.length > 1) s = plan.heats.map(hh => `${hh.short}: 격차 ${fmtTime(hh.lastTime - hh.winnerTime)}`).join(' · ');
    return s;
  }

  /* ============================================================
   * 화면: 시작 · 도감 · 선생님 모드 · 최종
   * ============================================================ */
  function startRace(id) {
    Flow.abort();
    const race = R.byId(id);
    if (!race) return showTitle();
    new RaceFlow(race).begin();
  }

  function showTitle() {
    Flow.abort();
    setChrome({ top: false, caster: false });
    app.innerHTML = '';
    const nextId = (R.RACES.find(r => !progress.cleared[r.id]) || R.RACES[0]).id;
    const hasProgress = Object.keys(progress.cleared).length > 0;
    const allDone = R.RACES.every(r => progress.cleared[r.id]);
    const wave = svgEl('svg', { viewBox: '0 0 560 90', class: 'title-wave', 'aria-hidden': 'true' });
    svgEl('path', { class: 'w2', d: 'M0,55 Q70,20 140,55 T280,55 T420,55 T560,55 V90 H0 Z' }, wave);
    svgEl('path', { d: 'M0,65 Q70,35 140,65 T280,65 T420,65 T560,65 V90 H0 Z' }, wave);
    const buttons = el('div', { class: 'title-buttons' });
    if (hasProgress && !allDone) {
      const nr = R.byId(nextId);
      buttons.appendChild(btn(`이어하기 (${nr.no}부터) ▶`, () => startRace(nextId), 'big'));
      buttons.appendChild(btn('처음부터', () => { session.points = 0; session.streak = 0; session.results = []; renderPoints(); startRace('r1'); }, 'secondary'));
    } else {
      buttons.appendChild(btn('경기 시작 ▶', () => { session.points = 0; session.streak = 0; session.results = []; renderPoints(); startRace('r1'); }, 'big'));
    }
    buttons.appendChild(btn('📖 도감', () => showCodex(showTitle), 'secondary'));
    buttons.appendChild(btn('🧑‍🏫 선생님 모드', showTeacher, 'ghost'));
    app.appendChild(el('div', { class: 'title-screen' },
      el('h1', {}, '파도 레이스'),
      el('p', { class: 'tag' }, '심해파·천해파의 속도를 파도 경주에 베팅하며 익힙니다'),
      wave, buttons,
      el('p', { class: 'title-note' }, '예측과 점수는 화면에만 표시되고 어디에도 기록되지 않습니다. 도감·진행도만 이 기기에 저장됩니다.')));
  }

  function showCodex(back) {
    setChrome({ top: true, caster: false });
    setTopbar('도감', '파도 도감 · 원리 카드');
    app.innerHTML = '';
    const grid = el('div', { class: 'codex-grid' });
    let count = 0;
    R.CODEX.forEach(c => {
      const got = progress.codex[c.id];
      if (got) count++;
      const cell = el('div', { class: 'codex-cell ' + (c.kind === 'card' ? 'card-kind ' : '') + (got ? '' : 'locked'), tabindex: 0 });
      if (c.kind === 'wave') {
        cell.appendChild(el('span', { class: 'emoji' }, c.emoji));
        cell.appendChild(el('span', { class: 'name' }, got ? c.name : '???'));
        if (got) {
          cell.appendChild(el('span', { class: 'desc' }, c.desc));
          if (c.card) { const cd = R.CARDS[c.card]; cell.appendChild(el('span', { class: 'desc' }, `원리 카드 ${cd.no} ${cd.title}`)); cell.appendChild(el('span', { class: 'formula' }, cd.formula)); }
          cell.appendChild(el('span', { class: 'summary' }, `등록 경기 ${R.byId(got.race).no} · ${got.summary}`));
        } else cell.appendChild(el('span', { class: 'desc' }, '해당 파도가 등장하는 경기를 마치면 등록됩니다.'));
      } else {
        const cd = R.CARDS[c.card];
        cell.appendChild(el('span', { class: 'emoji' }, got ? '🃏' : '🔒'));
        cell.appendChild(el('span', { class: 'name' }, got ? `${cd.no} ${cd.title}` : `원리 카드 ${cd.no}`));
        if (got) {
          cell.appendChild(el('span', { class: 'formula' }, cd.formula));
          cell.appendChild(el('span', { class: 'desc' }, cd.line));
          cell.appendChild(el('span', { class: 'summary' }, `등록 경기 ${R.byId(got.race).no} · ${got.summary}`));
        } else cell.appendChild(el('span', { class: 'desc' }, '잠김 — 경기를 마치면 뒤집힙니다.'));
      }
      grid.appendChild(cell);
    });
    app.appendChild(el('div', { class: 'panel' },
      el('div', { class: 'row' }, el('h2', {}, `도감 ${count} / ${R.CODEX.length}`), el('span', { class: 'muted' }, '파도 5칸 + 원리 카드 7칸'),
        btn('◀ 돌아가기', back || showTitle, 'ghost small')),
      grid));
  }

  function showTeacher() {
    Flow.abort();
    setChrome({ top: true, caster: false });
    setTopbar('선생님 모드', '시연 메뉴 (비밀번호 없음)');
    app.innerHTML = '';
    const list = el('div', { class: 'race-list' });
    R.RACES.forEach(r => {
      list.appendChild(el('button', { type: 'button', class: 'opt', onclick: () => startRace(r.id) },
        el('span', { class: 'name' }, `${r.no} ${r.title}${progress.cleared[r.id] ? ' ✔' : ''}`),
        el('span', { class: 'spec' }, R.WORLDS[r.world].name)));
    });
    const speedSel = el('select', { id: 'speedSel' });
    [0.25, 0.5, 1, 2, 4].forEach(v => { const o = el('option', { value: v }, `${v}×`); if (v === session.speed) o.selected = true; speedSel.appendChild(o); });
    speedSel.addEventListener('change', () => { session.speed = Number(speedSel.value); });
    app.appendChild(el('div', { class: 'panel' },
      el('h2', {}, '아무 경기나 바로 열기'), list));
    app.appendChild(el('div', { class: 'panel' },
      el('h2', {}, '배속'), el('div', { class: 'row' }, el('label', { for: 'speedSel' }, '레이스 진행 배속'), speedSel,
        el('span', { class: 'muted' }, '기본 1× = 경기당 약 20~30초')),
      el('h2', { style: 'margin-top:14px' }, '기타'),
      el('div', { class: 'row' },
        btn('진행도·도감 초기화', () => { if (confirm('이 기기에 저장된 진행도와 도감을 지울까요?')) { resetProgress(); showTeacher(); } }, 'ghost small'),
        btn('물리 검증 수치(콘솔)', () => { P.selfCheck(); alert('브라우저 콘솔(F12)에 검증 표를 출력했습니다.'); }, 'ghost small'),
        btn('◀ 처음 화면', showTitle, 'ghost small'))));
  }

  function showFinal() {
    Flow.abort();
    setChrome({ top: true, caster: true });
    setTopbar('전 경기 종료', '최종 결과');
    app.innerHTML = '';
    const pts = session.points;
    const grade = R.GRADES.find(g => pts >= g.min) || R.GRADES[R.GRADES.length - 1];
    const ul = el('ul', { class: 'summary-list' });
    session.results.forEach(r => ul.appendChild(el('li', {}, r.title, el('span', { class: 'pts' }, `+${r.points}`))));
    app.appendChild(el('div', { class: 'panel center' },
      el('div', { class: 'grade-emoji' }, grade.emoji),
      el('div', { class: 'grade' }, grade.name),
      el('p', {}, '예측 포인트 ', el('b', { class: 'num', style: 'font-size:28px;color:var(--coral-2)' }, fmtNum(pts))),
      el('p', { class: 'muted' }, '0~299 파도 초보 · 300~599 해변 단골 · 600~899 노련한 서퍼 · 900+ 바다를 읽는 자')));
    if (session.results.length) app.appendChild(el('div', { class: 'panel' }, el('h3', {}, '이번 세션 경기 기록'), ul));
    Caster.say(line('final'));
    setActions(btn('📖 도감', () => showCodex(showFinal), 'ghost'), btn('처음으로', showTitle));
  }

  /* ---------- 시작 ---------- */
  renderPoints();
  showTitle();
  window.WaveRace = { Physics: P, Races: R, Otter: O, session, progress, startRace, showTitle, showCodex, showTeacher, buildPlan };
})();
