const state={started:false,doors:0,rooms:1,threat:0,opened:new Set(),chaos:false};
const CHAOS_LIMIT=15;
let audioCtx=null,masterGain=null,musicGain=null,musicTimer=null;
const $=s=>document.querySelector(s);
const whispers=['Non tutte le porte vogliono essere aperte.','Hai sentito una risata o l’hai immaginata?','La stanza ricorda il tuo modo di scegliere.','Una porta in più. Perché?','Shaco non è davanti a te.','Quella porta non c’era prima.','Il corridoio sta imparando.'];

// ---------- audio (unchanged) ----------
function ensureAudio(){if(audioCtx)return;audioCtx=new(window.AudioContext||window.webkitAudioContext)();masterGain=audioCtx.createGain();masterGain.gain.value=.18;masterGain.connect(audioCtx.destination)}
function tone(freq,duration,type='sine',gain=.035,when=0){if(!audioCtx)return;const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(.0001,audioCtx.currentTime+when);g.gain.exponentialRampToValueAtTime(gain,audioCtx.currentTime+when+.015);g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+when+duration);o.connect(g);g.connect(masterGain);o.start(audioCtx.currentTime+when);o.stop(audioCtx.currentTime+when+duration+.03)}
function circusBell(){ensureAudio();tone(660,.7,'sine',.045);tone(990,.55,'sine',.028,.04);tone(1320,.35,'sine',.018,.09)}
function startCircusMusic(){ensureAudio();if(musicTimer)return;musicGain=audioCtx.createGain();musicGain.gain.value=.055;musicGain.connect(masterGain);const low=audioCtx.createOscillator(),drone=audioCtx.createOscillator(),lfo=audioCtx.createOscillator(),lfoGain=audioCtx.createGain();low.type='triangle';low.frequency.value=110;drone.type='sine';drone.frequency.value=55;lfo.frequency.value=4.2;lfoGain.gain.value=.035;lfo.connect(lfoGain);lfoGain.connect(musicGain.gain);low.connect(musicGain);drone.connect(musicGain);low.start();drone.start();lfo.start();const notes=[196,233,262,233,174,196,220,196];let i=0;musicTimer=setInterval(()=>{if(!audioCtx)return;const n=notes[i++%notes.length];tone(n,.28,'triangle',.022);if(i%4===0)tone(n/2,.45,'sine',.025,.03)},360)}
function heartbeat(){if(!audioCtx)return;const speed=Math.max(.38,.95-state.doors*.06);tone(58,.12,'sine',.07);tone(48,.1,'sine',.045,speed*.22)}
function doorSound(){if(!audioCtx)return;const buffer=audioCtx.createBuffer(1,audioCtx.sampleRate*.45,audioCtx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,2);const src=audioCtx.createBufferSource(),filter=audioCtx.createBiquadFilter(),g=audioCtx.createGain();filter.type='lowpass';filter.frequency.value=850;g.gain.value=.12;src.buffer=buffer;src.connect(filter);filter.connect(g);g.connect(masterGain);src.start()}
function shacoLaugh(){const a=$('#shaco-laugh');if(!a)return;a.volume=.24;a.currentTime=0;a.play().catch(()=>{})}
function shacoWhy(){const a=$('#shaco-why');if(!a)return;a.volume=.3;a.currentTime=0;a.play().catch(()=>{})}

// ---------- hud ----------
function setText(){$('#door-count').textContent=state.doors;$('#room-count').textContent=state.rooms;$('#threat-meter').textContent=`ATTENZIONE: ${state.threat}%`;$('#whisper').textContent=whispers[Math.min(Math.floor(state.doors/2),whispers.length-1)];const game=$('#game');game.classList.remove('paranoia-1','paranoia-2','paranoia-3','paranoia-4');if(state.doors>=6)game.classList.add('paranoia-4');else if(state.doors>=4)game.classList.add('paranoia-3');else if(state.doors>=2)game.classList.add('paranoia-2');else if(state.doors>=1)game.classList.add('paranoia-1')}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2600)}
function showShaco(){const s=$('#shaco-glimpse');s.classList.toggle('box-mode',Math.random()<.5);s.classList.add('show');shacoLaugh();tone(92,.65,'sawtooth',.035);setTimeout(()=>s.classList.remove('show'),850)}
function triggerShaco(){ambientShacoPeek();setTimeout(showShaco,260)}
function flashScreen(){const flash=document.createElement('div');flash.className='storm-flash';document.body.appendChild(flash);setTimeout(()=>flash.remove(),300)}

