/* ============================================================
 * 파도 레이스 — 진행·화면 (js/game.js)
 * 패독 → 베팅 → 레이스 → 정산 → 도감 → 다음 경기
 * ============================================================ */
(function () {
  'use strict';

  const P = window.Physics, R = window.Races, O = window.Otter;
  const { reduceMotion, $, esc, el, svgEl, fmtNum, fmtTime, fmtSpeed, fmtDist, fmtDepth, wait, clamp, courseSVG } = window.WRUI;
  const RaceView = window.RaceView;

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
  const THEME_KEY = 'waveRace.theme';
  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    $('#btnTheme').textContent = dark ? '☀️' : '🌙';
  }
  try { applyTheme(localStorage.getItem(THEME_KEY) === 'dark'); } catch (e) { /* 무시 */ }
  $('#btnTheme').addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') !== 'dark';
    applyTheme(dark);
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (e) { /* 무시 */ }
  });

  function setTopbar(worldName, raceName) {
    tbWorld.textContent = worldName || '';
    tbRace.textContent = raceName || '';
  }
  function setChrome({ top = true, caster = true } = {}) {
    topbar.hidden = !top;
    casterBar.hidden = !caster;
    lockCodex(false);
  }
  /** 경기 중에는 도감을 열 수 없다 (레이스 루프가 뒤에서 계속 돌지 않도록) */
  function lockCodex(lock) {
    const b = $('#btnCodex');
    b.disabled = !!lock;
    b.title = lock ? '경기 중에는 열 수 없습니다' : '';
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
      // 동시 도착(0.5초 이내)은 같은 순위
      ranked.forEach((l, i) => { l.rank = (i > 0 && Math.abs(ft(l) - ft(ranked[i - 1])) < 0.5) ? ranked[i - 1].rank : i + 1; l.tie = false; });
      ranked.forEach(l => { l.tie = ranked.filter(o => o.rank === l.rank).length > 1; });
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
      else if (this.stage === 'race') { /* 경기 중엔 도감이 잠기므로 도달하지 않음 */ }
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
        let saidLead = false, saidGap = false, gapPeak = 0, lastLaneEventAt = 0, breakCount = 0;
        const shallowSaid = new Set();
        const raceId = race.id;
        const timedLines = O.timed(raceId);
        lockCodex(true);

        const finish = (skipped) => {
          if (finished) return; finished = true;
          cancelAnimationFrame(rafId);
          view.destroy();
          lockCodex(false);
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
              breakCount++;
              view.markBreakOrder(ln, breakCount);
              if (ln.brokenAt <= ln.start + 1e-6) {
                // 출발선부터 쇄파 (파고 1 m 파도가 수심 1 m 물에 놓인 경우) — 연출 없이 해설만
                Caster.event(line('breakAtStart', { name: ln.wave.name, h: ln.brokenH.toFixed(1) }), 2600);
              } else {
                view.wipeout(ln);
                Caster.event(line('breaking', { name: ln.wave.name, H: ln.state.H.toFixed(2), h: ln.brokenH.toFixed(1) }), 2000);
              }
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
                }
              } else {
                Caster.event(line('finishNext', { name: ln.wave.name, rank: ev.rank, time: fmtTime(ln.finishTime) }), 1500);
              }
            }
          }
          // 중계: 시간 트리거 대사(otter.js 데이터) / 선두 / 격차
          const elapsed = (now - startReal) / 1000;
          if (hi === 0) for (const tl of timedLines) {
            if (!tl.done && sim.t >= tl.at * heat.winnerTime) {
              tl.done = true;
              const lead = sim.leader();
              Caster.event(O.fill(tl.text, { leader: lead.wave.name, gap: fmtDist(sim.gap()) }), 2600);
            }
          }
          if (!saidLead && elapsed > 3.5 && !timedLines.length) {
            saidLead = true;
            Caster.event(line('lead', { name: sim.leader().wave.name }), 2000);
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
      const out = { race, plan, bets: [], gained: 0, bonus: 0, design: null, newCards: [], updatedCards: [], newCodex: [] };
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
        } else if (bet.type === 'choice') answer = bet.answers ? bet.answers[0] : bet.answer;
        const okSet = bet.answers || (answer != null ? [answer] : []);
        const correct = choice != null && okSet.includes(choice);
        const pts = correct && official ? bet.points : 0;
        out.gained += pts;
        if (official) this.bumpStreak(out, correct);
        out.bets.push({ bet, choice, answer, correct, points: pts, choiceLabel: options[choice] ? options[choice].name : '—',
          answerLabel: okSet.map(a => options[a] ? options[a].name : '—').join(' 또는 '),
          explain: betExplain(race, plan, bet, choice, answer) });
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
      if (race.decider) {
        betPanel.appendChild(el('div', { class: 'decider' },
          el('span', { class: 'decider-label' }, '이번 경기에서 속도를 정한 것'),
          el('span', { class: 'decider-text' }, race.decider.text),
          race.decider.note ? el('span', { class: 'decider-note' }, race.decider.note) : null));
      }
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
          el('span', { class: 'pts' }, official ? `+${b.points}` : '시운전'),
          b.explain ? el('span', { class: 'explain' }, b.explain) : null));
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
            el('td', { class: 'rank' }, ln.tie ? `${ln.rank}위 (동시)` : `${ln.rank}위`),
            el('td', {}, `${ln.wave.emoji || ''} ${ln.wave.name}`),
            el('td', { class: 'num' }, timeCell),
            el('td', { class: 'num' }, `${fmtSpeed(ln.maxC)} → ${fmtSpeed(ln.minC)}`),
            el('td', {}, ln.brokenAt != null ? `${fmtNum(ln.brokenAt)} m (수심 ${fmtDepth(ln.brokenH)})` : '—')));
        });
        tbl.appendChild(tb);
        panel.appendChild(el('div', { class: 'table-wrap' }, tbl));
        if (plan.heats.length > 1) panel.appendChild(el('p', { class: 'muted' }, `도착 시간 차: ${fmtTime(h.lastTime - h.winnerTime)}`));
        const extra = resultsExtra(race, h);
        if (extra.childNodes.length) panel.appendChild(el('details', { class: 'formula-details' }, el('summary', {}, '공식으로 확인하기'), extra));
        app.appendChild(panel);
      });

      // 포인트·도감·카드
      if (official && firstTime) {
        res.applied = true;
        if (res.gained) setTimeout(() => awardPoints(res.gained), 300);
        const designOk = !res.design || res.design.ok;
        if (designOk) {
          progress.cleared[race.id] = true;
          const summary = race.design ? designSummary(race, this.design, res.design) : raceSummary(race, plan);
          for (const cid of race.cards) {
            const entry = progress.codex[cid];
            if (!entry) {
              progress.codex[cid] = { race: race.id, summary, entries: race.design ? { [race.id]: summary } : undefined };
              res.newCards.push(cid);
            } else if (entry.race !== race.id) {
              // 같은 카드를 여러 경기가 채우면(⑦ 설계 의뢰, ① 파고 대결) 기록을 누적한다
              entry.entries = entry.entries || { [entry.race]: entry.summary };
              if (!entry.entries[race.id]) { entry.entries[race.id] = summary; res.updatedCards.push(cid); }
            }
          }
          for (const wid of race.codex) if (!progress.codex[wid]) { progress.codex[wid] = { race: race.id, summary }; res.newCodex.push(wid); }
          saveProgress();
        }
        session.results.push({ race: race.id, title: `${race.no} ${race.title}`, points: res.gained });
      }
      const designOk = !res.design || res.design.ok;
      if (official && designOk && (res.newCards.length || res.updatedCards.length || res.newCodex.length)) {
        const row = el('div', { class: 'cards-row' });
        const allCards = res.newCards.map(id => ({ id, updated: false })).concat(res.updatedCards.map(id => ({ id, updated: true })));
        allCards.forEach(({ id: cid, updated }, i) => {
          const c = R.CARDS[cid];
          const fc = el('div', { class: 'flip-card' }, el('div', { class: 'flip-inner' },
            el('div', { class: 'flip-face flip-front' }, updated ? '+' : '?'),
            el('div', { class: 'flip-face flip-back' }, el('span', { class: 'no' }, `원리 카드 ${c.no}${updated ? ' · 기록 추가' : ''}`), el('span', { class: 'title' }, c.title), el('span', { class: 'formula' }, c.formula), el('span', { class: 'line' }, updated ? `${race.no} 결과가 카드에 추가됐습니다.` : c.line))));
          row.appendChild(fc);
          setTimeout(() => fc.classList.add('flipped'), 500 + i * 450);
        });
        res.newCodex.forEach((wid, i) => {
          const c = R.CODEX.find(x => x.id === wid);
          const fc = el('div', { class: 'flip-card' }, el('div', { class: 'flip-inner' },
            el('div', { class: 'flip-face flip-front' }, '?'),
            el('div', { class: 'flip-face flip-back' }, el('span', { class: 'no' }, '파도 도감'), el('span', { class: 'title' }, `${c.emoji} ${c.name}`), el('span', { class: 'line' }, c.desc))));
          row.appendChild(fc);
          setTimeout(() => fc.classList.add('flipped'), 500 + (allCards.length + i) * 450);
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
      if (official && res.updatedCards.length && !res.newCards.length) Caster.event(line('codex'), 3000);
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


    /* ---------- 월드 3: 코스 편집기 (js/editor.js) ---------- */
    showEditor() {
      this.stage = 'editor';
      window.WaveRaceEditor.buildEditor(this);
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
  /** 정산에서 "왜 맞았/틀렸는지" 한 줄: 내 선택과 정답의 근거를 나란히 */
  function betExplain(race, plan, bet, choice, answer) {
    const h = plan.heats[0];
    const laneLine = (i) => {
      const ln = h.pre.lanes[i]; if (!ln) return '';
      const w = ln.wave;
      const lam = race.hideLambda ? `T = ${w.T.toFixed(0)} s → λ ≈ ${fmtNum(w.lambdaDeep)} m` : `λ₀ ${fmtDist(w.lambda0)}`;
      if (bet.type === 'firstBreak') return `${w.name}: ${lam}, ${ln.brokenAt != null ? `${fmtNum(ln.brokenAt)} m(수심 ${fmtDepth(ln.brokenH)})에서 ${fmtTime(ln.brokenT)}에 쇄파` : '부서지지 않음'}`;
      return `${w.name}: ${lam} → 최고 ${fmtSpeed(ln.maxC)}, 도착 ${fmtTime(ln.finishTime)}`;
    };
    if (bet.type === 'winner' || bet.type === 'firstBreak') {
      const parts = [];
      if (choice !== answer && choice != null) parts.push('내 예측 ' + laneLine(choice));
      if (answer != null) parts.push('정답 ' + laneLine(answer));
      return parts.join(' · ');
    }
    if (bet.why) return bet.why;
    if (bet.type === 'gap') return plan.heats.map(hh => `${hh.short}: 격차 ${fmtTime(hh.lastTime - hh.winnerTime)}`).join(' · ');
    if (bet.type === 'choice' && race.id === 'boss') {
      const ts = h.pre.lanes.reduce((a, b) => (b.maxC > a.maxC ? b : a));
      return `17,000,000 m ÷ √(9.8 × 4,000) ≈ ${Math.round(ts.maxC)} m/s → ${fmtTime(ts.finishTime)}`;
    }
    return '';
  }
  function designSummary(race, d, dres) {
    const cfg = `얕아지기 ${fmtNum(d.xs)} m · 수심 ${fmtDepth(d.hmid)}${d.sandbar && d.hmid > 5 ? ' · 사주' : ''}`;
    return `${race.no} 성공 (${cfg}) → ${dres.detail}`;
  }
  function raceSummary(race, plan) {
    const h = plan.heats[0];
    const w = h.ranked[0], l = h.ranked[h.ranked.length - 1];
    let s = `1위 ${w.wave.name} ${fmtTime(w.finishTime)}`;
    if (w.tie) s = `${h.ranked.filter(x => x.rank === 1).map(x => x.wave.name).join('·')} 동시 도착 ${fmtTime(w.finishTime)}`;
    else if (h.ranked.length > 1) s += ` · 꼴찌 ${l.wave.name} ${race.endOnFirst ? '약 ' : ''}${fmtTime(l.finishTime)}`;
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
      buttons.appendChild(el('p', { class: 'title-note', style: 'margin:0' }, '점수는 저장되지 않아 이어하기는 0점부터 다시 셉니다. 최종 등급은 이번에 치른 경기 기준입니다.'));
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
          if (got.entries) {
            const ul = el('ul', { class: 'entry-list' });
            Object.keys(got.entries).forEach(rid => { const rr = R.byId(rid); ul.appendChild(el('li', {}, `${rr ? rr.no + ' · ' : ''}${got.entries[rid]}`)); });
            cell.appendChild(ul);
          } else cell.appendChild(el('span', { class: 'summary' }, `등록 경기 ${R.byId(got.race).no} · ${got.summary}`));
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
      el('p', { class: 'muted' }, R.GRADES.slice().reverse().map((g, i, arr) => `${g.min}${arr[i + 1] ? '~' + (arr[i + 1].min - 1) : '+'} ${g.name}`).join(' · ')),
      session.results.length < R.RACES.length ? el('p', { class: 'muted' }, `이번 세션에서 치른 ${session.results.length}경기 기준입니다. 이어하기 이전 경기는 포함되지 않습니다.`) : null));
    if (session.results.length) app.appendChild(el('div', { class: 'panel' }, el('h3', {}, '이번 세션 경기 기록'), ul));
    Caster.say(line('final'));
    setActions(btn('📖 도감', () => showCodex(showFinal), 'ghost'), btn('처음으로', showTitle));
  }

  /* ---------- 시작 ---------- */
  window.WaveRaceCore = { app, Caster, setActions, btn, line, progress: () => progress, session };
  renderPoints();
  showTitle();
  window.WaveRace = { Physics: P, Races: R, Otter: O, session, progress, startRace, showTitle, showCodex, showTeacher, buildPlan };
})();
