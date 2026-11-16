import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
const entries = {
  'Three.js + original extraction': "export { WebGLRenderer, MeshPhongMaterial, BufferGeometry } from 'three'; export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'; export { currentMesh } from './src/adapters';",
  'VTK extraction alone': "export { buildVtkFieldSurface } from '../../apps/web/src/lib/visualization/field-surface-vtk';",
  'Mol* Canvas3D + extraction': "export { createMolstarView } from './src/molstar-view'; export { molstarMesh } from './src/adapters';",
};
const sizes = {};
for (const [label, contents] of Object.entries(entries)) {
  const result = await build({ stdin: { contents, resolveDir: process.cwd(), sourcefile: 'bundle-probe.ts', loader: 'ts' }, bundle:true, format:'esm', minify:true, write:false, alias: { '@chemdft/scientific-scene': '../../packages/scientific-scene/src/index.ts' } });
  const bytes=result.outputFiles[0].contents;
  sizes[label]={ bytes:bytes.length, gzipBytes:gzipSync(bytes).length };
}
await writeFile('../../output/foundation-ux/benchmark-isolated-bundles.json',JSON.stringify(sizes,null,2));
console.log(sizes);
