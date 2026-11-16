import { Canvas3D, Canvas3DContext, DefaultCanvas3DParams } from 'molstar/lib/mol-canvas3d/canvas3d';
import { AssetManager } from 'molstar/lib/mol-util/assets';
import { Shape } from 'molstar/lib/mol-model/shape';
import { ShapeRepresentation } from 'molstar/lib/mol-repr/shape/representation';
import { Mesh } from 'molstar/lib/mol-geo/geometry/mesh/mesh';
import { MeshBuilder } from 'molstar/lib/mol-geo/geometry/mesh/mesh-builder';
import { addSphere } from 'molstar/lib/mol-geo/geometry/mesh/builder/sphere';
import { Color } from 'molstar/lib/mol-util/color';
import { ValueCell } from 'molstar/lib/mol-util';
import { Vec3 } from 'molstar/lib/mol-math/linear-algebra';
import { potentialColor } from '../../../packages/scientific-scene/src/volumetric';
import type { BenchMesh } from './adapters';
export function createMolstarView(host: HTMLElement) {
  const element=document.createElement('canvas');element.width=host.clientWidth;element.height=host.clientHeight;host.append(element);
  const ctx=Canvas3DContext.fromCanvas(element,new AssetManager(),{antialias:true,preserveDrawingBuffer:true},{transparency:'wboit'});
  const defaults=DefaultCanvas3DParams;
  const canvas=Canvas3D.create(ctx,{
    ...defaults, renderer:{...defaults.renderer,backgroundColor:Color(0xf4f7f8)},
    camera:{...defaults.camera,mode:'perspective',fov:35,manualReset:true},
    cameraFog:{name:'off',params:{}},cameraResetDurationMs:0,
    multiSample:{...defaults.multiSample,mode:'on',sampleLevel:2},
    postprocessing:{...defaults.postprocessing,occlusion:{name:'off',params:{}}},
  });
  canvas.animate();
  async function set(meshes:BenchMesh[], atoms:any[], range:number, sphere:{center:number[],radius:number}, distance:number) {
    canvas.clear();
    for(let i=0;i<meshes.length;i++){
      const mesh=meshes[i];const native=mesh.native as Mesh;
      ValueCell.update(native.groupBuffer,Float32Array.from({length:native.vertexCount},(_,index)=>index));
      ValueCell.update(native.varyingGroup,true);
      const color=(group:number)=> mesh.potentials ? Color.fromNormalizedArray(potentialColor(mesh.potentials[group],range),0) : Color(meshes.length===1?0x438e89:i?0xe18b3a:0x326fd1);
      const shape=Shape.create('Saved field',null,native,color,()=>1,()=> 'Deterministic saved-field surface');
      const repr=ShapeRepresentation(()=>shape,Mesh.Utils);
      await repr.createOrUpdate({alpha:.68,doubleSided:false,metalness:0,roughness:.7}, {}).run(); canvas.add(repr);
    }
    const state=MeshBuilder.createState(1024,1024);const colors=[];
    for(const [i,atom]of atoms.entries()){state.currentGroup=i;const xyz=[atom.x,atom.y,atom.z];addSphere(state,xyz,atom.element==='H'?.22:.36,2);colors.push(atom.element==='O'?0xe45252:0xfafafa);}
    const molecule=MeshBuilder.getMesh(state);const repr=ShapeRepresentation(()=>Shape.create('Atoms',null,molecule,g=>Color(colors[g]),()=>1,()=> 'Committed atom'),Mesh.Utils);
    await repr.createOrUpdate({alpha:1}, {}).run();canvas.add(repr);canvas.commit(true);
    const center=Vec3.create(...sphere.center); const direction=Vec3.normalize(Vec3(),Vec3.create(1.1,.9,1.75)); const position=Vec3.scaleAndAdd(Vec3(),center,direction,distance);
    canvas.camera.setState({mode:'perspective',fov:35*Math.PI/180,position,target:center,up:Vec3.create(0,1,0),radius:sphere.radius,radiusMax:sphere.radius*2,fog:0,clipFar:true});canvas.requestDraw();
  }
  return { set, canvas, ctx, element };
}
