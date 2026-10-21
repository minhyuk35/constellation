import { cleanSnapshot, cleanPatch, cleanFrame, cleanStatus, CONNECTION_TIMEOUT,
  MAX_MONITOR_MESSAGE,cleanTutorialCommand } from '../src/monitor/protocol.js';

// Only small connection metadata lives in hibernation attachments. World and
// pose data are relayed to authorized subscribers, never written to D1/storage.
export class VRMonitorRoom {
  constructor(ctx) { this.ctx=ctx; }
  sockets(role) {
    return this.ctx.getWebSockets().filter(ws=>ws.readyState === 1 && (!role || ws.deserializeAttachment()?.role === role));
  }
  send(ws,data) { try { ws.send(JSON.stringify(data)); } catch { ws.close(1011,'Connection lost'); } }
  devices() {
    return this.sockets('device').map(ws=>{
      const m=ws.deserializeAttachment();
      return {id:m.id,name:m.name,platform:m.platform,connectedAt:m.connectedAt,seenAt:m.seenAt,...m.status};
    });
  }
  publish() {
    const data={type:'devices',devices:this.devices(),now:Date.now()};
    for(const ws of this.sockets('operator'))this.send(ws,data);
  }
  notify(id,refresh=false) {
    if(!id)return;
    const count=this.sockets('operator').filter(ws=>ws.deserializeAttachment().watch === id).length;
    for(const ws of this.sockets('device'))if(ws.deserializeAttachment().id === id)
      this.send(ws,{type:'watchers',count,refresh});
  }
  prune() {
    let changed=false;
    for(const ws of this.sockets()) {
      const meta=ws.deserializeAttachment();
      if(Date.now()-meta.seenAt > CONNECTION_TIMEOUT) {
        ws.close(4000,'Heartbeat timeout');changed=true;
        if(meta.role === 'operator')this.notify(meta.watch);
      }
    }
    return changed;
  }
  fetch(request) {
    if(request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('WebSocket required',{status:426});
    const claims=JSON.parse(decodeURIComponent(request.headers.get('X-Monitor-Claims') || 'null'));
    if(!claims || !['device','operator'].includes(claims.role))return new Response('Forbidden',{status:403});
    this.prune();
    const previous=claims.role === 'device'?this.sockets('device').find(ws=>ws.deserializeAttachment().id === claims.id):null;
    if(this.sockets(claims.role).length - (previous?1:0) >= (claims.role === 'device'?64:8))
      return new Response('Monitor capacity reached',{status:429});
    previous?.close(4001,'Device reconnected');
    const [client,server]=Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({...claims,connectedAt:Date.now(),seenAt:Date.now(),watch:null,
      status:{paused:false,stars:0,works:0,hands:0},window:0,messages:0});
    this.send(server,{type:'ready',id:claims.id,role:claims.role});
    if(claims.role === 'device')this.notify(claims.id,true);
    this.publish();
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws,raw) {
    try {
      if(typeof raw !== 'string' || raw.length > MAX_MONITOR_MESSAGE)throw new Error('Message size');
      const meta=ws.deserializeAttachment(),window=Math.floor(Date.now()/1000);
      meta.messages=meta.window === window?meta.messages+1:1;meta.window=window;
      if(meta.messages > 45)throw new Error('Message rate');
      meta.seenAt=Date.now();
      const data=JSON.parse(raw);
      if(data.type === 'heartbeat') {
        if(meta.role === 'device')meta.status=cleanStatus(data.status);
        ws.serializeAttachment(meta);
        this.send(ws,{type:'pong'});
        this.prune();this.publish();return;
      }
      if(meta.role === 'operator') {
        if(data.type==='command') {
          const command=cleanTutorialCommand(data);
          if(data.id!==meta.watch||!meta.watch)throw new Error('Select a device first');
          const device=this.sockets('device').find(s=>s.deserializeAttachment().id===meta.watch);
          const status=!device?'offline':command.action==='tutorial-start'&&Date.now()-(meta.lastCommand||0)<600?'busy':null;
          if(status)this.send(ws,{type:'command-result',id:meta.watch,...command,status});
          else {meta.lastCommand=Date.now();this.send(device,{type:'command',...command});}
          ws.serializeAttachment(meta);return;
        }
        if(data.type !== 'watch' || (data.id !== null && !/^[a-f0-9-]{36}$/i.test(data.id)))throw new Error('Invalid command');
        const previous=meta.watch;meta.watch=data.id;ws.serializeAttachment(meta);
        this.notify(previous);this.notify(meta.watch,true);
        return;
      }
      ws.serializeAttachment(meta);
      const viewers=this.sockets('operator').filter(viewer=>viewer.deserializeAttachment().watch === meta.id);
      if(data.type==='command-result') {
        const command=cleanTutorialCommand(data);
        if(!['applied','unavailable'].includes(data.status))throw new Error('Invalid command result');
        for(const viewer of viewers)this.send(viewer,{type:'command-result',id:meta.id,...command,status:data.status});return;
      }
      if(!viewers.length)return;
      let payload;
      if(data.type === 'snapshot')payload={state:cleanSnapshot(data.state)};
      else if(data.type === 'patch')payload={entities:cleanPatch(data.entities)};
      else if(data.type === 'frame')payload={frame:cleanFrame(data.frame)};
      else throw new Error('Invalid device message');
      for(const viewer of viewers)this.send(viewer,{type:data.type,id:meta.id,...payload});
    } catch { ws.close(1008,'Invalid monitor message'); }
  }
  webSocketClose(ws) {
    const meta=ws.deserializeAttachment();
    ws.close(1000,'Connection closed');
    if(meta?.role === 'operator')this.notify(meta.watch);
    this.publish();
  }
  webSocketError(ws) { ws.close(1011,'Connection error');this.webSocketClose(ws); }
}
