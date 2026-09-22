/* 물리·경기 데이터 회귀 테스트: node test/physics.test.js */
const assert = require('assert');
const P = require('../js/physics.js');
const R = require('../js/races.js');
const O = require('../js/otter.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// 1. 검증 수치
const w300 = P.makeWave({ lambda0: 300 }, 200);
near(P.waveState(w300, 200).c, 21.6, 0.1, 'λ300 h200 c');
near(P.waveState(w300, 10).c, 9.6, 0.1, 'λ300 h10 c');
near(P.waveState(w300, 10).lambda, 133, 1, 'λ300 h10 λ');
near(P.waveState(w300, 1).c, 3.1, 0.05, 'λ300 h1 c');
near(P.waveState(w300, 1).H, 1.87, 0.02, 'λ300 h1 H');
assert.ok(P.waveState(w300, 1).breaking, 'λ300 h1 breaks');
const w15 = P.makeWave({ lambda0: 15 }, 200);
near(P.waveState(w15, 200).c, 4.8, 0.05, 'λ15 h200 c');
near(P.waveState(w15, 3).c, 4.3, 0.05, 'λ15 h3 c');
const wt = P.makeWave({ lambda0: 200000, H0: 0.5 }, 4000);
near(P.waveState(wt, 4000).c, 198, 1, 'tsunami c');
assert.strictEqual(P.waveState(wt, 4000).regime, 'shallow', 'tsunami shallow at 4000 m');

// 2. 뉴턴법 수렴 (극단 포함)
for (const lam of [15, 300, 200000]) for (const h0 of [1, 200, 4000]) {
  const w = P.makeWave({ lambda0: lam }, h0);
  for (const h of [0.5, 1, 2, 30, 200, 4000]) {
    const k = P.solveK(w.omega, h);
    const res = Math.abs(P.G * k * Math.tanh(k * h) - w.omega ** 2) / w.omega ** 2;
    assert.ok(res < 1e-8, `Newton residual λ=${lam} h0=${h0} h=${h}: ${res}`);
  }
}

// 3. 경기 결과 (베팅 정답이 스펙과 일치하는지)
function sim(race, lanesBathy, step = 0.1) {
  const lanes = race.lanes.map((ls, i) => ({ wave: ls.wave, bathy: lanesBathy[i], start: ls.start || 0 }));
  return P.createSim({ length: race.length, lanes }).completeAll(step, 5e6);
}
const byName = (s, n) => s.lanes.find(l => l.wave.name === n);
const r1 = R.byId('r1'); const s1 = sim(r1, r1.lanes.map(() => r1.bathy));
assert.strictEqual(byName(s1, '너울').rank, 1, 'R1 winner 너울');
assert.strictEqual(byName(s1, '잔물결').rank, 4, 'R1 last 잔물결');
const r3 = R.byId('r3'); const s3 = sim(r3, r3.lanes.map(() => r3.bathy));
assert.strictEqual(s3.lanes[0].rank, 1, 'R3 T=14 wins');
const r4 = R.byId('r4'); const s4 = sim(r4, r4.lanes.map(() => r4.bathy));
assert.strictEqual(byName(s4, '너울').rank, 1, 'R4 winner 너울 (순위 유지)');
const breakOrder = s4.lanes.slice().sort((a, b) => a.brokenT - b.brokenT).map(l => l.wave.name);
assert.deepStrictEqual(breakOrder, ['너울', '긴 파도', '풍랑', '잔물결'], 'R4 break order');
const r5 = R.byId('r5'); const s5 = sim(r5, r5.lanes.map(l => l.bathy));
assert.strictEqual(byName(s5, '절벽 레인').rank, 1, 'R5 cliff wins');
const r6 = R.byId('r6');
const g = r6.heats.map(h => { const s = sim(r6, r6.lanes.map(() => h.bathy)); return byName(s, '잔물결').finishTime - byName(s, '너울').finishTime; });
assert.ok(g[1] > g[0], `R6 cliff gap larger: ${g}`);
// 월드 3: 각 의뢰는 초기 설계에서 실패하고, 알려진 설계로 성공해야 한다
const w3 = (id, d) => { const r = R.byId(id); const b = R.designCourse(d); return sim(r, r.lanes.map(() => b)); };
assert.notStrictEqual(byName(w3('r7', R.byId('r7').design.initial), '너울').rank, 1, 'R7 initial fails');
assert.strictEqual(byName(w3('r7', { xs: 2500, hmid: 20 }), '너울').rank, 1, 'R7 solvable');
assert.notStrictEqual(byName(w3('r8', R.byId('r8').design.initial), '잔물결').rank, 1, 'R8 initial fails');
assert.strictEqual(byName(w3('r8', { xs: 200, hmid: 1 }), '잔물결').rank, 1, 'R8 solvable');
const b9i = byName(w3('r9', R.byId('r9').design.initial), '너울').brokenAt;
assert.ok(!(b9i >= 2600 && b9i <= 2800), 'R9 initial fails');
const b9 = byName(w3('r9', { xs: 2550, hmid: 2 }), '너울').brokenAt;
assert.ok(b9 >= 2600 && b9 <= 2800, `R9 solvable: ${b9}`);
const boss = R.byId('boss'); const sb = sim(boss, boss.lanes.map(() => boss.bathy), boss.step);
near(byName(sb, '쓰나미').finishTime / 3600, 24, 1, 'boss ~24 h');
assert.ok(byName(sb, '너울').finishTime / 86400 > 8, 'boss swell ~9 days');

// 4. 데이터 정합성
for (const r of R.RACES) {
  assert.ok(R.WORLDS[r.world], `world for ${r.id}`);
  for (const c of r.cards) assert.ok(R.CARDS[c], `card ${c}`);
  for (const w of r.codex) assert.ok(R.CODEX.find(x => x.id === w), `codex ${w}`);
  assert.ok(O.has('paddock', r.id), `paddock line for ${r.id}`);
}
assert.strictEqual(R.CODEX.length, 12, '도감 12칸');
let n = 0; for (const k in O.LINES.common) n += O.LINES.common[k].length;
for (const r in O.LINES.races) for (const k in O.LINES.races[r]) n += O.LINES.races[r][k].length;
assert.ok(n >= 40, `otter lines ${n}`);
console.log('physics/data tests passed');
