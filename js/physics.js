/* ============================================================
 * 파도 레이스 — 파동 물리 (js/physics.js)
 *
 * 모든 파도는 주기 T(각진동수 ω)가 일정한 파열로 취급한다.
 * 어떤 수심에서도 분산 관계식 ω² = g·k·tanh(kh) 하나로 상태를 구한다.
 * (심해/천해를 if문으로 나누지 않는다 — 쓰나미도 같은 함수를 쓴다.)
 * ============================================================ */
(function (global) {
  'use strict';

  const G = 9.8;
  const TWO_PI = 2 * Math.PI;
  const BREAK_RATIO = 0.78; // 쇄파 조건 H ≥ 0.78·h

  /** ω² = g·k·tanh(kh)를 k에 대해 뉴턴법으로 푼다. 초기값 k = ω²/g. */
  function solveK(omega, h) {
    const w2 = omega * omega;
    let k = w2 / G;
    // 보통 10회 안에 수렴하지만, 극단적인 (긴 주기·얕은 수심) 경우를 위해 허용 오차까지 반복
    for (let i = 0; i < 40; i++) {
      const kh = k * h;
      const th = Math.tanh(kh);
      const f = G * k * th - w2;
      const sech2 = 1 - th * th;
      const df = G * th + G * k * h * sech2;
      if (df <= 0) break;
      const dk = f / df;
      k -= dk;
      if (k <= 0) k = w2 / G * 0.5;
      if (Math.abs(dk) < 1e-13 * k) break;
    }
    return k;
  }

  /** 각진동수 ω인 파열이 수심 h에서 갖는 국지 상태 */
  function localState(omega, h) {
    const k = solveK(omega, h);
    const c = omega / k;
    const kh = k * h;
    const s2 = Math.sinh(2 * kh);
    const n = 0.5 * (1 + (isFinite(s2) && s2 > 0 ? (2 * kh) / s2 : 0));
    const cg = c * n;
    return { k, c, cg, n, lambda: TWO_PI / k, kh };
  }

  /** 수심/파장 비로 심해파·천이·천해파 판정 */
  function regimeOf(h, lambda) {
    const r = h / lambda;
    if (r >= 0.5) return 'deep';
    if (r <= 0.05) return 'shallow';
    return 'transition';
  }

  /**
   * 파도 선수 만들기.
   * spec: { lambda0 } 또는 { T }, H0(기본 1.0)
   * h0: 출발 수심 — ω는 ω² = g·k0·tanh(k0·h0)로 정한다.
   */
  function makeWave(spec, h0) {
    let omega, k0;
    if (spec.T) {
      omega = TWO_PI / spec.T;
      k0 = solveK(omega, h0);
    } else {
      k0 = TWO_PI / spec.lambda0;
      omega = Math.sqrt(G * k0 * Math.tanh(k0 * h0));
    }
    const s0 = localState(omega, h0);
    return {
      name: spec.name,
      emoji: spec.emoji,
      lambda0: TWO_PI / k0,
      lambdaDeep: G * (TWO_PI / omega) * (TWO_PI / omega) / TWO_PI, // λ = gT²/2π
      T: TWO_PI / omega,
      omega,
      k0,
      h0,
      H0: spec.H0 == null ? 1.0 : spec.H0,
      c0: s0.c,
      cg0: s0.cg,
    };
  }

  /** 수심 h에서 파도의 상태 (속도·파장·군속도·천수 파고·판정·쇄파 여부) */
  function waveState(wave, h) {
    const st = localState(wave.omega, h);
    const H = wave.H0 * Math.sqrt(wave.cg0 / st.cg);
    return {
      k: st.k,
      c: st.c,
      cg: st.cg,
      lambda: st.lambda,
      H,
      regime: regimeOf(h, st.lambda),
      breaking: H >= BREAK_RATIO * h,
    };
  }

  /** 부서진 뒤의 진행 속도 √(gh) */
  function brokenSpeed(h) {
    return Math.sqrt(G * h);
  }

  /** 해저 지형 [[x,h],…] 선형 보간 */
  function depthAt(bathy, x) {
    const n = bathy.length;
    if (x <= bathy[0][0]) return bathy[0][1];
    if (x >= bathy[n - 1][0]) return bathy[n - 1][1];
    for (let i = 1; i < n; i++) {
      const [x1, h1] = bathy[i];
      if (x <= x1) {
        const [x0, h0] = bathy[i - 1];
        const t = x1 === x0 ? 1 : (x - x0) / (x1 - x0);
        return h0 + (h1 - h0) * t;
      }
    }
    return bathy[n - 1][1];
  }

  function maxDepth(bathy) {
    return bathy.reduce((m, p) => Math.max(m, p[1]), 0);
  }

  /**
   * 경기 시뮬레이션.
   * lanesSpec: [{ wave: spec, bathy, start }]
   * length: 코스 길이(m). 각 레인은 자기 지형의 출발 수심으로 파도를 만든다.
   * 매 스텝 x += c(h(x))·dt. 이벤트(얕은 물 진입·쇄파·결승)를 큐에 쌓는다.
   */
  function createSim(opts) {
    const L = opts.length;
    const lanes = opts.lanes.map((ls, i) => {
      const bathy = ls.bathy;
      const start = ls.start || 0;
      // 파도의 ω는 코스 앞바다(x=0) 수심에서 정의한다. 핸디캡으로 앞에서 출발해도 같은 파도다.
      const h0 = ls.refDepth != null ? ls.refDepth : depthAt(bathy, 0);
      const wave = makeWave(ls.wave, h0);
      const hs = depthAt(bathy, start);
      return {
        index: i,
        id: ls.id || ('lane' + i),
        wave,
        bathy,
        start,
        x: start,
        t: 0,
        h: hs,
        c: waveState(wave, hs).c,
        state: waveState(wave, hs),
        regime: waveState(wave, hs).regime,
        seenShallow: false,
        seenTransition: false,
        broken: false,
        brokenAt: null,
        brokenT: null,
        brokenH: null,
        finished: false,
        finishTime: null,
        maxC: wave.c0,
        minC: wave.c0,
        maxH: wave.H0,
        rank: null,
      };
    });
    const sim = {
      length: L,
      lanes,
      t: 0,
      events: [],
      finishedCount: 0,
      done: false,
      step(dt) {
        if (sim.done) return;
        for (const ln of lanes) {
          if (ln.finished) continue;
          const h = depthAt(ln.bathy, ln.x);
          const st = waveState(ln.wave, h);
          ln.h = h;
          ln.state = st;
          if (!ln.broken && st.breaking) {
            ln.broken = true;
            ln.brokenAt = ln.x;
            ln.brokenT = ln.t;
            ln.brokenH = h;
            sim.events.push({ type: 'break', lane: ln, x: ln.x, t: ln.t });
          }
          const c = ln.broken ? brokenSpeed(h) : st.c;
          ln.c = c;
          if (c > ln.maxC) ln.maxC = c;
          if (c < ln.minC) ln.minC = c;
          if (st.H > ln.maxH && !ln.broken) ln.maxH = st.H;
          const reg = ln.broken ? 'broken' : st.regime;
          if (reg !== ln.regime) {
            ln.regime = reg;
            if (reg === 'shallow' && !ln.seenShallow) {
              ln.seenShallow = true;
              sim.events.push({ type: 'shallow', lane: ln, x: ln.x, t: ln.t });
            } else if (reg === 'transition' && !ln.seenTransition) {
              ln.seenTransition = true;
              sim.events.push({ type: 'transition', lane: ln, x: ln.x, t: ln.t });
            }
          }
          const nx = ln.x + c * dt;
          if (nx >= L) {
            const frac = (L - ln.x) / (nx - ln.x);
            ln.finishTime = ln.t + frac * dt;
            ln.x = L;
            ln.t = ln.finishTime;
            ln.finished = true;
            sim.finishedCount++;
            ln.rank = sim.finishedCount;
            sim.events.push({ type: 'finish', lane: ln, t: ln.finishTime, rank: ln.rank });
          } else {
            ln.x = nx;
            ln.t += dt;
          }
        }
        sim.t += dt;
        if (sim.finishedCount === lanes.length) sim.done = true;
      },
      /** 남은 선수들을 즉시 완주시킨다(결과 계산용). */
      completeAll(dt, maxT) {
        const limit = maxT || 1e7;
        let guard = 0;
        while (!sim.done && sim.t < limit && guard++ < 5e6) sim.step(dt);
        return sim;
      },
      leader() {
        let best = null;
        for (const ln of lanes) if (!best || ln.x > best.x) best = ln;
        return best;
      },
      last() {
        let worst = null;
        for (const ln of lanes) if (!worst || ln.x < worst.x) worst = ln;
        return worst;
      },
      gap() {
        const a = sim.leader(), b = sim.last();
        return a && b ? a.x - b.x : 0;
      },
    };
    return sim;
  }

  /** 검증 수치 출력 (콘솔용) */
  function selfCheck() {
    const rows = [];
    const w300 = makeWave({ lambda0: 300 }, 200);
    [[200], [10], [1]].forEach(([h]) => {
      const s = waveState(w300, h);
      rows.push({ 'λ0': 300, h, c: +s.c.toFixed(2), 'λ': +s.lambda.toFixed(1), H: +s.H.toFixed(2), 쇄파: s.breaking, 판정: s.regime });
    });
    const w15 = makeWave({ lambda0: 15 }, 200);
    [[200], [3]].forEach(([h]) => {
      const s = waveState(w15, h);
      rows.push({ 'λ0': 15, h, c: +s.c.toFixed(2), 'λ': +s.lambda.toFixed(1), H: +s.H.toFixed(2), 쇄파: s.breaking, 판정: s.regime });
    });
    const wt = makeWave({ lambda0: 200000, H0: 0.5 }, 4000);
    const st = waveState(wt, 4000);
    rows.push({ 'λ0': 200000, h: 4000, c: +st.c.toFixed(1), 'λ': +st.lambda.toFixed(0), H: +st.H.toFixed(2), 쇄파: st.breaking, 판정: st.regime });
    if (typeof console !== 'undefined' && console.table) console.table(rows);
    return rows;
  }

  const Physics = {
    G, TWO_PI, BREAK_RATIO,
    solveK, localState, regimeOf, makeWave, waveState, brokenSpeed,
    depthAt, maxDepth, createSim, selfCheck,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Physics;
  global.Physics = Physics;
})(typeof window !== 'undefined' ? window : globalThis);
