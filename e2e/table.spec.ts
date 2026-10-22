import { devices, expect, test, type Page } from '@playwright/test';

const phone = devices['Pixel 7'];

async function joinAs(page: Page, code: string, name: string, cls: string) {
  await page.goto(`/play/${code}`);
  await page.getByLabel('Hero name').fill(name);
  await page.getByRole('radio', { name: new RegExp(cls, 'i') }).click();
  await page.getByRole('button', { name: /join the party/i }).click();
  await expect(page.locator(`.hero[data-hero="${name}"]`)).toBeVisible();
}

/** Click the first thing this phone can do right now. Returns false if it had nothing to do. */
async function takeTurn(page: Page): Promise<boolean> {
  if (await page.locator('.combat-controls').isVisible()) return fightTurn(page);
  const buttons = page.locator('section.actions button:enabled');
  if ((await buttons.count()) === 0) return false;
  const text = (await buttons.first().textContent()) ?? '';
  if (/^play /i.test(text)) return false;
  await buttons.first().click();
  return true;
}

/** In a fight: use an ability if one is ready, otherwise step closer once, otherwise end the turn. */
async function fightTurn(page: Page): Promise<boolean> {
  const end = page.getByRole('button', { name: /^end .*turn$/i });
  if (!(await end.isVisible())) return false;
  const abilities = page.locator('.ability-grid button:enabled', { hasNotText: /^(Move|Revive)/ });
  const lit = page.locator('.grid-svg rect.cell.lit');
  if ((await abilities.count()) > 0) {
    await abilities.first().click();
    if (await page.locator('.mode-hint').isVisible()) {
      if ((await lit.count()) === 0) return (await page.getByRole('button', { name: 'Cancel' }).click(), end.click(), true);
      await lit.first().click({ force: true });
    }
    return true;
  }
  const move = page.locator('.ability-grid button:enabled', { hasText: /^Move/ });
  if ((await move.count()) > 0 && !(await page.locator('.combat-status').textContent())?.includes('1 action')) {
    await move.click();
    await lit.last().click({ force: true });
    return true;
  }
  await end.click();
  return true;
}

test('a screen and two phones play a scenario to the end', async ({ browser }) => {
  test.setTimeout(240_000);
  const screen = await (await browser.newContext()).newPage();
  await screen.goto('/');
  await screen.getByRole('button', { name: /open the main screen/i }).click();
  await expect(screen).toHaveURL(/\/screen\/[A-Z]{4}$/);
  const code = screen.url().slice(-4);
  await expect(screen.getByLabel('Room code')).toHaveText(code);
  await expect(screen.getByAltText(/QR code/).first()).toBeVisible();

  const ana = await (await browser.newContext({ ...phone })).newPage();
  const ben = await (await browser.newContext({ ...phone })).newPage();
  await joinAs(ana, code, 'Ana', 'knight');
  await joinAs(ben, code, 'Ben', 'wizard');
  await expect(screen.locator('.hero')).toHaveCount(2);

  await ben.getByRole('button', { name: /^start/i }).click();
  await expect(screen.locator('.log li').first()).toContainText('begins');

  // Play it out. Each phone only ever sees buttons for its own hero.
  let sawCard = false;
  let sawVote = false;
  let sawFight = false;
  for (let i = 0; i < 1500; i++) {
    if (await screen.locator('.result').isVisible()) break;
    if (await screen.locator('.card h2').isVisible()) sawCard = true;
    if ((await screen.locator('.prompt .chip').count()) > 0) sawVote = true;
    if (!sawFight && (await screen.locator('.combat-stage').isVisible())) {
      sawFight = true;
      // The board and both heroes are on the main screen, with enemy intents.
      await expect(screen.locator('.board-wrap canvas, .board-wrap svg').first()).toBeVisible();
      await expect(screen.locator('.units li[data-unit="Ana"]')).toBeVisible();
      await expect(screen.locator('.enemies .intent').first()).toBeVisible();
      await expect(ana.locator('.grid-svg')).toBeVisible();
    }
    const acted = (await takeTurn(ana)) || (await takeTurn(ben));
    await screen.waitForTimeout(acted ? 60 : 200);
  }
  await expect(screen.locator('.result')).toBeVisible();
  expect(sawCard).toBe(true);
  expect(sawVote).toBe(true);
  expect(sawFight).toBe(true);
  await expect(screen.locator('button')).toHaveCount(0);

  // Both phones get the result. Heroes keep what they earned: gear can be swapped, and the campaign saved.
  await expect(ana.locator('.result')).toBeVisible();
  await ana.getByText('Gear and items').click();
  await expect(ana.locator('.gear .items li').first()).toBeVisible();
  const download = screen.getByRole('link', { name: 'Download save' });
  await expect(download).toBeVisible();
  const save = await (await screen.request.get(`/save/${code}`)).json();
  expect(save.campaign.party.map((h: { name: string }) => h.name)).toEqual(['Ana', 'Ben']);

  // The main screen remembers the campaign, so a new table can pick it up and phones claim the heroes.
  await screen.goto('/');
  await screen.getByRole('button', { name: /open the main screen/i }).click();
  await expect(screen).toHaveURL(/\/screen\/[A-Z]{4}$/);
  const code2 = screen.url().slice(-4);
  await screen.getByRole('button', { name: /resume your last campaign/i }).click();
  await expect(screen.locator('.hero')).toHaveCount(2);
  await expect(screen.locator('.hero[data-hero="Ana"] .tag')).toHaveText('no player');
  await expect(screen.locator('.campaign-note')).toBeVisible();
  const cy = await (await browser.newContext({ ...phone })).newPage();
  await cy.goto(`/play/${code2}`);
  await cy.getByRole('button', { name: 'Play as Ana' }).click();
  await expect(cy.getByRole('button', { name: /remove ana/i })).toBeVisible();
  await cy.getByRole('button', { name: 'Play as Ben' }).click();
  await cy.getByRole('button', { name: /^start/i }).click();
  await expect(screen.locator('.log li').first()).toContainText('begins');
  await expect(screen.locator('.hero[data-hero="Ana"]')).toContainText(`lv ${save.campaign.party[0].level}`);
});

