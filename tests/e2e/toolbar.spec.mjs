import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cadRegistryEnvironment, cadRuntimeReady, cadTestProfile } from './cad-runtime.ts';
import { selectFixtureSession } from './session-fixture.ts';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.resolve(appRoot, '../..');
// Playwright REQUIRES the first argument to be a destructuring pattern, and this
// test drives Electron rather than a page, so it takes no fixture from it. The
// empty pattern is the framework's contract, not an oversight.
// eslint-disable-next-line no-empty-pattern
test('CAD tools stay within the scene, with direct snapshot and Select filters', async ({}, testInfo) => {
  test.setTimeout(120000);
  const profile = cadTestProfile('toolbar');
  // CAD checks own a tiny project; catalog resolution must not scan the repo's
  // sample models, local bundles or unrelated workspaces.
  const project = path.join(profile, 'project');
  const fixture = 'tests/fixtures/cad/import-smoke.step';
  fs.mkdirSync(path.dirname(path.join(project, fixture)), { recursive: true });
  fs.copyFileSync(path.join(root, fixture), path.join(project, fixture));
  const output = testInfo.outputPath('screenshots');
  fs.mkdirSync(output, {
    recursive: true
  });
  const app = await electron.launch({
    args: [`${root}/apps/desktop/out/main/index.js`, `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      ...cadRegistryEnvironment(profile),
      NODE_ENV: 'test',
      TEXT_TO_CAD_E2E_HIDDEN: '1',
      TEXT_TO_CAD_FAKE_AGENT: `${root}/apps/desktop/tests/fake-agent/index.mjs`,
      CADGEN_DAEMON: '0',
      CADGEN_CACHE_DIR: path.join(profile, 'cad-cache'),
      CADGEN_DAEMON_STATE_DIR: path.join(profile, 'cad-daemon')
    }
  });
  let page;
  try {
    page = await app.firstWindow();
    test.skip(!cadRuntimeReady(await page.evaluate(() => window.textToCad.runtime.status())), 'CAD runtime required');
    const sourceRequests = [];
    page.on('request', request => { if (request.url().includes('/__cad/design-outline')) sourceRequests.push(request.url()); });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let loading = false;
    await page.route(/\/__cad\/catalog(?:\?|$)/, async route => {
      if (!loading) return route.continue();
      const response = await route.fetch();
      const catalog = await response.json();
      // A build with a saved view keeps that view interactive. Model the cold
      // build contract here: no complete geometry exists to display yet.
      await route.fulfill({ response, json: { ...catalog, entries: catalog.entries.map(entry =>
        entry.file.endsWith('/import-smoke.step')
          ? { ...entry, url: '', hash: '', bytes: 0 }
          : entry) } });
    });
    await page.route('**/__cad/artifact?*', route => loading ? route.fulfill({
      json: {
        ok: true,
        state: 'compiling',
        runId: 'toolbar-loading-test',
        progress: {
          phase: 'mesh',
          label: 'Loading components',
          done: 12,
          total: 50,
          determinate: true
        }
      }
    }) : route.continue());
    await page.evaluate(() => window.textToCad.settings.set({
      theme: 'dark',
      reduceMotion: false,
      defaultGitMode: 'none',
      fetchBeforeCreate: false
    }));
    await selectFixtureSession(page, project);
    await expect(page.locator('[data-explorer-ready=true]')).toBeVisible();
    await page.getByRole('button', {
      name: 'Toggle explorer',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'New tab',
      exact: true
    }).click();
    await page.getByRole('menuitem', {
      name: 'File',
      exact: false
    }).click();
    await page.getByLabel('Filter files').fill('tests/fixtures/cad/import-smoke.step');
    await page.getByRole('option', {
      name: 'tests/fixtures/cad/import-smoke.step',
      exact: false
    }).first().click();
    // Picked in the tree, the STEP opens with the tree and in Select: its Features are already
    // the first panel of the tool stack under the toolbar, with no panel of its own to open.
    const stack = page.locator('[data-cad-tool-stack]');
    await expect(stack.getByRole('region', { name: 'Features', exact: true })).toBeVisible({ timeout: 60000 });
    await expect(page.locator('header [data-file-panel=cad-file], [data-file-sheet]')).toHaveCount(0);
    const toolbar = page.locator('[data-cad-toolbar]');
    const resize = async width => app.evaluate(({
      BrowserWindow
    }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 800), width);
    // The toolbar floats in the tool-groups column over the scene; the scene is the bound.
    const compact = page.locator('[data-cad-tool-groups][data-mobile]');
    const narrowScene = async () => {
      // Exercise a genuinely constrained CAD container: narrow the window until the viewer
      // takes its compact layout.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(700, 600));
      for (let width = 900; width >= 700; width -= 20) {
        await resize(width);
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
        if (await compact.count()) break;
      }
      await expect(compact).toHaveCount(1);
      await expect(toolbar).toHaveAttribute('data-cad-toolbar', 'tools');
    };
    const fit = async () => {
      const metric = await toolbar.evaluate(el => {
        const scene = el.closest('[data-cad-scene-backdrop]').getBoundingClientRect();
        return [...el.querySelectorAll('button,input')].filter(b => b.getClientRects().length).map(b => {
          const r = b.getBoundingClientRect();
          return {
            name: b.getAttribute('aria-label'),
            left: r.left,
            right: r.right,
            boundLeft: scene.left,
            boundRight: scene.right
          };
        });
      });
      assert(metric.every(x => x.left >= x.boundLeft - 1 && x.right <= x.boundRight + 1), JSON.stringify(metric));
    };
    await resize(1600);
    await expect(toolbar).toHaveAttribute('data-cad-toolbar', 'tools');
    // Explode is offered until the mesh arrives and withdrawn for a model of one part, as this
    // fixture is: take the strip's labels once the loaded model has settled them.
    await expect(toolbar.getByRole('button', { name: 'Explode', exact: true })).toHaveCount(0);
    const fullLabels = await toolbar.getByRole('button').evaluateAll(els => els.map(el => el.getAttribute('aria-label')));
    const tools = toolbar.getByRole('group', { name: 'Interaction tools', exact: true });
    // The viewport's top-right bar: Display settings, then Preview.
    const viewportActions = page.locator('[data-viewport-actions]');
    const displayButton = viewportActions.getByRole('button', { name: 'Display settings', exact: true });
    const grouping = async () => {
      await expect(page.getByRole('button', { name: 'Take snapshot', exact: true })).toBeVisible();
      await expect(toolbar.getByRole('group', { name: 'View and actions' })).toHaveCount(0);
      for (const name of ['Select', 'Measure', 'Draw']) await expect(tools.getByRole('button', { name, exact: true })).toBeVisible();
      // Preview is the viewer's own corner button, never a tool; nor is Display: the toolbar has
      // no Display tool, and Display settings sits in the top-right bar, just before Preview.
      await expect(tools.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(1);
      await expect(toolbar.getByRole('button', { name: /^Display/ })).toHaveCount(0);
      await expect(displayButton).toBeVisible();
      assert.deepEqual((await viewportActions.getByRole('button').evaluateAll(els => els.map(el => el.getAttribute('aria-label')))).slice(-2),
        ['Display settings', 'Preview']);
      await expect(toolbar.getByRole('button', { name: /^Viewing mode:/ })).toHaveCount(0);
      // There is no zoom control anywhere: not in the toolbar, and not in the tool stack, which
      // has no header of tabs to carry one. Framing a STEP is in its viewport context menu, and
      // that is the whole of it.
      await expect(page.getByRole('button', { name: 'Zoom controls', exact: true })).toHaveCount(0);
      await expect(page.getByLabel('Zoom level percent', { exact: true })).toHaveCount(0);
      await expect(page.locator('[data-cad-surface]').getByRole('tab')).toHaveCount(0);
      await fit();
    };
    await grouping();
    // Display is a popover from its button in the top-right bar, under it and inside the scene;
    // it is not in the tool stack, and Select stays in hand.
    await expect(page.locator('header [data-file-panel=cad-display]')).toHaveCount(0);
    await displayButton.click();
    const display = page.locator('[data-display-popover]');
    await expect(stack.locator('[data-display-popover]')).toHaveCount(0);
    await expect(tools.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const displayMode = display.getByRole('combobox', { name: 'Mode', exact: true });
    await expect(displayMode).toBeVisible();
    await displayMode.click();
    await page.getByRole('option', { name: 'Render', exact: true }).click();
    await expect(displayMode).toContainText('Render');
    for (const name of ['Select', 'Measure', 'Draw']) await expect(tools.getByRole('button', { name, exact: true })).toBeVisible();
    const [popover, scene, button] = await Promise.all([display.boundingBox(), page.locator('[data-cad-surface]').boundingBox(), displayButton.boundingBox()]);
    assert(popover.x >= scene.x - 1 && popover.x + popover.width <= scene.x + scene.width + 1, JSON.stringify({ popover, scene }));
    assert(popover.y >= button.y + button.height && popover.x <= button.x + button.width && popover.x + popover.width >= button.x,
      JSON.stringify({ popover, button }));
    await displayMode.click();
    await page.getByRole('option', { name: 'Solid', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(display).toHaveCount(0);
    await page.screenshot({ path: `${output}/wide.png` });
    await narrowScene();
    await grouping();
    await page.screenshot({ path: `${output}/narrow.png` });

    await expect(tools.getByRole('button', { name: 'Pan', exact: true })).toHaveCount(0);
    await tools.getByRole('button', { name: 'Measure', exact: true }).click();
    const select = tools.getByRole('button', { name: 'Select', exact: true });
    await select.click();
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('menu')).toHaveCount(0);
    // A second press opens nothing: Select's modes are a menu in the Features filter row, which
    // opens inside the window.
    await select.click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    await stack.getByRole('button', { name: /^Select mode: / }).click();
    await expect(page.getByRole('menuitemradio').first()).toBeVisible();
    const menuBounds = await page.getByRole('menu').boundingBox();
    const windowWidth = await page.evaluate(() => innerWidth);
    assert(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= windowWidth);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // Draw has no menu either: its tools, color and history are the Drawing panel, which leads
    // the stack while Draw is up and stays inside the window.
    await tools.getByRole('button', { name: 'Draw', exact: true }).click();
    await expect(tools.getByRole('button', { name: 'Draw', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('menu')).toHaveCount(0);
    const drawPanel = stack.locator('[data-tool-panel][aria-label="Drawing controls"]');
    await expect(drawPanel.getByRole('button', { name: 'Pen', exact: true })).toBeVisible();
    const drawBounds = await drawPanel.boundingBox();
    assert(drawBounds.x >= 0 && drawBounds.x + drawBounds.width <= await page.evaluate(() => innerWidth));
    assert.equal(await stack.locator('[data-tool-panel]:visible').first().getAttribute('aria-label'), 'Drawing controls');
    await fit();
    await resize(1600);
    await expect(tools.getByRole('button', { name: 'Draw', exact: true })).toHaveAttribute('aria-pressed', 'true');
    assert.deepEqual((await toolbar.getByRole('button').evaluateAll(els => els.map(el => el.getAttribute('aria-label')))).slice(0, fullLabels.length), fullLabels);
    await select.click();
    await narrowScene();
    await grouping();
    loading = true;
    await page.reload();
    // Reload opens the new-session screen; restore this session's explorer
    // before exercising its cold-compilation toolbar state.
    await selectFixtureSession(page, project);
    await expect(page.getByText('12/50', { exact: true })).toBeVisible();
    await fit();
    for (const name of ['Select', 'Measure', 'Draw']) await expect(toolbar.getByRole('button', { name, exact: true })).toBeDisabled();
    // Display is about the view, not the model: its settings button stays in the top-right bar
    // while it compiles, and the toolbar never grows a Display tool.
    await expect(displayButton).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /^Display/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Take snapshot', exact: true })).toBeDisabled();
    assert.deepEqual(errors, []);
    assert.deepEqual(sourceRequests, []);
    await expect(page.getByRole('tab', { name: 'Source features' })).toHaveCount(0);
    console.info('PASS: tools at both widths; Display popover and Render; Select mode menu; Draw panel; focus; scene bounds; snapshot loading state; no renderer errors');
  } finally {
    await page?.unrouteAll({ behavior: 'wait' });
    const runtimeLog = path.join(profile, 'cad-runtime.log');
    if (fs.existsSync(runtimeLog)) fs.copyFileSync(runtimeLog, testInfo.outputPath('cad-runtime.log'));
    await app.close();
    fs.rmSync(profile, {
      recursive: true,
      force: true
    });
  }
});
