/** Executable assertions for the in-app Browser's saved-water acceptance flow. */
import assert from 'node:assert/strict';
export async function readStructure(tab) {
  return tab.playwright.evaluate(()=>{
    const visible=el=>el&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0;
    const host=[...document.querySelectorAll('.structure-canvas')].find(visible);
    const panel=document.querySelector('.workbench-panel:not([hidden])');
    const toolbar=document.querySelector('.structure-viewer-toolbar');
    const controls=[...toolbar?.querySelectorAll('select,button')??[]].filter(visible);
    const overlap=controls.some((e,i)=>controls.slice(i+1).some(other=>{const a=e.getBoundingClientRect(),b=other.getBoundingClientRect();return a.left<b.right-.5&&a.right>b.left+.5&&a.top<b.bottom-.5&&a.bottom>b.top+.5;}));
    return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,documentScroll:document.documentElement.scrollTop,panelScroll:panel?.scrollTop,
      scene:host?{rect:host.getBoundingClientRect().toJSON(),camera:host.dataset.camera,fitCount:Number(host.dataset.fitCount ?? 0),atoms:Number(host.dataset.atomCount),authoritativeBonds:Number(host.dataset.authoritativeBonds),visualBonds:Number(host.dataset.visualBonds)}:null,
      activeTab:document.querySelector('.workspace-tab[aria-selected="true"]')?.textContent.trim(),overlap,
      controlsOverflow:controls.some(el=>{const a=el.getBoundingClientRect(),b=panel.getBoundingClientRect();return a.right>b.right+1||a.left<b.left-1;}),
      representation:toolbar?.querySelector('select')?.value,
      inspectorBondCount:document.querySelector('[data-testid="authoritative-bond-count"]')?.textContent,
      evidence:document.querySelector('.evidence-compact-label')?.textContent,
      rawSourceCards:[...document.querySelectorAll('.ai-sources-disclosure[open] [data-testid="citation-chip"], .workspace-evidence.expanded [data-testid="evidence-project-record"]')].filter(visible).length,
      unitCellControls:[...document.querySelectorAll('.structure-viewer-toolbar input')].filter(visible).length,
      measurement:document.querySelector('[data-testid="structure-measurement"]')?.textContent,
    };
  });
}
export function assertStructure(state) {
  assert.equal(state.documentScroll,0);assert.ok(state.documentHeight<=state.height+1);assert.ok(state.documentWidth<=state.width);
  assert.equal(state.panelScroll,0);assert.equal(state.overlap,false);assert.equal(state.controlsOverflow,false);
  assert.ok(state.scene&&state.scene.rect.width>=250&&state.scene.rect.height>=180);
  assert.equal(state.scene.atoms,3);assert.equal(state.scene.authoritativeBonds,0);assert.equal(state.unitCellControls,0);
}
export function assertCamera(before,after) {
  const a=JSON.parse(before.scene.camera),b=JSON.parse(after.scene.camera);
  for (const key of ['position','target']) for(let i=0;i<3;i++)assert.ok(Math.abs(a[key][i]-b[key][i])<1e-9,`${key} changed`);
}
export async function verifyRepresentationAndBonds(tab) {
  const initial=await readStructure(tab);assertStructure(initial);assert.equal(initial.scene.visualBonds,2);
  for(const representation of ['space-fill','wireframe','sticks','ball-stick']) {
    await tab.playwright.getByRole('combobox',{name:'Representation',exact:true}).selectOption(representation);
    const next=await readStructure(tab);assert.equal(next.representation,representation);assertCamera(initial,next);assert.equal(next.scene.fitCount,initial.scene.fitCount);
  }
  await tab.playwright.getByRole('combobox',{name:'Visual bonds',exact:true}).selectOption('off');
  assert.equal((await readStructure(tab)).scene.visualBonds,0);
  await tab.playwright.getByRole('combobox',{name:'Visual bonds',exact:true}).selectOption('auto');
  assert.equal((await readStructure(tab)).scene.visualBonds,2);
  assert.equal((await readStructure(tab)).scene.authoritativeBonds,0);
  return {representations:4,visualBondToggle:true,noImplicitFit:true,unchangedCamera:true};
}