// ---------- 3D scene: a long corridor (2 side walls + far wall, all can carry doors), regenerated each time a door is used ----------
// ponytail: "infinite maze" = infinite chain of long procedurally-doored corridors, not a persistent grid —
// a real explorable grid maze would need chunk streaming + wall-aware collision, disproportionate for this game.
const CORR_HALF_W=2.0,CORR_SOUTH_Z=2.2,CORR_FAR_Z=-17,EYE_Y=1.55,CHAR_BASE_Y=.95;
const MOVE_SPEED=2.7,TURN_SPEED=2.1,DOOR_TRIGGER_DIST=.85,INTRO_DURATION=1100;
const FALL_DURATION=10000,FALL_SPEED=3.8; // fast enough that passing rows of doors actually reads as falling, not drifting
const VOID_RING_DOORS=20,VOID_RINGS=150,VOID_RADIUS=3.2,VOID_SPACING=2.15; // 20*150=3000 doors, packed edge-to-edge, full 360° + huge vertical span
const SHACO_CHARGE_DURATION=1250;

let renderer=null,scene=null,camera=null,textureLoader=null;
let doorGeom=null,doorTex=null,floorMat=null,ceilMat=null,wallMat=null;
let eleonoraTexture=null,shacoTexture=null;
let characterSprite=null,shacoSprite=null;
let roomGroup=null,activeDoors=[],activeMirrors=[]; // {mesh,id,isFalse} / {mesh,triggered}
let voidMesh=null;
let shacoPeekUntil=0,shacoCharge=null;
let mode='intro',introUntil=0,transitioning=false;
let player={x:0,z:0,yaw:0};
let fallYaw=0,fallPitch=0;
const keys={};
let lastFrame=0;

function initThree(){
  if(renderer)return;
  const canvas=$('#scene3d');
  scene=new THREE.Scene();
  scene.fog=new THREE.FogExp2(0x150912,.075);
  camera=new THREE.PerspectiveCamera(68,1,.05,40);
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));

  scene.add(new THREE.AmbientLight(0x553355,.6));
  const gold=new THREE.PointLight(0xf2b84b,1.1,7);gold.position.set(0,2.5,0);scene.add(gold);
  scene.add(new THREE.HemisphereLight(0x9955aa,0x150912,.4));

  textureLoader=new THREE.TextureLoader();
  doorTex=textureLoader.load('assets/exit-door-transparent.png');
  eleonoraTexture=textureLoader.load('assets/eleonora-transparent.png');
  shacoTexture=textureLoader.load('assets/shaco-main-transparent.png');
  doorGeom=new THREE.PlaneGeometry(1.1,2.15);
  floorMat=new THREE.MeshStandardMaterial({color:0x241128,roughness:.95});
  ceilMat=new THREE.MeshStandardMaterial({color:0x0b070c,roughness:1});
  wallMat=new THREE.MeshStandardMaterial({color:0x3c1018,roughness:.9});

  characterSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:eleonoraTexture,transparent:true,depthWrite:false}));
  characterSprite.scale.set(.9,1.35,1);
  scene.add(characterSprite);

  shacoSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:shacoTexture,transparent:true,opacity:0,depthWrite:false}));
  shacoSprite.scale.set(1.7,2.1,1);
  scene.add(shacoSprite);

  window.addEventListener('keydown',onKeyDown);
  window.addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false});
  window.addEventListener('resize',resizeScene);
  requestAnimationFrame(animate);
}

function onKeyDown(e){
  keys[e.key.toLowerCase()]=true;
  if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(e.key.toLowerCase()))e.preventDefault();
  if(e.key==='Escape')start();
}

function resizeScene(){
  if(!renderer)return;
  const el=$('#room'),w=el.clientWidth,h=el.clientHeight;
  if(!w||!h)return;
  camera.aspect=w/h;camera.updateProjectionMatrix();
  renderer.setSize(w,h,false)
}

