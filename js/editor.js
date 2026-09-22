/* ============================================================
 * 파도 레이스 — 월드 3 코스 편집기 (js/editor.js)
 * 조절점 드래그/키보드 · 슬라이더 · 사주 토글
 * ============================================================ */
(function () {
  'use strict';
  const P = window.Physics, R = window.Races, O = window.Otter;
  const { el, svgEl, fmtNum, fmtDist, fmtDepth, clamp, depthMapper } = window.WRUI;

  /** flow: RaceFlow 인스턴스 (race, design 상태, runAll 사용) */
  function buildEditor(flow) {
    const { app, Caster, setActions, btn, line } = window.WaveRaceCore;
    const race = flow.race, d = race.design, st = flow.design;
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
    const mkHandle = (label) => {
      const g = svgEl('g', { class: 'handle-g', tabindex: 0, role: 'slider', 'aria-label': label }, svg);
      svgEl('circle', { class: 'handle-hit', r: 34 }, g);
      svgEl('circle', { class: 'handle', r: 15 }, g);
      return g;
    };
    const h1 = mkHandle('얕아지기 시작 지점 (좌우 화살표)');
    const h2 = mkHandle('중간 수심 (상하 화살표)');
    const l1 = svgEl('text', { class: 'handle-label', 'text-anchor': 'middle' }, svg);
    const l2 = svgEl('text', { class: 'handle-label', 'text-anchor': 'middle' }, svg);
    const tick = svgEl('text', { x: 6, y: yOf(200) - 4, class: 'handle-label' }, svg); tick.textContent = '수심 200 m';
    left.appendChild(svg);

    // 슬라이더
    const LIM = R.DESIGN_LIMITS;
    const HMIN = LIM.hMin, HMAX = LIM.hMax;
    const roundH = h => (h < 5 ? Math.round(h * 10) / 10 : Math.round(h));
    const hToSlider = h => Math.round(Math.log(h / HMIN) / Math.log(HMAX / HMIN) * 100);
    const sliderToH = v => roundH(HMIN * Math.pow(HMAX / HMIN, v / 100));
    const controls = el('div', { class: 'panel' });
    const xsVal = el('span', { class: 'val num' }), hVal = el('span', { class: 'val num' });
    const xsIn = el('input', { type: 'range', id: 'edXs', min: LIM.xsMin, max: LIM.xsMax, step: LIM.xsStep, value: st.xs });
    const hIn = el('input', { type: 'range', id: 'edH', min: 0, max: 100, step: 1, value: hToSlider(st.hmid) });
    const sbIn = el('input', { type: 'checkbox', id: 'edSb' }); sbIn.checked = !!st.sandbar;
    controls.appendChild(el('div', { class: 'slider-row' }, el('label', { for: 'edXs' }, '① 얕아지기 시작 지점'), xsVal, xsIn));
    controls.appendChild(el('div', { class: 'slider-row' }, el('label', { for: 'edH' }, '② 중간(대륙붕) 수심'), hVal, hIn));
    controls.appendChild(el('div', { class: 'check-row' }, sbIn, el('label', { for: 'edSb' }, '③ 사주(수심 5 m 언덕) 넣기 — 중간 수심이 5 m보다 깊을 때만')));
    controls.appendChild(el('p', { class: 'muted' }, '해안(3,000 m) 수심은 1 m로 고정. 조절점을 드래그하거나(키보드: 조절점 포커스 후 화살표) 슬라이더를 쓰세요.'));
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
      h1.setAttribute('aria-valuenow', st.xs); h1.setAttribute('aria-valuetext', `${fmtNum(st.xs)} m`);
      h2.setAttribute('aria-valuenow', st.hmid); h2.setAttribute('aria-valuetext', fmtDepth(st.hmid));
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
    drag(h1, p => { st.xs = clamp(Math.round(xOf(p.x) / LIM.xsStep) * LIM.xsStep, LIM.xsMin, LIM.xsMax); });
    drag(h2, p => { st.hmid = roundH(clamp(hOf(p.y), HMIN, HMAX)); });
    // 키보드: 조절점에 포커스 후 화살표 (Shift로 큰 걸음)
    h1.addEventListener('keydown', e => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return; e.preventDefault();
      st.xs = clamp(st.xs + dir * LIM.xsStep * (e.shiftKey ? 5 : 1), LIM.xsMin, LIM.xsMax); redraw();
    });
    h2.addEventListener('keydown', e => {
      const dir = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
      if (!dir) return; e.preventDefault();
      st.hmid = sliderToH(clamp(hToSlider(st.hmid) + dir * (e.shiftKey ? 10 : 3), 0, 100)); redraw();
    });
    redraw();

    Caster.say(O.has('paddock', race.id) ? line('paddock', null, race.id) : line('paddock'));
    setActions(btn('시운전 🔧', () => flow.runAll('test'), 'secondary'), btn('제출 🏁', () => flow.runAll('official')));
  }

  window.WaveRaceEditor = { buildEditor };
})();
