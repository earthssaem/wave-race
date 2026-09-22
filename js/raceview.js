/* ============================================================
 * 파도 레이스 — 레이스 화면 (js/raceview.js)
 * 레인 · 파열(SVG) · 깃발 · 뱃지 · 격차 미터 · 연출(쇄파·물보라)
 * ============================================================ */
(function () {
  'use strict';
  const P = window.Physics;
  const { reduceMotion, $, esc, el, svgEl, fmtNum, fmtTime, fmtSpeed, fmtDist, fmtDepth, fmtClock, clamp, depthMapper } = window.WRUI;

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
          else {
            let extra = ln.c >= 50 ? `<br><small>${fmtNum(ln.c * 3.6)} km/h</small>` : '';
            if (this.race.endOnFirst) extra += `<br><small>진행 ${(ln.x / this.sim.length * 100).toFixed(ln.x / this.sim.length < 0.1 ? 2 : 0)} %</small>`;
            lv.speed.innerHTML = esc(fmtSpeed(ln.c)) + extra;
          }
        }
      }
    }

    /** 레인 헤더에 쇄파 순번 뱃지 (R4처럼 쇄파 지점이 촘촘해도 순서가 보이도록) */
    markBreakOrder(ln, order) {
      const lv = this.lanes[ln.index]; if (!lv || lv.orderBadge) return;
      lv.orderBadge = el('span', { class: 'badge order' }, `쇄파 ${order}번째`);
      lv.speed.parentNode.appendChild(lv.orderBadge);
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

  window.RaceView = RaceView;
  window.WRUI.laneSpecText = laneSpecText;
})();
