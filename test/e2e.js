/* 전 경기 헤드리스 통과 테스트 (Playwright).
 * 실행: python3 -m http.server 8765 &  →  NODE_PATH=$(npm root -g) node test/e2e.js
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/';
const SHOT = process.env.SHOT_DIR || null;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  const shot = async (name) => { if (SHOT) await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: true }); };
  const open = async (id) => { await page.evaluate(id => WaveRace.startRace(id), id); await page.waitForTimeout(250); };
  const waitResults = async () => {
    const heatBtn = page.locator('button:has-text("출발 ▶")');
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (await page.locator('h2:has-text("정산"), h2:has-text("시운전 결과")').count()) return;
      if (await heatBtn.count()) { await heatBtn.first().click(); await page.waitForTimeout(400); }
      await page.waitForTimeout(250);
    }
    throw new Error('results never appeared');
  };
  const bet = async (id, picks) => {
    await open(id);
    await page.click('text=베팅하러'); await page.waitForTimeout(120);
    const groups = await page.$$('.bet-options');
    for (let i = 0; i < groups.length; i++) { const opts = await groups[i].$$('.opt'); await opts[picks[i]].click(); }
    await page.click('text=출발!');
    // 경기 중 도감 버튼은 잠겨 있어야 한다
    await page.waitForTimeout(3600);
    if (!(await page.$eval('#btnCodex', b => b.disabled))) errors.push(`${id}: codex button not locked during race`);
    const t0 = Date.now();
    await waitResults();
    if (await page.$eval('#btnCodex', b => b.disabled)) errors.push(`${id}: codex button still locked after race`);
    await page.waitForTimeout(800);
    console.log(id.padEnd(5), 'race', ((Date.now() - t0) / 1000 + 3.6).toFixed(0) + 's', 'points', await page.textContent('#tbPoints'), '|', (await page.textContent('.bet-result')).replace(/\s+/g, ' ').slice(0, 90));
    await shot(id);
  };
  const design = async (id, xs, hSlider, test) => {
    await open(id);
    await page.fill('#edXs', String(xs)); await page.dispatchEvent('#edXs', 'input');
    await page.fill('#edH', String(hSlider)); await page.dispatchEvent('#edH', 'input');
    await page.click(test ? 'text=시운전' : 'text=제출');
    await waitResults();
    await page.waitForTimeout(600);
    console.log(id.padEnd(5), test ? 'test' : 'submit', '|', (await page.textContent('.bet-result')).replace(/\s+/g, ' ').slice(0, 90), '| points', await page.textContent('#tbPoints'));
    await shot(id + (test ? '-test' : ''));
  };
  await bet('r1', [3]); await bet('r2', [0]); await bet('r3', [0]);
  await bet('r4', [3, 3]); await bet('r5', [2]); await bet('r6', [1]);
  await design('r7', 2500, 65, true);
  await page.click('text=다시 설계'); await page.waitForTimeout(150);
  await page.click('text=제출'); await waitResults(); await page.waitForTimeout(500);
  console.log('r7    submit |', (await page.textContent('.bet-result')).replace(/\s+/g, ' ').slice(0, 90));
  await design('r8', 200, 0, false);
  await design('r9', 2550, 15, false);
  await bet('boss', [2]);
  await page.click('text=최종 결과'); await page.waitForTimeout(300);
  console.log('final:', (await page.textContent('.grade')), await page.textContent('#tbPoints'));
  await shot('final');
  await page.click('#btnCodex'); await page.waitForTimeout(300);
  const codex = await page.textContent('.panel h2');
  console.log('codex:', codex, '| card7 entries:', await page.$$eval('.entry-list li', els => els.length));
  await shot('codex');
  if (!/12 \/ 12/.test(codex)) errors.push('codex not full: ' + codex);
  console.log('errors:', errors);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
