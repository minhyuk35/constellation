import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
mkdirSync('tmp/qa',{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:5173/vr.html');await page.waitForLoadState('networkidle');
  const result=await page.evaluate(async()=>{
    const resources=performance.getEntriesByType('resource');
    const {app}=await import(resources.find(e=>new URL(e.name).pathname==='/src/vr/main.js').name);
    const THREE=await import(resources.find(e=>new URL(e.name).pathname.endsWith('/three.js')).name);
    const {StarParticles}=await import('/src/scene/StarParticles.js');
    app.world.renderer.setAnimationLoop(null);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(480,480);renderer.setClearColor(0);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(55,1,.01,10),fx=new StarParticles(scene,{spatial:true});
    const center=new THREE.Vector3(.25,1.2,-.6);fx.emit(center,{now:10});
    const target=new THREE.WebGLRenderTarget(480,480),pixels=new Uint8Array(480*480*4);
    function sample(offset,t=10.32,parallel=false) {
      camera.position.copy(center).add(new THREE.Vector3(...offset));camera.up.set(0,Math.abs(offset[1])>1?0:1,Math.abs(offset[1])>1?-1:0);
      if(parallel)camera.quaternion.identity();else camera.lookAt(center);
      camera.updateMatrixWorld();fx.update(t);renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,480,480,pixels);
      let count=0,xsum=0,ysum=0,minX=480,maxX=0,minY=480,maxY=0;
      for(let y=0;y<480;y++)for(let x=0;x<480;x++){const i=(y*480+x)*4;if(Math.max(pixels[i],pixels[i+1],pixels[i+2])<6)continue;count++;xsum+=x;ysum+=y;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
      const projected=center.clone().project(camera);
      return {count,x:xsum/Math.max(1,count),y:ysum/Math.max(1,count),width:maxX-minX,height:maxY-minY,expectedX:(projected.x+1)*240-.5};
    }
    const views=[[0,0,1.2],[1.2,0,0],[0,0,-1.2],[-1.2,0,0],[0,1.2,0],[0,-1.2,0]].map(o=>sample(o));
    const eyes=[sample([-.032,0,1.2],10.32,true),sample([.032,0,1.2],10.32,true)];
    const expansion=[10.12,10.28,10.52].map(t=>sample([0,0,1.2],t));
    const outside=sample([0,0,1.2],10.32),occluder=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0}));
    occluder.position.copy(center).add(new THREE.Vector3(0,0,.4));scene.add(occluder);
    const hidden=sample([0,0,1.2]);scene.remove(occluder);occluder.geometry.dispose();occluder.material.dispose();
    const expired=sample([0,0,1.2],12),matrix=fx.mesh.matrixWorld.toArray();
    const versions=Object.values(fx.geometry.attributes).map(a=>a.version);
    for(let i=0;i<100;i++)sample([Math.sin(i)*1.2,0,Math.cos(i)*1.2]);
    const stable=JSON.stringify(versions)===JSON.stringify(Object.values(fx.geometry.attributes).map(a=>a.version))&&JSON.stringify(matrix)===JSON.stringify(fx.mesh.matrixWorld.toArray());
    // Save a real render next to the source VR canvas for visual inspection.
    renderer.setRenderTarget(null);camera.position.copy(center).add(new THREE.Vector3(.7,.3,1));camera.up.set(0,1,0);camera.lookAt(center);fx.update(10.32);renderer.render(scene,camera);
    document.body.replaceChildren(renderer.domElement);renderer.domElement.id='spatial-wave-preview';
    window.waveQA={renderer,fx,target};
    return {views,eyes,expansion,outside,hidden,expired,stable,spatial:app.world.particles.spatial,draws:renderer.info.render.calls,triangles:renderer.info.render.triangles};
  });
  assert.equal(result.spatial,true,'actual VR world selects spherical wave renderer');
  for(const v of result.views){assert.ok(v.count>100);assert.ok(Math.abs(v.width-v.height)<=2);}
  const counts=result.views.map(v=>v.count);assert.ok(Math.max(...counts)/Math.min(...counts)<1.08,'comparable waves from front, back, left, right, above and below');
  for(const e of result.eyes)assert.ok(Math.abs(e.x-e.expectedX)<1.5,'each eye projects the same world-space center');
  assert.ok(result.eyes[0].x>result.eyes[1].x,'stereo parallax is present');
  assert.ok(result.expansion[0].width<result.expansion[1].width&&result.expansion[1].width<result.expansion[2].width,'wave expands through space');
  assert.ok(result.outside.count>100);assert.equal(result.hidden.count,0,'opaque foreground correctly occludes the shell');
  assert.equal(result.expired.count,0);assert.equal(result.stable,true);assert.equal(result.draws,1);assert.ok(result.triangles<5000);
  await page.screenshot({path:'tmp/qa/vr-spatial-wave.png'});
  assert.deepEqual(errors,[]);console.log('PASS: real VR spherical wave, six viewing directions, stereo parallax, outward expansion, depth occlusion, expiry, uniform-only animation and one draw call.',JSON.stringify(result));
}finally{await browser.close();}
