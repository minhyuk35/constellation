import { MonitorConnection } from './connection.js';
import { kioskKey } from '../exhibition/api.js';

const $=id=>document.getElementById(id);
let connection,view,selected=null,devices=[],received=0,hasSnapshot=false,connected=false,connectionAt=0;
let mode='head',loginGeneration=0;
let pendingCommand=null,commandTimer;
const guideNames={idle:'자유 체험',ready:'1 / 5 · 손 펴기',create:'2 / 5 · 별 생성',grab:'3 / 5 · 별 집기',move:'4 / 5 · 별 옮기기',delete:'5 / 5 · 흔들어 지우기',done:'체험 준비 완료'};
function clearCommand(){pendingCommand=null;clearTimeout(commandTimer);}
function tutorialControls() {
  const current=devices.find(d=>d.id===selected),guide=hasSnapshot?view?.target?.ui.guide:null;
  const available=connected&&current&&!current.paused&&received&&Date.now()-received<3000&&!!guide;
  $('tutorial-start').disabled=!available||!!pendingCommand;
  $('tutorial-stop').disabled=!(connected&&current&&guide&&received&&Date.now()-received<30000)||!!pendingCommand||guide?.step==='idle';
  $('tutorial-start').textContent=guide&&guide.step!=='idle'?'튜토리얼 다시 시작':'튜토리얼 시작';
  $('tutorial-phase').textContent=!selected?'기기를 선택해 주세요.':!guide?(hasSnapshot&&view?.target?'헤드셋의 VR 페이지를 새로고침해 주세요.':'기기 연결 확인 중'):guideNames[guide.step];
}
function command(action) {
  if(!selected||pendingCommand)return;
  const requestId=crypto.randomUUID();
  if(!connection?.send({type:'command',id:selected,requestId,action})) {
    $('tutorial-status').textContent='기기 연결을 확인해 주세요.';return;
  }
  pendingCommand={requestId,id:selected};$('tutorial-status').textContent='기기에서 안내를 준비하고 있어요.';tutorialControls();
  commandTimer=setTimeout(()=>{clearCommand();$('tutorial-status').textContent='응답이 없어요. 헤드셋의 VR 화면과 새로고침 여부를 확인해 주세요.';tutorialControls();},6000);
}
$('tutorial-start').onclick=()=>command('tutorial-start');$('tutorial-stop').onclick=()=>command('tutorial-stop');
const cards=new Map();
$('monitor-key').value=kioskKey();
function overlay(text) {
  $('viewer-overlay').hidden=!text;
  if(text)$('viewer-message').textContent=text;
}
function resetView() {received=0;hasSnapshot=false;view?.reset();}
function select(id) {
  clearCommand();$('tutorial-status').textContent='안내 중에는 연습 동작만 허용하며, 기존 작품은 유지됩니다.';
  selected=id;resetView();connectionAt=devices.find(d=>d.id === id)?.connectedAt || 0;
  $('selected-device').textContent=devices.find(d=>d.id === id)?.name || '선택한 기기';
  overlay('선택한 기기의 작업 공간을 불러오는 중입니다.');
  connection?.send({type:'watch',id});renderDevices();
  tutorialControls();
}
function renderDevices() {
  const ids=new Set(devices.map(d=>d.id));
  for(const [id,card] of cards)if(!ids.has(id)){card.remove();cards.delete(id);}
  $('device-count').textContent=connected?devices.length:'—';
  $('devices-empty').hidden=devices.length > 0;
  for(const device of [...devices].sort((a,b)=>a.name.localeCompare(b.name))) {
    let card=cards.get(device.id);
    if(!card) {
      card=document.createElement('button');card.className='device-card';
      const title=document.createElement('strong'),state=document.createElement('span'),detail=document.createElement('small');
      state.className='device-state';card.append(title,state,detail);card.onclick=()=>select(device.id);
      cards.set(device.id,card);
    }
    card.setAttribute('aria-pressed',String(device.id === selected));
    card.children[0].textContent=device.name;
    card.children[1].textContent=device.paused?'일시정지':'VR 이용 중';
    card.children[1].classList.toggle('paused',device.paused);
    card.children[2].textContent=`${device.platform} · ${device.id.slice(0,4).toUpperCase()} · 별자리 ${device.works}개 / 별 ${device.stars}개`;
    $('device-list').append(card);
  }
  const current=devices.find(d=>d.id === selected);
  for(const [id,key] of [['stat-works','works'],['stat-stars','stars'],['stat-hands','hands']])$(id).textContent=current?.[key] ?? '—';
  $('stat-state').textContent=current?(current.paused?'일시정지':'VR 이용 중'):selected?'연결 종료':'선택 대기';
  if(current) {
    $('selected-device').textContent=current.name;
    if(connectionAt && connectionAt !== current.connectedAt){resetView();overlay('기기가 다시 연결되었습니다. 새 화면을 기다리는 중입니다.');}
    connectionAt=current.connectedAt;
  } else if(selected)overlay('이 기기의 VR 연결이 종료되었습니다. 다시 입장하면 자동으로 연결됩니다.');
}
function tickStatus() {
  const current=devices.find(d=>d.id === selected),age=received?Date.now()-received:Infinity;
  const live=connected && current && !current.paused && hasSnapshot && age < 3000;
  $('view-state').textContent=live?'LIVE':current?.paused?'일시정지':selected?'수신 대기':'대기';
  $('view-state').className=`state-badge${live?' live':selected?' stale':''}`;
  $('last-update').textContent=received?`최근 수신 ${(age/1000).toFixed(1)}초 전`:'수신 대기';
  if(live)overlay('');
  else if(current?.paused)overlay('헤드셋이 일시정지 상태입니다. 마지막으로 수신한 작업 공간을 표시합니다.');
  else if(connected && current && received && age > 3000)overlay('실시간 갱신이 지연되고 있습니다. 마지막 수신 화면입니다.');
  tutorialControls();
}
function message(data) {
  if(data.type==='command-result'&&pendingCommand?.requestId===data.requestId&&pendingCommand.id===data.id) {
    clearCommand();$('tutorial-status').textContent=data.status==='applied'?'기기에 반영했어요.':data.status==='busy'?'잠시 후 다시 눌러주세요.':data.status==='offline'?'기기 연결이 종료되었어요.':'헤드셋에서 VR을 시작하고 화면을 켜주세요.';tutorialControls();return;
  }
  if(data.type === 'devices') {devices=data.devices;renderDevices();return;}
  if(data.type === 'ready') {if(selected)connection.send({type:'watch',id:selected});return;}
  if(data.id !== selected || !view)return;
  try {
    if(data.type === 'snapshot'){view.snapshot(data.state);hasSnapshot=true;}
    else if(data.type === 'patch' && hasSnapshot)view.patch(data.entities);
    else if(data.type === 'frame' && hasSnapshot){view.frame(data.frame);received=Date.now();}
  } catch {hasSnapshot=false;connection.send({type:'watch',id:selected});}
  tickStatus();
}
function state(status,error) {
  connected=status === 'connected';
  $('device-count').textContent=connected?devices.length:'—';
  $('device-list').inert=!connected;
  $('monitor-status').classList.toggle('error',status === 'error');
  const messages={connected:'운영자 연결 완료 · 목록에서 기기를 선택해 주세요.',connecting:'모니터링 서버에 연결 중입니다.',
    reconnecting:'연결이 끊겨 다시 연결하고 있습니다.',disconnected:'운영자 키로 연결해 주세요.',error:error || '모니터링 연결을 확인해 주세요.'};
  $('monitor-status').textContent=messages[status] || '';
  $('monitor-connect').disabled=status === 'connecting';
  $('monitor-disconnect').hidden=!['connecting','connected','reconnecting'].includes(status);
  if(!connected && selected)overlay('모니터링 서버 연결을 기다리는 중입니다.');
  if(!connected)clearCommand();tutorialControls();
}
$('monitor-login').onsubmit=async event=>{
  event.preventDefault();connection?.stop();
  const generation=++loginGeneration;
  const key=$('monitor-key').value.trim();if(!key)return;
  try {
    if(!view) {
      $('monitor-connect').disabled=true;
      const {MonitorView}=await import('./MonitorView.js');
      if(generation !== loginGeneration)return;
      view=new MonitorView($('monitor-stage'));view.reset();view.setMode(mode);
    }
    connection=new MonitorConnection('operator',{message,state});
    connection.start({operatorKey:key});
  } catch {
    state('error','3D 모니터링 화면을 준비하지 못했습니다. WebGL을 지원하는 브라우저에서 다시 열어 주세요.');
  }
};
$('monitor-disconnect').onclick=()=>{
  clearCommand();
  loginGeneration++;
  connection?.stop();devices=[];selected=null;connectionAt=0;resetView();renderDevices();
  $('selected-device').textContent='기기를 선택해 주세요';overlay('운영자 키로 연결해 주세요.');
};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{
  mode=button.dataset.view;
  for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b === button));
  view?.setMode(mode);
  $('view-description').textContent=button.dataset.view === 'head'?'사용자가 바라보는 방향을 따라갑니다.':'마우스로 회전·확대해 공간 전체와 손 위치를 살펴보세요.';
};
const timer=setInterval(tickStatus,500);
window.addEventListener('pagehide',()=>{clearInterval(timer);clearCommand();connection?.stop();view?.dispose();});
