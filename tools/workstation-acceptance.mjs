/** In-app browser acceptance helpers. Import inside the browser skill's Node session. */
import assert from 'node:assert/strict';

export async function readWorkstation(tab) {
  return tab.playwright.evaluate(() => {
    const visible = element => !!element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    const scene = [...document.querySelectorAll('.mo-viewport')].find(visible);
    const panel = document.querySelector('.workbench-panel:not([hidden])');
    const controls = [...document.querySelectorAll('.electronic-field-modes button, .isovalue-inputs input, .isovalue-inputs button')].filter(visible);
    const overlap = controls.some((element, i) => controls.slice(i + 1).some(other => {
      const a = element.getBoundingClientRect(), b = other.getBoundingClientRect();
      return a.left < b.right - .5 && a.right > b.left + .5 && a.top < b.bottom - .5 && a.bottom > b.top + .5;
    }));
    return {
      width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight, documentScroll: document.documentElement.scrollTop,
      activeTab: document.querySelector('.workspace-tab[aria-selected="true"]')?.textContent.trim(),
      visiblePanels: [...document.querySelectorAll('.workbench-panel')].filter(visible).length,
      panelScroll: panel?.scrollTop,
      scene: scene ? { rect: scene.getBoundingClientRect().toJSON(), camera: scene.dataset.camera,
        triangles: Number(scene.dataset.surfaceTriangles), builds: Number(scene.dataset.surfaceBuilds), hash: scene.dataset.gridHash } : null,
      threshold: [...document.querySelectorAll('.isovalue-inputs input[type="text"]')].find(visible)?.value,
      logSlider: [...document.querySelectorAll('.isovalue-inputs input[type="range"]')].find(visible)?.value,
      controlOverlap: overlap,
      controlsOutsideWorkbench: controls.some(element => {
        const a = element.getBoundingClientRect(), b = panel.getBoundingClientRect();
        return a.left < b.left - 1 || a.right > b.right + 1;
      }),
      toolbar: [...document.querySelectorAll('.document-toolbar button')].map(element => element.textContent.trim()),
    };
  });
}
export function assertWorkstation(state, expectedWidth) {
  assert.equal(state.width, expectedWidth);
  assert.ok(state.documentWidth <= state.width);
  assert.ok(state.documentHeight <= state.height + 1);
  assert.equal(state.documentScroll, 0);
  assert.equal(state.visiblePanels, 1);
  assert.equal(state.controlOverlap, false);
  assert.equal(state.controlsOutsideWorkbench, false);
  assert.ok(state.scene && state.scene.rect.width >= 200 && state.scene.rect.height >= 160);
}
export function assertCamera(before, after) {
  const a=JSON.parse(before.scene.camera), b=JSON.parse(after.scene.camera);
  // OrbitControls normalizes camera coordinates on restore (floating-point ulps).
  for (const key of ['position','target']) for (let i=0;i<3;i++) assert.ok(Math.abs(a[key][i]-b[key][i]) < 1e-9);
}
export function assertThreshold(state, value) {
  assert.equal(Number(state.threshold), value);
  assert.ok(Math.abs(Number(state.logSlider) - Math.log10(value)) < 1e-9);
}
export function assertTabScroll(before, other, restored) {
  assert.notEqual(before.activeTab, other.activeTab);
  assert.equal(other.panelScroll, 0);
  assert.equal(restored.activeTab, before.activeTab);
  assert.equal(restored.panelScroll, before.panelScroll);
}
