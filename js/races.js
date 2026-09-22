/* ============================================================
 * 파도 레이스 — 월드·경기·도감 데이터 (js/races.js)
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 파도 선수 ---------- */
  const WAVES = {
    ripple:  { id: 'ripple',  name: '잔물결', emoji: '🫧', lambda0: 15,     H0: 1.0 },
    wind:    { id: 'wind',    name: '풍랑',   emoji: '💨', lambda0: 60,     H0: 1.0 },
    long:    { id: 'long',    name: '긴 파도', emoji: '🌊', lambda0: 120,    H0: 1.0 },
    swell:   { id: 'swell',   name: '너울',   emoji: '🌀', lambda0: 300,    H0: 1.0 },
    tsunami: { id: 'tsunami', name: '쓰나미', emoji: '🌋', lambda0: 200000, H0: 0.5 },
  };

  /* ---------- 코스 (해저 지형: [[x, h], …] 선형 보간) ---------- */
  const L = 3000;
  /** 앞바다 200 m에서 xs 지점부터 얕아져 해안 1 m까지 */
  function coast(xs, len) {
    const len_ = len || L;
    const r = len_ - xs;
    return [[0, 200], [xs, 200], [xs + r * 0.45, 10], [xs + r * 0.65, 3], [len_, 1]];
  }
  const COURSES = {
    deep: [[0, 200], [L, 200]],
    gentle: coast(600),
    basic: coast(1800),
    cliff: coast(2700),
    sandbar: [[0, 200], [1200, 200], [1500, 5], [1700, 5], [2000, 200], [2700, 200], [2835, 10], [2895, 3], [L, 1]],
    pacific: [[0, 4000], [16800000, 4000], [17000000, 30]],
  };

  /**
   * 월드 3 편집기용 지형 생성.
   * xs: 얕아지기 시작 지점(m), hmid: 대륙붕 수심(m), sandbar: 사주 유무
   * 모양: 앞바다 200 m → (150 m에 걸쳐) hmid → 평평 → 2,700 m부터 해안 1 m
   */
  function designCourse(d) {
    const xs = d.xs, hmid = d.hmid;
    const xe = xs + 150;
    const xc = Math.max(xe, 2700);
    const b = [[0, 200], [xs, 200], [xe, hmid]];
    if (d.sandbar && hmid > 5 && xc - xe > 320) {
      const xm = (xe + xc) / 2;
      b.push([xm - 150, hmid], [xm - 60, 5], [xm + 60, 5], [xm + 150, hmid]);
    }
    b.push([xc, hmid], [L, 1]);
    return b;
  }

  /* ---------- 월드 ---------- */
  const WORLDS = {
    w1:   { id: 'w1',   name: '월드 1 · 먼바다 그랑프리', sub: '수심 200 m 일정 · 코스 3,000 m' },
    w2:   { id: 'w2',   name: '월드 2 · 해안 클래식',     sub: '앞바다 200 m → 해안 1 m' },
    w3:   { id: 'w3',   name: '월드 3 · 코스 설계사',     sub: '해저 지형을 직접 편집' },
    boss: { id: 'boss', name: '보스전 · 쓰나미 특별전',   sub: '칠레 → 일본 17,000 km' },
  };

  /* ---------- 원리 카드 ---------- */
  const CARDS = {
    c1: { id: 'c1', no: '①', title: '심해파는 파장이 길수록 빠르다', formula: 'c = √(gλ / 2π)',
          line: '깊은 바다에선 수심이 상관없다. 파장이 승부를 정한다.' },
    c2: { id: 'c2', no: '②', title: '심해파 속도식', formula: 'c = √(gλ / 2π) ≈ 1.25 √λ',
          line: '파장이 2배면 속도는 √2배. 그래서 접전이 된다.' },
    c3: { id: 'c3', no: '③', title: '주기가 길면 파장도 길다', formula: 'λ = gT² / 2π',
          line: '주기만 알아도 파장이 나온다. 주기 2배면 파장 4배.' },
    c4: { id: 'c4', no: '④', title: '얕아지면 격차가 좁혀진다', formula: 'c → √(gh) (순위는 그대로)',
          line: '얕은 물에선 모두 같은 속도로 수렴한다. 앞선 파도가 먼저 느려질 뿐.' },
    c5: { id: 'c5', no: '⑤', title: '천수 효과', formula: 'H = H₀ √(cg₀ / cg), 쇄파: H ≥ 0.78 h',
          line: '얕아지면 파고가 커지고, 긴 파도가 먼저 부서진다.' },
    c6: { id: 'c6', no: '⑥', title: '천해파 속도는 수심이 정한다', formula: 'c = √(gh)',
          line: '파장이 같아도 바다가 다르면 결과가 다르다. 깊은 구간이 길수록 빠르다.' },
    c7: { id: 'c7', no: '⑦', title: '해저 지형이 파도의 운명을 정한다', formula: 'h(x) → c(x), 쇄파 지점',
          line: '언제 얕아지느냐가 순위와 부서지는 곳을 바꾼다.' },
    c8: { id: 'c8', no: '⑧', title: '쓰나미는 태평양에서도 천해파', formula: 'h/λ = 4,000 / 200,000 = 1/50 < 1/20',
          line: '파장 200 km 앞에선 수심 4 km도 얕다. c = √(gh) ≈ 198 m/s.' },
  };

  /* ---------- 도감 (12칸) ---------- */
  const CODEX = [
    { id: 'ripple',  kind: 'wave', name: '잔물결', emoji: '🫧', desc: '파장 15 m. 바람이 막 만든 짧은 파도. 파장이 짧아 느리다.' },
    { id: 'wind',    kind: 'wave', name: '풍랑',   emoji: '💨', desc: '파장 60 m. 바람이 부는 바다에서 자라는 파도. 마루가 뾰족하다.' },
    { id: 'swell',   kind: 'wave', name: '너울',   emoji: '🌀', desc: '멀리서 온 긴 파도. 바람이 없어도 온다.' },
    { id: 'breaker', kind: 'wave', name: '쇄파',   emoji: '🏄', desc: '파고가 수심의 0.78배를 넘으면 무너진다. 해변의 흰 거품.' },
    { id: 'tsunami', kind: 'wave', name: '쓰나미', emoji: '🌋', desc: '파장 200 km. 태평양 한가운데서도 천해파, 시속 700 km.', card: 'c8' },
    { id: 'c1', kind: 'card', card: 'c1' },
    { id: 'c2', kind: 'card', card: 'c2' },
    { id: 'c3', kind: 'card', card: 'c3' },
    { id: 'c4', kind: 'card', card: 'c4' },
    { id: 'c5', kind: 'card', card: 'c5' },
    { id: 'c6', kind: 'card', card: 'c6' },
    { id: 'c7', kind: 'card', card: 'c7' },
  ];

  /* ---------- 예측 포인트 ---------- */
  const POINTS = { winner: 100, firstBreak: 50, gap: 100, design: 150, boss: 200, streakBonus: 50 };
  const GRADES = [
    { min: 900, name: '바다를 읽는 자', emoji: '🔱' },
    { min: 600, name: '노련한 서퍼',   emoji: '🏄' },
    { min: 300, name: '해변 단골',     emoji: '🩴' },
    { min: 0,   name: '파도 초보',     emoji: '🐚' },
  ];

  const lane = (wave, extra) => Object.assign({ wave }, extra || {});
  const R1_LANES = () => [lane(WAVES.ripple), lane(WAVES.wind), lane(WAVES.long), lane(WAVES.swell)];

  /* ---------- 경기 ---------- */
  const RACES = [
    {
      id: 'r1', world: 'w1', no: 'R1', title: '개막전', length: L, bathy: COURSES.deep,
      lanes: R1_LANES(),
      bets: [{ type: 'winner', points: POINTS.winner, q: '1위로 들어올 파도는?' }],
      cards: ['c1'], codex: ['ripple', 'wind', 'swell'],
    },
    {
      id: 'r2', world: 'w1', no: 'R2', title: '접전', length: L, bathy: COURSES.deep,
      lanes: [
        lane({ name: '선수 A', emoji: '🅰️', lambda0: 120, H0: 1 }),
        lane({ name: '선수 B', emoji: '🅱️', lambda0: 100, H0: 1 }),
        lane({ name: '선수 C', emoji: '©️', lambda0: 80, H0: 1 }),
        lane({ name: '선수 D', emoji: '🇩', lambda0: 60, H0: 1 }),
      ],
      bets: [{ type: 'winner', points: POINTS.winner, q: '1위로 들어올 선수는? (파장 차이가 작습니다)' }],
      cards: ['c2'], codex: [], extra: 'deepFormula',
    },
    {
      id: 'r3', world: 'w1', no: 'R3', title: '주기 미스터리', length: L, bathy: COURSES.deep,
      lanes: [
        lane({ name: '선수 A', emoji: '🅰️', T: 14, H0: 1 }),
        lane({ name: '선수 B', emoji: '🅱️', T: 9, H0: 1 }),
        lane({ name: '선수 C', emoji: '©️', T: 6, H0: 1 }),
        lane({ name: '선수 D', emoji: '🇩', T: 3, H0: 1 }),
      ],
      hideLambda: true,
      bets: [{ type: 'winner', points: POINTS.winner, q: '파장은 비공개! 주기만 보고 1위를 고르세요.' }],
      cards: ['c3'], codex: [], extra: 'periodFormula',
    },
    {
      id: 'r4', world: 'w2', no: 'R4', title: '해안 데뷔', length: L, bathy: COURSES.basic,
      lanes: R1_LANES(),
      bets: [
        { type: 'winner', points: POINTS.winner, q: '1위로 들어올 파도는?' },
        { type: 'firstBreak', points: POINTS.firstBreak, q: '가장 먼저 부서질 파도는?' },
      ],
      cards: ['c4', 'c5'], codex: ['breaker'],
    },
    {
      id: 'r5', world: 'w2', no: 'R5', title: '같은 파도, 다른 바다', length: L,
      lanes: [
        lane({ name: '완만 레인', emoji: '🏖️', lambda0: 100, H0: 1 }, { bathy: COURSES.gentle, courseName: '600 m부터 얕아짐' }),
        lane({ name: '기본 레인', emoji: '🌴', lambda0: 100, H0: 1 }, { bathy: COURSES.basic, courseName: '1,800 m부터 얕아짐' }),
        lane({ name: '절벽 레인', emoji: '🪨', lambda0: 100, H0: 1 }, { bathy: COURSES.cliff, courseName: '2,700 m부터 얕아짐' }),
        lane({ name: '사주 레인', emoji: '🏝️', lambda0: 100, H0: 1 }, { bathy: COURSES.sandbar, courseName: '중간에 수심 5 m 언덕' }),
      ],
      bets: [{ type: 'winner', points: POINTS.winner, q: '네 파도 모두 파장 100 m. 어느 바다가 1위일까요?' }],
      cards: ['c6'], codex: [],
    },
    {
      id: 'r6', world: 'w2', no: 'R6', title: '격차 예측', length: L,
      lanes: [lane(WAVES.swell), lane(WAVES.ripple)],
      heats: [
        { label: '1차전 · 완만한 해안', short: '완만한 해안', bathy: COURSES.gentle },
        { label: '2차전 · 절벽 해안', short: '절벽 해안', bathy: COURSES.cliff },
      ],
      bets: [{ type: 'gap', points: POINTS.gap, q: '너울과 잔물결의 도착 시간 차가 더 큰 해안은?', options: ['완만한 해안 (600 m부터 얕아짐)', '절벽 해안 (2,700 m부터 얕아짐)'] }],
      cards: [], codex: [],
    },
    {
      id: 'r7', world: 'w3', no: 'R7', title: '의뢰: 너울을 이기게 하라', length: L,
      lanes: [lane(WAVES.swell), lane(WAVES.ripple, { start: 500 })],
      design: { goal: 'swellWins', initial: { xs: 200, hmid: 1.5, sandbar: false },
                brief: '잔물결이 500 m 앞에서 출발합니다(핸디캡). 너울이 따라잡아 1위 하도록 코스를 설계하세요.',
                hint: '힌트: 깊은 구간을 길게', points: POINTS.design },
      bets: [], cards: ['c7'], codex: [],
    },
    {
      id: 'r8', world: 'w3', no: 'R8', title: '의뢰: 잔물결을 지키게 하라', length: L,
      lanes: [lane(WAVES.swell), lane(WAVES.ripple, { start: 500 })],
      design: { goal: 'rippleWins', initial: { xs: 2000, hmid: 20, sandbar: false },
                brief: '같은 핸디캡(잔물결 500 m 앞 출발). 이번엔 잔물결이 1위를 지키도록 설계하세요.',
                hint: '힌트: 일찍, 얕게', points: POINTS.design },
      bets: [], cards: ['c7'], codex: [],
    },
    {
      id: 'r9', world: 'w3', no: 'R9', title: '의뢰: 서핑 대회장', length: L,
      lanes: [lane(WAVES.swell), lane(WAVES.ripple, { start: 500 })],
      design: { goal: 'breakWindow', window: [2600, 2800], initial: { xs: 1200, hmid: 10, sandbar: false },
                brief: '너울이 결승선 앞 300 ± 100 m 구간(2,600~2,800 m)에서 부서지게 설계하세요.',
                hint: '힌트: 너울은 파고가 수심의 0.78배를 넘는 곳, 수심 약 2 m에서 부서집니다', points: POINTS.design },
      bets: [], cards: ['c7'], codex: [],
    },
    {
      id: 'boss', world: 'boss', no: 'BOSS', title: '쓰나미 특별전', length: 17000000, bathy: COURSES.pacific,
      lanes: [lane(WAVES.tsunami), lane(WAVES.swell)],
      timeScale: 3600, step: 60, endOnFirst: true, clock: true, hPx: 24, scaleNote: '가로 17,000 km · 세로 4 km — 단면은 극단적으로 압축됨',
      bets: [{ type: 'choice', points: POINTS.boss, q: '쓰나미가 일본에 도착하는 데 걸리는 시간은?', options: ['2시간', '6시간', '약 하루', '3일'], answer: 2 }],
      cards: ['c8'], codex: ['tsunami'],
    },
  ];

  const Races = { WAVES, COURSES, WORLDS, CARDS, CODEX, POINTS, GRADES, RACES, coast, designCourse,
    byId(id) { return RACES.find(r => r.id === id); },
    indexOf(id) { return RACES.findIndex(r => r.id === id); },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Races;
  global.Races = Races;
})(typeof window !== 'undefined' ? window : globalThis);