test('a phone that reloads keeps its hero', async ({ browser }) => {
  const page = await (await browser.newContext({ ...phone })).newPage();
  await page.goto('/');
  await page.getByRole('button', { name: /solo table/i }).click();
  await expect(page).toHaveURL(/\/play\/[A-Z]{4}$/);
  await page.getByLabel('Hero name').fill('Solo');
  await page.getByRole('button', { name: /join the party/i }).click();
  await page.getByLabel('Hero name').fill('Sidekick');
  await page.getByRole('radio', { name: /cleric/i }).click();
  await page.getByRole('button', { name: /add another hero/i }).click();
  await expect(page.locator('.hero')).toHaveCount(2);

  await page.reload();
  await expect(page.locator('.hero')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /remove solo/i })).toBeVisible();

  await page.getByRole('button', { name: /^start/i }).click();
  await expect(page.getByRole('button', { name: /turn the next card/i })).toBeVisible();
});

test('an unknown code shows a friendly page', async ({ page }) => {
  await page.goto('/play/QQQQ');
  await expect(page.getByRole('heading', { name: /no table qqqq/i })).toBeVisible();
});

test('a pack loaded by URL hosts a table, and a shared ?pack= link picks it', async ({ page, baseURL }) => {
  const url = `${baseURL}/pack/pack.json`;
  await page.goto('/');
  await page.getByLabel('Pack URL').fill(`${baseURL}/pack/nope.json`);
  await page.getByRole('button', { name: 'Load' }).click();
  await expect(page.getByRole('alert')).toContainText('answered 404');
  await page.goto(`/?pack=${encodeURIComponent(url)}`);
  await expect(page.getByLabel('Pack URL')).toHaveValue(url);
  // The gallery's built-in entry is no longer the pick once the URL pack loads.
  await expect(page.getByRole('button', { name: /The Hollow Road/, pressed: false })).toBeVisible();
  await page.getByRole('button', { name: /start a solo table/i }).click();
  await expect(page).toHaveURL(/\/play\/[A-Z]{4}$/);
  await expect(page.getByLabel('Hero name')).toBeVisible();
});

test('the editor checks a pack as you type and playtests it', async ({ page }) => {
  await page.goto('/editor');
  await page.getByRole('button', { name: 'Open The Hollow Road' }).click();
  await expect(page.getByText('No problems. Ready to playtest.')).toBeVisible();

  await page.getByRole('button', { name: /^Cards/ }).click();
  await page.getByRole('button', { name: 'bandit-scout' }).click();
  const box = page.getByLabel('Entry JSON');
  const json = JSON.parse(await box.inputValue());
  await box.fill(JSON.stringify({ ...json, title: 'A Nervous Scout', options: [{ ...json.options[0], onFailure: [{ type: 'insertCard', card: 'no-such-card' }] }] }, null, 2));
  await expect(page.locator('.card.preview h2')).toHaveText('A Nervous Scout');
  await expect(page.locator('.editor-issues')).toContainText('no-such-card');
  await expect(page.getByRole('button', { name: 'Playtest' })).toBeDisabled();

  // Half-typed JSON is held back rather than saved.
  await box.fill('{ "id": ');
  await expect(page.getByText(/Not saved yet/)).toBeVisible();
  await box.fill(JSON.stringify({ ...json, title: 'A Nervous Scout' }, null, 2));
  await expect(page.getByText('No problems. Ready to playtest.')).toBeVisible();

  // The draft survives a reload.
  await page.reload();
  await page.getByRole('button', { name: /^Cards/ }).click();
  await page.getByRole('button', { name: 'bandit-scout' }).click();
  await expect(page.locator('.card.preview h2')).toHaveText('A Nervous Scout');

  await page.getByRole('button', { name: 'Playtest' }).click();
  await expect(page).toHaveURL(/\/play\/[A-Z]{4}$/);
  await expect(page.getByLabel('Hero name')).toBeVisible();
});
