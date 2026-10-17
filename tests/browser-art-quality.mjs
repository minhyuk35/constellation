import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,
  args:['--enable-webgl','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('#stage canvas');
  const result=await page.evaluate(async()=>{
    const loaded=path=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===path)?.name||path;
    const three=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname.endsWith('/three.js')).name;
    const THREE=await import(three);
    const {artVertex,artFragment}=await import(loaded('/src/scene/shaders.js'));
    const colors=[[200,80,30,255],[82,132,206,255],[126,126,126,255],[211,181,110,255],
      [40,80,100,255],[8,8,8,255],[200,100,40,128],[0,0,0,0]];
    const renderer=new THREE.WebGLRenderer({alpha:true,preserveDrawingBuffer:true});
    renderer.setSize(256,32);renderer.setPixelRatio(1);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    const atlas=new THREE.DataTexture(new Uint8Array(colors.flat()),colors.length,1);
    atlas.colorSpace=THREE.SRGBColorSpace;atlas.needsUpdate=true;
    atlas.minFilter=atlas.magFilter=THREE.NearestFilter;
    const uniforms={uAtlas:{value:atlas},uRect:{value:new THREE.Vector4(0,0,1,1)},
      uExposure:{value:1},uOpacity:{value:1},uTime:{value:0},uBlackKey:{value:0}};
    const material=new THREE.ShaderMaterial({vertexShader:artVertex,fragmentShader:artFragment,
      uniforms,transparent:true,depthWrite:false,blending:THREE.NormalBlending});
    const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();
    scene.add(new THREE.Mesh(geometry,material));
    const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=1;
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=32;
    const ctx=canvas.getContext('2d');
    const sample=()=>{
      renderer.render(scene,camera);ctx.clearRect(0,0,256,32);ctx.drawImage(renderer.domElement,0,0);
      return colors.map((_,i)=>Array.from(ctx.getImageData(i*32+16,16,1,1).data));
    };
    const drawn=sample();
    uniforms.uBlackKey.value=1;
    // An opaque black matte must disappear, while midtone and coloured detail survives.
    atlas.image.data.set([0,0,0,255],7*4);atlas.needsUpdate=true;
    const keyed=sample();
    atlas.dispose();geometry.dispose();material.dispose();renderer.dispose();
    return {colors,drawn,keyed};
  });
  for(let i=0;i<result.colors.length;i++)for(let channel=0;channel<4;channel++)
    assert.ok(Math.abs(result.colors[i][channel]-result.drawn[i][channel])<=3,
      `art should preserve sRGB/alpha: ${JSON.stringify(result)}`);
  assert.equal(result.keyed[7][3],0,'opaque black matte is transparent');
  for(const i of [0,1,2,3,4])assert.equal(result.keyed[i][3],255,'material detail survives matte removal');
  assert.deepEqual(errors,[]);
  console.log('PASS: artwork preserves source sRGB colours, gray levels and alpha; opaque black matte disappears without erasing material detail.');
}finally{await browser.close();}