function doorCountFor(){return Math.min(10,1+state.doors)} // corridor 1 shows a single door; +1 per door opened, capped before chaos

function buildCorridor(){
  if(roomGroup){scene.remove(roomGroup);roomGroup.traverse(o=>{if(o.userData&&o.userData.ownMaterial)o.material.dispose()})}
  roomGroup=new THREE.Group();
  const len=CORR_SOUTH_Z-CORR_FAR_Z,centerZ=(CORR_SOUTH_Z+CORR_FAR_Z)/2;

  const floor=new THREE.Mesh(new THREE.PlaneGeometry(CORR_HALF_W*2,len),floorMat);
  floor.rotation.x=-Math.PI/2;floor.position.z=centerZ;roomGroup.add(floor);
  const ceil=new THREE.Mesh(new THREE.PlaneGeometry(CORR_HALF_W*2,len),ceilMat);
  ceil.rotation.x=Math.PI/2;ceil.position.set(0,3.1,centerZ);roomGroup.add(ceil);
  [{pos:[-CORR_HALF_W,1.55,centerZ],rot:Math.PI/2,geo:[len,3.1]}, // west, long
   {pos:[CORR_HALF_W,1.55,centerZ],rot:-Math.PI/2,geo:[len,3.1]}, // east, long
   {pos:[0,1.55,CORR_SOUTH_Z],rot:Math.PI,geo:[CORR_HALF_W*2,3.1]}, // south, seals shut behind spawn
   {pos:[0,1.55,CORR_FAR_Z],rot:0,geo:[CORR_HALF_W*2,3.1]}] // far end
    .forEach(w=>{const wall=new THREE.Mesh(new THREE.PlaneGeometry(...w.geo),wallMat);wall.position.set(...w.pos);wall.rotation.y=w.rot;roomGroup.add(wall)});

  activeDoors=[];activeMirrors=[];
  const total=doorCountFor();
  const farGetsDoor=total>=4&&Math.random()<.5;
  let remaining=total-(farGetsDoor?1:0),leftN=0,rightN=0;
  while(remaining>0){Math.random()<.5?leftN++:rightN++;remaining--}

  const spanStart=CORR_SOUTH_Z-1.6,spanEnd=CORR_FAR_Z+1.6; // usable length, clear of the end walls
  function sideZ(i,n){if(n===1)return(spanStart+spanEnd)/2;const t=i/(n-1);return spanStart+(spanEnd-spanStart)*t+(Math.random()-.5)*.5}
  const leftZs=[],rightZs=[];
  function makeDoor(x,z,rotY,key,i){
    const isFalse=state.doors>2&&Math.random()<.18;
    const mat=new THREE.MeshStandardMaterial({map:doorTex,transparent:true,emissive:isFalse?0xff4e66:0xf2b84b,emissiveIntensity:.12,roughness:.6}); // own material per door: never shared, never leaks a flash into other doors
    const mesh=new THREE.Mesh(doorGeom,mat);
    mesh.position.set(x,1.05,z);mesh.rotation.y=rotY;
    mesh.userData={ownMaterial:true};
    roomGroup.add(mesh);
    activeDoors.push({mesh,id:`${state.rooms}-${key}${i}-${state.doors}`,isFalse});
    if(key==='L')leftZs.push(z);else if(key==='R')rightZs.push(z);
  }
  for(let i=0;i<leftN;i++)makeDoor(-CORR_HALF_W+.03,sideZ(i,leftN),Math.PI/2,'L',i);
  for(let i=0;i<rightN;i++)makeDoor(CORR_HALF_W-.03,sideZ(i,rightN),-Math.PI/2,'R',i);
  if(farGetsDoor)makeDoor(0,CORR_FAR_Z+.03,0,'F',0);

  // a mirror, some of the time: nothing opens it, it just occasionally shows you something that isn't there —
  // but never close enough to a door on the same wall to overlap it
  const MIRROR_DOOR_GAP=1.35;
  if(Math.random()<.5){
    for(let tries=0;tries<8;tries++){
      const side=Math.random()<.5?-1:1;
      const zs=side<0?leftZs:rightZs;
      const z=spanStart+(spanEnd-spanStart)*(.15+Math.random()*.7);
      if(!zs.every(dz=>Math.abs(dz-z)>MIRROR_DOOR_GAP))continue;
      const mmat=new THREE.MeshStandardMaterial({emissive:0xbfc6e0,emissiveIntensity:.05,color:0x9099b8,metalness:.25,roughness:.4}); // blank glass by default — only reflects up close, or it'd just be a poster
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(.95,1.85),mmat);
      mesh.position.set(side*(CORR_HALF_W-.03),1.1,z);mesh.rotation.y=side<0?Math.PI/2:-Math.PI/2;
      mesh.userData={ownMaterial:true};
      roomGroup.add(mesh);
      activeMirrors.push({mesh,triggered:false,scaring:false,showing:false,showingSince:0});
      break
    }
  }

  scene.add(roomGroup);
}

