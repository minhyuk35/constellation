import { api } from '../exhibition/api.js';
import { HEARTBEAT_INTERVAL, MAX_MONITOR_MESSAGE } from './protocol.js';

export function socketUrl(ticket) {
  const url=new URL('/api/vr-monitor/socket',import.meta.env.VITE_EXHIBITION_API_URL || location.origin);
  url.protocol=url.protocol === 'https:'?'wss:':'ws:';
  url.searchParams.set('ticket',ticket);
  return url.href;
}
export class MonitorConnection {
  constructor(role,{message=()=>{},state=()=>{},heartbeat=()=>({})}={}) {
    Object.assign(this,{role,onMessage:message,onState:state,heartbeat});
    this.generation=0;
  }
  start(options={}) {
    this.stop();this.options=options;this.active=true;this.attempt=0;
    this.connect(this.generation);
  }
  async connect(generation) {
    if(!this.active || generation !== this.generation)return;
    this.onState('connecting');
    try {
      const {operatorKey,...data}=this.options;
      const {ticket}=await api('/vr-monitor/ticket',{method:'POST',body:{role:this.role,...data},
        ...(this.role === 'operator'?{kiosk:true,operatorKey}:{})});
      if(!this.active || generation !== this.generation)return;
      const ws=this.socket=new WebSocket(socketUrl(ticket));
      ws.onopen=()=>{
        if(generation !== this.generation){ws.close();return;}
        this.attempt=0;this.lastReceived=Date.now();this.onState('connected');
        this.beat();this.timer=setInterval(()=>this.beat(),HEARTBEAT_INTERVAL);
      };
      ws.onmessage=({data})=>{
        if(generation !== this.generation || typeof data !== 'string' || data.length > MAX_MONITOR_MESSAGE)return;
        this.lastReceived=Date.now();
        try { this.onMessage(JSON.parse(data)); } catch { this.onState('error','모니터링 데이터를 확인하지 못했습니다.'); }
      };
      ws.onerror=()=>{};
      ws.onclose=event=>{
        if(generation !== this.generation)return;
        clearInterval(this.timer);
        if(event.code === 4001) {
          this.active=false;this.onState('error','다른 VR 탭에서 이 기기가 다시 연결되었습니다.');return;
        }
        this.onState('reconnecting');this.retry(generation);
      };
    } catch(error) {
      if(generation !== this.generation)return;
      this.onState('error',error.message);
      if(this.role === 'operator' && error.status === 403){this.active=false;return;}
      this.retry(generation);
    }
  }
  beat() {
    if(Date.now()-this.lastReceived > 30000){this.socket?.close();return;}
    this.send({type:'heartbeat',...(this.role === 'device'?{status:this.heartbeat()}:{})});
  }
  retry(generation) {
    if(!this.active)return;
    clearTimeout(this.retryTimer);
    this.retryTimer=setTimeout(()=>this.connect(generation),Math.min(15000,1000*2**this.attempt++));
  }
  send(data) {
    if(this.socket?.readyState !== 1 || this.socket.bufferedAmount > 131072)return false;
    this.socket.send(JSON.stringify(data));return true;
  }
  stop() {
    this.active=false;this.generation++;
    clearInterval(this.timer);clearTimeout(this.retryTimer);
    this.socket?.close(1000,'Leaving monitor');this.socket=null;
    this.onState('disconnected');
  }
}
