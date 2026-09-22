/* ============================================================
 * 파도 레이스 — 공용 UI 유틸 (js/ui.js)
 * DOM/SVG 생성, 숫자·시간 포맷, 코스 단면 SVG
 * ============================================================ */
(function () {
  'use strict';
  const P = window.Physics;
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

  window.WRUI = { SVG_NS, reduceMotion, $, esc, el, svgEl, fmtNum, fmtTime, fmtClock, fmtSpeed, fmtDist, fmtDepth, wait, clamp, depthMapper, courseSVG };
})();