const MIRROR_REFLECT_DIST=2.3; // stand this close and it shows her; farther off it's just dark glass, not a poster
const MIRROR_STARE_MS=2000; // hold her own reflection this long and it isn't hers anymore

function updateMirrors(){
  const now=performance.now();
  for(const m of activeMirrors){
    const dist=Math.hypot(m.mesh.position.x-player.x,m.mesh.position.z-player.z);
    if(!m.scaring){
      const shouldShow=dist<MIRROR_REFLECT_DIST;
      if(shouldShow!==m.showing){
        m.showing=shouldShow;
        m.showingSince=shouldShow?now:0;
        m.mesh.material.map=shouldShow?eleonoraTexture:null;
        m.mesh.material.emissiveMap=shouldShow?eleonoraTexture:null;
        m.mesh.material.emissiveIntensity=shouldShow?.55:.05;
        m.mesh.material.needsUpdate=true
      }
      if(!m.triggered&&m.showing&&now-m.showingSince>MIRROR_STARE_MS)mirrorScare(m)
    }
  }
}

function mirrorScare(m){
  if(m.triggered)return;
  m.triggered=true;m.scaring=true;
  ensureAudio();
  m.mesh.material.map=shacoTexture;m.mesh.material.emissiveMap=shacoTexture;m.mesh.material.emissive.set(0xff4e66);m.mesh.material.emissiveIntensity=.55;m.mesh.material.needsUpdate=true;
  shacoLaugh();tone(80,.5,'sawtooth',.05);
  toast('Nello specchio non eri sola.');
  setTimeout(()=>{if(!m.mesh.material)return;m.scaring=false;m.showing=false;m.mesh.material.emissive.set(0xbfc6e0);m.mesh.material.needsUpdate=true},650) // lets updateMirrors reassert the real reflection next frame, since we're still standing here
}

function triggerShacoCharge(){
  if(shacoCharge||!shacoSprite)return;
  shacoSprite.position.set(0,CHAR_BASE_Y+.25,CORR_FAR_Z+1);
  shacoSprite.material.opacity=1;
  shacoCharge={fromZ:CORR_FAR_Z+1,toZ:player.z-.9,start:performance.now()};
  transitioning=true;
  ensureAudio();shacoLaugh();
}

function enterRoom(isFirst){
  buildCorridor();
  player.x=0;player.z=CORR_SOUTH_Z-1;player.yaw=0;
  transitioning=false;
  if(isFirst){
    mode='intro';introUntil=performance.now()+INTRO_DURATION;
    characterSprite.material.opacity=1;
    characterSprite.position.set(player.x,CHAR_BASE_Y,player.z);
  }else{
    mode='fps';
    characterSprite.material.opacity=0;
    camera.position.set(player.x,EYE_Y,player.z);
    camera.rotation.set(0,player.yaw,0);
    if(Math.random()<Math.min(.65,.12+state.doors*.05)){
      const delay=1400+Math.random()*2200;
      setTimeout(()=>{if(mode==='fps'&&!transitioning)triggerShacoCharge()},delay)
    }
  }
}

function ambientShacoPeek(){
  if(!shacoSprite||!activeDoors.length)return;
  const pick=activeDoors[Math.floor(Math.random()*activeDoors.length)].mesh;
  shacoSprite.position.set(pick.position.x*.7,CHAR_BASE_Y+.15,pick.position.z*.7);
  shacoPeekUntil=performance.now()+900
}

