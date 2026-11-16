import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { potentialColor } from '../../../packages/scientific-scene/src/volumetric';
import { currentMesh, vtkMesh, molstarMesh, type BenchMesh } from './adapters';
window.addEventListener("error", event => document.querySelector("#errors")!.textContent=String(event.error?.stack ?? event.message));
window.addEventListener("unhandledrejection", event => document.querySelector("#errors")!.textContent=String(event.reason?.stack ?? event.reason));
const started=performance.now();
const payload=await (await fetch('fields.json')).json();
const atoms=payload.structure.coordinates.atoms;
const loaderMs=performance.now()-started;
const status=document.querySelector('#status')!;
const output=document.querySelector('#inputs')!;
const resultRows:any[]=[];
const adapters=[currentMesh,vtkMesh,molstarMesh];
let activeMeshes:BenchMesh[][]=[];
function createThree(id:string, improved:boolean){
 const host=document.querySelector<HTMLElement>(`#${id}`)!;
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(host.clientWidth,host.clientHeight,false);host.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color(0xf4f7f8);scene.add(new THREE.HemisphereLight(0xffffff,0x66717c,2.1));const light=new THREE.DirectionalLight(0xffffff,2.2);light.position.set(8,12,10);scene.add(light);
 const camera=new THREE.PerspectiveCamera(35,host.clientWidth/host.clientHeight,.01,1000);const controls=new OrbitControls(camera,renderer.domElement);controls.addEventListener('change',()=>renderer.render(scene,camera));const objects=new THREE.Group();scene.add(objects);
 function set(meshes:BenchMesh[],range:number,sphere:THREE.Sphere,distance:number){
  for(const obj of objects.children as THREE.Mesh[]){obj.geometry.dispose();(obj.material as THREE.Material).dispose();}objects.clear();
  meshes.forEach((mesh,index)=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(mesh.positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(mesh.normals,3));if(mesh.indices)geometry.setIndex(new THREE.BufferAttribute(mesh.indices,1));
   if(mesh.potentials){const colors=new Float32Array(mesh.potentials.length*3);mesh.potentials.forEach((v,i)=>{const c=new THREE.Color(...potentialColor(v,range)).convertSRGBToLinear();colors.set([c.r,c.g,c.b],i*3)});geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));}
   const color=mesh.potentials?0xffffff:meshes.length===1?0x438e89:index?0xe18b3a:0x326fd1;
   const material=improved?new THREE.MeshStandardMaterial({color,roughness:mesh.potentials?.7:.42,metalness:0,vertexColors:!!mesh.potentials,transparent:true,opacity:.68,depthWrite:false,side:THREE.FrontSide}):new THREE.MeshPhongMaterial({color,vertexColors:!!mesh.potentials,specular:mesh.potentials?0x111111:0xffffff,shininess:mesh.potentials?12:38,transparent:true,opacity:.68,depthWrite:false,side:THREE.FrontSide});objects.add(new THREE.Mesh(geometry,material));
  });
  for(const atom of atoms){const mesh=new THREE.Mesh(new THREE.SphereGeometry(atom.element==='H'?.22:.36,32,24),new THREE.MeshStandardMaterial({color:atom.element==='O'?0xe45252:0xfafafa,roughness:.45}));mesh.position.set(atom.x,atom.y,atom.z);objects.add(mesh);}
  controls.target.copy(sphere.center);camera.position.copy(sphere.center.clone().add(new THREE.Vector3(1.1,.9,1.75).normalize().multiplyScalar(distance)));camera.lookAt(sphere.center);controls.update();renderer.render(scene,camera);
 }
 return{host,renderer,scene,camera,controls,set};
}
const three=[createThree('current',false),createThree('hybrid',true)];
const molModuleStarted=performance.now();const {createMolstarView}=await import('./molstar-view');
status.textContent="Initializing Mol* canvas…";
const mol=createMolstarView(document.querySelector<HTMLElement>('#molstar')!);const molInitMs=performance.now()-molModuleStarted;
async function show(name:string){
 status.textContent='Extracting identical saved grid…';
 const field=payload.fields[name==='Density'||name==='ESP'?'ELECTRON_DENSITY':name];const esp=name==='ESP'?payload.fields.ELECTROSTATIC_POTENTIAL:undefined;const iso=name==='Density'||name==='ESP'?.001:.035;
 const before=JSON.stringify([field,esp]);activeMeshes=[];
 const timings=[];
 for(const adapter of adapters){const start=performance.now();const meshes=[await adapter(field,iso,false,esp)];if(name==='HOMO'||name==='LUMO')meshes.push(await adapter(field,iso,true));timings.push(performance.now()-start);activeMeshes.push(meshes);}
 const box=new THREE.Box3();for(const mesh of activeMeshes[0])for(let i=0;i<mesh.positions.length;i+=3)box.expandByPoint(new THREE.Vector3(mesh.positions[i],mesh.positions[i+1],mesh.positions[i+2]));const sphere=box.getBoundingSphere(new THREE.Sphere());
 const distance=Math.max(.5,sphere.radius)/Math.sin(Math.min(35*Math.PI/360,Math.atan(Math.tan(35*Math.PI/360)*three[0].camera.aspect)))*1.15;
 const range=Math.max(Math.abs(activeMeshes[0][0].minimum??1),Math.abs(activeMeshes[0][0].maximum??1));
 const renderStarts=[];for(let i=0;i<2;i++){const t=performance.now();three[i].set(activeMeshes[i],range,sphere,distance);renderStarts.push(performance.now()-t);}
 const t=performance.now();await mol.set(activeMeshes[2],atoms,range,{center:sphere.center.toArray(),radius:sphere.radius},distance);renderStarts.push(performance.now()-t);
 if(before!==JSON.stringify([field,esp]))throw new Error('Scientific input mutation');
 const rows=activeMeshes.map((meshes,i)=>({field:name,renderer:['Current Three.js','VTK hybrid','Mol*'][i],extractionMs:+timings[i].toFixed(2),initialDrawMs:+renderStarts[i].toFixed(2),triangles:meshes.reduce((n,m)=>n+m.triangles,0),vertices:meshes.reduce((n,m)=>n+m.positions.length/3,0),finite:meshes.every(m=>[...m.positions,...m.normals,...(m.potentials??[])].every(Number.isFinite)),minimum:meshes[0].minimum,maximum:meshes[0].maximum,gridHash:field.manifest.grid_sha256,immutable:true}));
 resultRows.splice(0,resultRows.length,...rows);
 document.querySelectorAll('.stats').forEach((el,i)=>el.textContent=JSON.stringify(rows[i],null,2));
 document.querySelector('#legend')!.innerHTML=esp?`<strong>ESP V(r) / a.u. · density geometry at 0.001 e/a₀³</strong><div class="legend"></div><div class="limits"><span>−${range.toFixed(5)}</span><span>0</span><span>+${range.toFixed(5)} a.u.</span></div>`:'Orbital phase sign or density; the scientific grid is unchanged.';
 output.textContent=JSON.stringify({loaderMs,molInitMs,jsHeapBytes:(performance as any).memory?.usedJSHeapSize??null,rows},null,2);status.textContent=`Ready · ${name}`;
}
async function measure(){
 status.textContent='Measuring actual rendered rotation…';
 for(let i=0;i<3;i++){
  const start=performance.now();let draws=0;
  if(i===2) mol.canvas.pause();
  for(let frame=0;frame<120;frame++){
   await new Promise<void>(resolve=>requestAnimationFrame(()=>{
    const angle=frame*.012;
    if(i<2){const view=three[i];const dir=view.camera.position.clone().sub(view.controls.target);dir.applyAxisAngle(new THREE.Vector3(0,1,0),.012);view.camera.position.copy(view.controls.target.clone().add(dir));view.camera.lookAt(view.controls.target);view.renderer.render(view.scene,view.camera);}
    else{const cam=mol.canvas.camera;const t=cam.state.target,p=cam.state.position;const x=p[0]-t[0],z=p[2]-t[2];cam.setState({position:[t[0]+x*Math.cos(.012)+z*Math.sin(.012),p[1],t[2]-x*Math.sin(.012)+z*Math.cos(.012)]});mol.canvas.requestDraw();mol.canvas.tick(performance.now(),{isSynchronous:true});}draws++;resolve();
   }));
  }
  if(i===2) mol.canvas.animate();
  resultRows[i].rotationFps=+(draws/(performance.now()-start)*1000).toFixed(2);
  document.querySelectorAll('.stats')[i].textContent=JSON.stringify(resultRows[i],null,2);
 }
 output.textContent=JSON.stringify({loaderMs,molInitMs,jsHeapBytes:(performance as any).memory?.usedJSHeapSize??null,rows:resultRows},null,2);status.textContent='Measured 120 rotation frames per renderer';
}
document.querySelector('#field')!.addEventListener('change',(event)=>show((event.target as HTMLSelectElement).value).catch(error=>document.querySelector('#errors')!.textContent=error.stack));
document.querySelector('#measure')!.addEventListener('click',()=>measure().catch(error=>document.querySelector('#errors')!.textContent=error.stack));
await show('HOMO').catch(error=>document.querySelector('#errors')!.textContent=error.stack);