function updateMovement(dt){
  let turn=0,fwd=0;
  if(keys['a']||keys['arrowleft'])turn+=1;
  if(keys['d']||keys['arrowright'])turn-=1;
  if(keys['w']||keys['arrowup'])fwd+=1;
  if(keys['s']||keys['arrowdown'])fwd-=1;
  player.yaw+=turn*TURN_SPEED*dt;
  camera.rotation.set(0,player.yaw,0);
  if(fwd){
    const dir=new THREE.Vector3();
    camera.getWorldDirection(dir);dir.y=0;dir.normalize();
    player.x+=dir.x*fwd*MOVE_SPEED*dt;
    player.z+=dir.z*fwd*MOVE_SPEED*dt;
  }
  player.x=Math.max(-CORR_HALF_W+.35,Math.min(CORR_HALF_W-.35,player.x));
  player.z=Math.max(CORR_FAR_Z+.35,Math.min(CORR_SOUTH_Z-.35,player.z));
  camera.position.set(player.x,EYE_Y,player.z);

  for(const d of activeDoors){
    if(state.opened.has(d.id))continue;
    if(Math.hypot(d.mesh.position.x-player.x,d.mesh.position.z-player.z)<DOOR_TRIGGER_DIST){enterDoor(d);return}
  }
  updateMirrors();
}

function enterDoor(d){
  if(transitioning)return;
  transitioning=true;
  state.opened.add(d.id);
  ensureAudio();doorSound();flashScreen();
  state.doors++;heartbeat();
  state.threat=Math.min(100,state.threat+Math.floor(5+Math.random()*10));
  state.rooms++;
  if(d.isFalse){toast('La porta si è chiusa dietro di te. Ma non eri tu a chiuderla.');state.threat=Math.min(100,state.threat+12)}
  else if(state.doors===1)toast('Un corridoio nuovo. Le porte non diminuiscono.');
  else toast(Math.random()<.5?'Hai aperto una porta. Il pubblico applaude.':'Qualcuno ha cambiato posto alle pareti.');
  setText();
  if(state.doors>=CHAOS_LIMIT){setTimeout(launchChaos,500);return}
  if(Math.random()<Math.min(.82,.18+state.doors*.08))setTimeout(triggerShaco,260);
  setTimeout(()=>enterRoom(false),420)
}

// ---------- the void: floor gives out, camera falls past a solid cylindrical wall of exit doors ----------
// static and dense on purpose: a fixed wall you fall alongside and can turn to look at in any
// direction (including straight behind), not a sparse field you fall "past".
function buildVoidDoors(centerY){
  if(voidMesh){scene.remove(voidMesh);voidMesh.material.dispose()} // geometry is the shared doorGeom — never dispose that
  const mat=new THREE.MeshStandardMaterial({map:doorTex,transparent:true,emissive:0xf2b84b,emissiveIntensity:.22,roughness:.6,side:THREE.DoubleSide});
  voidMesh=new THREE.InstancedMesh(doorGeom,mat,VOID_RING_DOORS*VOID_RINGS);
  const dummy=new THREE.Object3D();
  let idx=0;
  for(let r=0;r<VOID_RINGS;r++){
    const y=centerY+(r-VOID_RINGS/2)*VOID_SPACING;
    const rowOffset=r%2?Math.PI/VOID_RING_DOORS:0; // brick-lay the rings so seams never line up into a gap
    for(let a=0;a<VOID_RING_DOORS;a++){
      const ang=(a/VOID_RING_DOORS)*Math.PI*2+rowOffset;
      dummy.position.set(Math.cos(ang)*VOID_RADIUS,y,Math.sin(ang)*VOID_RADIUS);
      dummy.rotation.set(0,0,0);
      dummy.lookAt(0,y,0);dummy.rotateY(Math.PI); // face the door inward, toward the fall axis
      dummy.updateMatrix();
      voidMesh.setMatrixAt(idx++,dummy.matrix);
    }
  }
  voidMesh.instanceMatrix.needsUpdate=true;
  scene.add(voidMesh);
}
function updateFalling(dt){
  let turn=0,pitch=0;
  if(keys['a']||keys['arrowleft'])turn+=1;
  if(keys['d']||keys['arrowright'])turn-=1;
  if(keys['w']||keys['arrowup'])pitch+=1;
  if(keys['s']||keys['arrowdown'])pitch-=1;
  fallYaw+=turn*TURN_SPEED*dt;
  fallPitch=Math.max(-.7,Math.min(.7,fallPitch+pitch*TURN_SPEED*.6*dt)); // steeper than this and the doors foreshorten to lines, exposing the hollow tube behind them
  camera.position.y-=FALL_SPEED*dt;
  camera.rotation.set(fallPitch,fallYaw,0);
}

function launchChaos(){
  if(state.chaos)return;
  state.chaos=true;transitioning=true;mode='falling';setText();
  const room=$('#room');
  $('#door-storm').innerHTML=''; // the 3D void doors replace the old 2D door-storm overlay
  if(roomGroup){scene.remove(roomGroup);roomGroup=null}
  activeDoors=[];activeMirrors=[];shacoCharge=null;
  fallYaw=player.yaw;fallPitch=0;
  camera.position.set(0,camera.position.y,0);
  buildVoidDoors(camera.position.y);
  flashScreen();shacoWhy();
  $('#shaco-glimpse').classList.add('box-mode');
  room.classList.add('chaos');
  toast('Il pavimento non c\'era. Sotto e sopra, solo altre porte.');
  setTimeout(showShaco,FALL_DURATION*.45);
  setTimeout(()=>{room.classList.remove('chaos');$('#shaco-glimpse').classList.remove('show','box-mode');if(voidMesh){scene.remove(voidMesh);voidMesh.material.dispose();voidMesh=null}start()},FALL_DURATION)
}

function animate(now){
  requestAnimationFrame(animate);
  if(!state.started||!renderer)return;
  const dt=Math.min(.05,(now-(lastFrame||now))/1000);
  lastFrame=now;
  const t=now*.001;

  activeDoors.forEach(({mesh,isFalse})=>{if(isFalse)mesh.material.emissiveIntensity=.4+.3*Math.sin(t*3+mesh.position.x+mesh.position.z)});

  if(shacoCharge){
    const p=Math.min(1,(now-shacoCharge.start)/SHACO_CHARGE_DURATION);
    const e=p*p; // ease-in: builds, then closes fast
    shacoSprite.position.z=shacoCharge.fromZ+(shacoCharge.toZ-shacoCharge.fromZ)*e;
    shacoSprite.position.x=Math.sin(p*11)*.15;
    if(p>=1){
      shacoCharge=null;flashScreen();tone(50,.4,'square',.08);
      toast('Shaco ti ha quasi presa.');
      state.threat=Math.min(100,state.threat+15);setText();
      setTimeout(()=>{shacoSprite.material.opacity=0;transitioning=false},220)
    }
  }else if(shacoSprite){
    const target=now<shacoPeekUntil?.85:0;
    shacoSprite.material.opacity+=(target-shacoSprite.material.opacity)*.18
  }

  if(mode==='intro'){
    camera.position.set(player.x*.3,2.6,player.z+2.4);
    camera.lookAt(player.x,1.1,player.z-1.2);
    characterSprite.position.set(player.x,CHAR_BASE_Y+Math.sin(t*2)*.03,player.z);
    if(now>=introUntil){mode='fps';characterSprite.material.opacity=0}
  }else if(mode==='fps'&&!transitioning){
    updateMovement(dt);
  }else if(mode==='falling'){
    updateFalling(dt);
  }

  renderer.render(scene,camera)
}

// ---------- lifecycle ----------
function start(){
  const isFirstEver=!state.started;
  state.started=true;state.chaos=false;state.doors=0;state.rooms=1;state.threat=0;state.opened=new Set();
  shacoCharge=null;
  ensureAudio();startCircusMusic();circusBell();
  if(isFirstEver)shacoWhy(); // "why so serious" opens the show; launchChaos() plays it again to close each act
  $('#game').classList.add('music-tremble','playing');
  $('#intro-panel').classList.add('hidden');
  $('#ending').classList.add('hidden');
  $('#play-area').classList.remove('hidden');
  $('#room').classList.remove('chaos');
  $('#door-storm').innerHTML='';
  $('#reset-card').style.opacity='';
  initThree();
  resizeScene();
  enterRoom(true);
  setText()
}
$('#start-btn').addEventListener('click',start);
$('#again-btn').addEventListener('click',start);
