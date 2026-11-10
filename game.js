(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const canvas = $('court'), ctx = canvas.getContext('2d');
  const maps = [
    { id:'sunset', name:'Golden Hour', tag:'THE CLASSIC', subtitle:'Warm sand · soft serve', sky:['#f6a678','#f1c493','#5a9a91'], sand:'#d4a36f', court:'#ddbc83', accent:'#ffb26e', unlock:0 },
    { id:'ice', name:'Frostline Bay', tag:'COOL & COLLECTED', subtitle:'Aurora skies · crisp plays', sky:['#79c9dd','#c0ece5','#558c9e'], sand:'#c8e4df', court:'#97d1ce', accent:'#d6ffff', unlock:0 },
    { id:'neon', name:'Neon Nights', tag:'AFTER DARK', subtitle:'Electric lights · big energy', sky:['#301c65','#a94caa','#e8589b'], sand:'#57469b', court:'#9e71b2', accent:'#ff82d2', unlock:0 },
    { id:'tropic', name:'Palm Point', tag:'ISLAND TIME', subtitle:'Palm shade · ocean breeze', sky:['#43b9c5','#a4dfc4','#427a68'], sand:'#cfbd75', court:'#ddcf8f', accent:'#e5ff83', unlock:0 }
  ];
  const saved = (() => { try { return JSON.parse(localStorage.getItem('volleyverse-save') || '{}'); } catch { return {}; } })();
  let coins = Number.isFinite(saved.coins) ? saved.coins : 120;
  let wins = saved.wins || 0, played = saved.played || 0, streak = saved.streak || 0;
  let selectedMap = maps[0], state = 'lobby', audioOn = true, lastTime = 0, gameTime = 0;
  let player = null, rival = null, ball = null, score = {player:0,rival:0}, rally = 'serve-player';
  let pointPause = 0, serveClock = 0, hitWindow = 0, toastClock = 0, matchOver = false;
  let keys = new Set(), touchMove = {x:0,z:0}, remoteMove = {x:0,z:0,hit:false}, peer = null, connection = null;
  let onlineRole = 'solo', connected = false, guestSnapshot = null, lastPacket = 0;
  let width = 0, height = 0, dpr = 1, frame = 0, soundCtx = null;

  function persist(){ localStorage.setItem('volleyverse-save', JSON.stringify({coins,wins,played,streak,daily: saved.daily})); $('coin-count').textContent = coins; }
  function showToast(message){ const el=$('global-toast'); el.textContent=message; el.classList.add('show'); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>el.classList.remove('show'),2300); }
  function setScreen(name){
    $('lobby-screen').classList.toggle('hidden',name!=='lobby'); $('setup-screen').classList.toggle('hidden',name!=='setup');
    $('online-panel').classList.toggle('hidden',name!=='online'); $('game-ui').classList.toggle('hidden',name!=='game');
    state=name;
  }
  function resize(){
    dpr=Math.min(window.devicePixelRatio||1,2); width=window.innerWidth; height=window.innerHeight;
    canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr); canvas.style.width=width+'px'; canvas.style.height=height+'px'; ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  window.addEventListener('resize',resize); resize();
  $('coin-count').textContent=coins;

  const music={
    beep(freq=520,duration=.08,type='sine',volume=.035){ if(!audioOn)return; try{soundCtx ||= new (window.AudioContext||window.webkitAudioContext)(); const o=soundCtx.createOscillator(),g=soundCtx.createGain(); o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(volume,soundCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,soundCtx.currentTime+duration);o.connect(g);g.connect(soundCtx.destination);o.start();o.stop(soundCtx.currentTime+duration);}catch{} }
  };
  $('sound-toggle').addEventListener('click',()=>{audioOn=!audioOn;$('sound-toggle').textContent=audioOn?'♫':'♩';showToast(audioOn?'Sound on':'Sound off');});

  function updateMapCards(){
    $('map-grid').innerHTML='';
    maps.forEach(map=>{
      const card=document.createElement('button');card.className='map-card'+(selectedMap.id===map.id?' selected':'');card.dataset.map=map.id;card.setAttribute('aria-label',`${map.name}: ${map.subtitle}`);
      card.innerHTML=`<div class="map-art"><span class="sun"></span><span class="horizon"></span></div><span class="map-check">✓</span><span class="map-info"><span class="map-tag">${map.tag}</span><strong>${map.name}</strong><small>${map.subtitle}</small></span>`;
      card.addEventListener('click',()=>{selectedMap=map;updateMapCards();music.beep(620,.07);}); $('map-grid').append(card);
    });
  }
  updateMapCards();
  $('play-btn').addEventListener('click',()=>{onlineRole='solo';setScreen('setup');});
  $('quick-play').addEventListener('click',()=>{onlineRole='solo';startMatch();});
  $('online-open').addEventListener('click',()=>setScreen('online'));
  document.querySelectorAll('[data-back]').forEach(btn=>btn.addEventListener('click',()=>setScreen('lobby')));
  document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{
    const tab=btn.dataset.tab;document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b===btn));
    if(tab==='home')setScreen('lobby'); else if(tab==='courts'){onlineRole='solo';setScreen('setup');}
    else if(tab==='locker')showToast(`LOCKER · ${wins} wins · ${coins} coins — new gear drops soon!`);
    else if(tab==='rewards')showToast(`REWARDS · ${streak} day streak · ${played} matches played`);
  }));
  $('claim-daily').addEventListener('click',()=>{
    const today=new Date().toISOString().slice(0,10);
    if(saved.daily===today){showToast('Daily drop already claimed — come back tomorrow!');return;}
    saved.daily=today;coins+=50;persist();$('daily-label').textContent='Claimed! See you tomorrow';$('claim-daily').innerHTML='CLAIMED <span>✓</span>';music.beep(780,.15,'triangle');showToast('Daily drop claimed · +50 coins!');
  });
  if(saved.daily===new Date().toISOString().slice(0,10)){$('daily-label').textContent='Your daily gift is claimed';$('claim-daily').innerHTML='CLAIMED <span>✓</span>';}

  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function screenPoint(x,y,z){
    const menu=state!=='game'&&state!=='result';
    const s=Math.min(width/(menu?26:23),height/(menu?18:17));
    const centerX=menu?width*.665:width*.5, baseY=menu?height*.595:height*.515;
    const perspective=1-z*.022;
    return {x:centerX+x*s*perspective,y:baseY+z*s*.47*perspective-y*s*perspective,scale:s*perspective};
  }
  function polygon(points,fill,stroke=null,lineWidth=1){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.stroke();}}
  function line(a,b,color,width=1){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function drawBackground(now){
    const map=selectedMap||maps[0], grad=ctx.createLinearGradient(0,0,0,height);grad.addColorStop(0,map.sky[0]);grad.addColorStop(.51,map.sky[1]);grad.addColorStop(1,map.sky[2]);ctx.fillStyle=grad;ctx.fillRect(0,0,width,height);
    const sunX=width*(state==='game'?.81:.78), sunY=height*.24, radius=Math.min(width,height)*.09;
    const halo=ctx.createRadialGradient(sunX,sunY,2,sunX,sunY,radius*2.7);halo.addColorStop(0,map.accent+'cc');halo.addColorStop(.28,map.accent+'54');halo.addColorStop(1,map.accent+'00');ctx.fillStyle=halo;ctx.fillRect(sunX-radius*3,sunY-radius*3,radius*6,radius*6);
    ctx.fillStyle=map.accent;ctx.globalAlpha=.86;ctx.beginPath();ctx.arc(sunX,sunY,radius*.57,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    // distant islands and breezy clouds
    const horizon=height*.43;ctx.fillStyle=map.id==='neon'?'#39245d':'#376e68';ctx.globalAlpha=.48;
    ctx.beginPath();ctx.moveTo(0,horizon+42);ctx.lineTo(width*.08,horizon+13);ctx.lineTo(width*.16,horizon+25);ctx.lineTo(width*.27,horizon-6);ctx.lineTo(width*.4,horizon+39);ctx.lineTo(width*.52,horizon+12);ctx.lineTo(width*.68,horizon+34);ctx.lineTo(width*.81,horizon+2);ctx.lineTo(width,horizon+27);ctx.lineTo(width,height*.76);ctx.lineTo(0,height*.76);ctx.closePath();ctx.fill();ctx.globalAlpha=1;
    for(let i=0;i<5;i++){const cx=((i*267+now*.006*(i%2?1:-1))%(width+160))-80,cy=height*(.13+(i%3)*.07),w=55+(i%3)*20;ctx.globalAlpha=.15;ctx.fillStyle='#fff4dc';ctx.beginPath();ctx.ellipse(cx,cy,w,5,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
    // far ocean haze
    const sea=ctx.createLinearGradient(0,horizon,0,height);sea.addColorStop(0,map.sky[2]+'66');sea.addColorStop(1,map.sky[2]+'00');ctx.fillStyle=sea;ctx.fillRect(0,horizon,width,height-horizon);
    // palm silhouettes on tropical / beach courts
    if(map.id==='tropic'||map.id==='sunset'){
      const color=map.id==='tropic'?'#18594e':'#244c48';ctx.fillStyle=color;ctx.globalAlpha=.47;
      for(const side of [-1,1]){const x=side<0?width*.06:width*.94,y=height*.61;ctx.save();ctx.translate(x,y);ctx.rotate(side*.08);ctx.fillRect(-3,-95,6,95);for(let n=0;n<6;n++){ctx.save();ctx.rotate((n-2.5)*.45);ctx.beginPath();ctx.ellipse(0,-95,9,47,0,0,Math.PI,0);ctx.fill();ctx.restore();}ctx.restore();}ctx.globalAlpha=1;
    }
  }
  function courtPolygon(z1,z2,x1,x2){return [screenPoint(x1,0,z1),screenPoint(x2,0,z1),screenPoint(x2,0,z2),screenPoint(x1,0,z2)];}
  function drawCourt(now){
    const menu=state!=='game'&&state!=='result', m=selectedMap||maps[0];
    const outer=menu?courtPolygon(-8.2,8.2,-5.7,5.7):courtPolygon(-8,8,-5.5,5.5);
    const sand=ctx.createLinearGradient(0,height*.3,0,height*.85);sand.addColorStop(0,m.sand);sand.addColorStop(1,m.court);polygon(outer,sand,'rgba(250,237,192,.65)',1.5);
    // subtle court texture and diagonal light
    const p0=screenPoint(-5,0,-7),p1=screenPoint(5,0,7);const sheen=ctx.createLinearGradient(p0.x,p0.y,p1.x,p1.y);sheen.addColorStop(0,'rgba(255,255,255,.1)');sheen.addColorStop(1,'rgba(36,47,35,.07)');polygon(outer,sheen);
    // official boundary + center lines
    const lines=[[[-4.5,-7],[-4.5,7]],[[4.5,-7],[4.5,7]],[[-4.5,-7],[4.5,-7]],[[-4.5,7],[4.5,7]],[[-4.5,0],[4.5,0]]];
    lines.forEach(([a,b])=>line(screenPoint(a[0],0,a[1]),screenPoint(b[0],0,b[1]),'rgba(255,250,222,.83)',1.2));
    // mottled sand flecks
    ctx.save();ctx.globalAlpha=.16;for(let i=0;i<75;i++){let x=(i*127.3+31)%width,y=(i*67.7+height*.48)%(height*.45)+height*.43;if(x>outer[0].x-10&&x<outer[1].x+10){ctx.fillStyle=i%2?'#fff5d5':'#533c2a';ctx.fillRect(x,y,1.3,1.3);}}ctx.restore();
    drawNet(now);
  }
  function drawNet(now){
    const left=screenPoint(-4.75,0,0),right=screenPoint(4.75,0,0),topL=screenPoint(-4.75,2.1,0),topR=screenPoint(4.75,2.1,0);
    // net shadow
    line(screenPoint(-4.8,0,.09),screenPoint(4.8,0,.09),'rgba(16,32,31,.28)',5);
    ctx.fillStyle='rgba(236,245,222,.72)';ctx.beginPath();ctx.moveTo(topL.x,topL.y);ctx.lineTo(topR.x,topR.y);ctx.lineTo(right.x,right.y);ctx.lineTo(left.x,left.y);ctx.closePath();ctx.fill();
    ctx.save();ctx.beginPath();ctx.moveTo(topL.x,topL.y);ctx.lineTo(topR.x,topR.y);ctx.lineTo(right.x,right.y);ctx.lineTo(left.x,left.y);ctx.clip();ctx.strokeStyle='rgba(21,51,51,.42)';ctx.lineWidth=.7;
    const spacing=Math.max(5,(right.x-left.x)/40);for(let x=left.x;x<right.x;x+=spacing){ctx.beginPath();ctx.moveTo(x,topL.y);ctx.lineTo(x,left.y);ctx.stroke();}for(let y=topL.y;y<left.y;y+=7){ctx.beginPath();ctx.moveTo(left.x,y);ctx.lineTo(right.x,y);ctx.stroke();}ctx.restore();
    line(topL,topR,'#fff8df',3);line(left,topL,'#e7e5d0',3);line(right,topR,'#e7e5d0',3);
    [-4.75,4.75].forEach(x=>{const a=screenPoint(x,0,0),b=screenPoint(x,2.35,0);line(a,b,'#f3ead1',3);ctx.beginPath();ctx.arc(b.x,b.y,2.2,0,Math.PI*2);ctx.fillStyle='#ff9367';ctx.fill();});
  }
  function drawPlayer(person,primary=false,now=0){
    if(!person)return;const p=screenPoint(person.x,0,person.z),jump=person.jump||0, s=p.scale, bob=Math.sin(now*.006+(primary?0:1.6))*.035, reach=person.swing>0?Math.sin(person.swing*9)*.26:0;
    // soft foot shadow, expanding slightly while jumping
    ctx.save();ctx.globalAlpha=Math.max(.12,.34-jump*.08);ctx.fillStyle='#183b37';ctx.beginPath();ctx.ellipse(p.x,p.y+2,s*(.33+jump*.04),s*.105,0,0,Math.PI*2);ctx.fill();ctx.restore();
    const body=screenPoint(person.x,1.0+jump+bob,person.z),head=screenPoint(person.x,1.68+jump+bob,person.z),shoulder=screenPoint(person.x,1.28+jump+bob,person.z),hip=screenPoint(person.x,.67+jump+bob,person.z);
    const shirt=primary?'#dcff69':'#ff9673', shadow=primary?'#80a83c':'#b45256', skin=primary?'#b96c4b':'#d18b65', limb=primary?'#142d2d':'#173341';
    // legs
    const stride=Math.sin(now*.008+(primary?0:2))*(person.walking?.14:.025);[[.11,stride],[-.11,-stride]].forEach(([dx,swing])=>{const knee=screenPoint(person.x+dx*.7,.35+jump,person.z),foot=screenPoint(person.x+dx+swing,0.07+jump,person.z);line(hip,knee,limb,s* .105);line(knee,foot,skin,s*.085);line(foot,{x:foot.x+s*.11,y:foot.y+1},limb,s*.1);});
    // torso, shorts and arms
    ctx.fillStyle=shadow;ctx.beginPath();ctx.ellipse(body.x,body.y,s*.22,s*.31,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=shirt;ctx.beginPath();ctx.moveTo(body.x-s*.2,body.y-s*.2);ctx.quadraticCurveTo(body.x,body.y-s*.32,body.x+s*.2,body.y-s*.2);ctx.lineTo(hip.x+s*.16,hip.y);ctx.lineTo(hip.x-s*.16,hip.y);ctx.closePath();ctx.fill();
    ctx.fillStyle=primary?'#263c37':'#263748';ctx.fillRect(hip.x-s*.15,hip.y-s*.015,s*.3,s*.12);
    const armAngle=person.swing>0?-1.35:Math.sin(now*.005+(primary?1:0))*.13;
    [[-1,-armAngle],[1,armAngle]].forEach(([side,angle])=>{const elbow=screenPoint(person.x+side*.32,1.04+jump+bob,person.z),hand=screenPoint(person.x+side*(.4+reach),1.01+jump+bob+(person.swing>0?.36:0),person.z);line(shoulder,elbow,shirt,s*.12);line(elbow,hand,skin,s*.082);});
    // head and sport headband
    const r=s*.145;ctx.fillStyle=skin;ctx.beginPath();ctx.arc(head.x,head.y,r,0,Math.PI*2);ctx.fill();ctx.fillStyle=primary?'#253c35':'#20343b';ctx.beginPath();ctx.arc(head.x-r*.06,head.y-r*.34,r*.99,Math.PI,Math.PI*1.95);ctx.fill();
    ctx.fillStyle=primary?'#fff3c8':'#f8e5cd';ctx.fillRect(head.x-r*.8,head.y-r*.05,r*1.6,r*.16);
    if(person.swing>0){ctx.strokeStyle=primary?'rgba(216,255,100,.7)':'rgba(255,147,103,.7)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(head.x,head.y-r*.5,s*.52,-1.7,-.4);ctx.stroke();}
  }
  function drawBall(now){
    if(!ball)return;const p=screenPoint(ball.x,ball.y,ball.z),r=Math.max(5,p.scale*.16),ground=screenPoint(ball.x,0,ball.z);
    ctx.save();ctx.globalAlpha=Math.max(.08,.2-ball.y*.025);ctx.fillStyle='#17362e';ctx.beginPath();ctx.ellipse(ground.x,ground.y,r*1.25,r*.4,0,0,Math.PI*2);ctx.fill();ctx.restore();
    if(ball.vy>1.5){ctx.globalAlpha=.16;for(let i=1;i<=3;i++){const t=i*.055,tp=screenPoint(ball.x-ball.vx*t,Math.max(0,ball.y-ball.vy*t+4.3*t*t),ball.z-ball.vz*t);ctx.beginPath();ctx.arc(tp.x,tp.y,r*(1-i*.2),0,Math.PI*2);ctx.fillStyle='#fff5c5';ctx.fill();}ctx.globalAlpha=1;}
    const g=ctx.createRadialGradient(p.x-r*.34,p.y-r*.4,r*.05,p.x,p.y,r);g.addColorStop(0,'#fffde4');g.addColorStop(.42,'#fff4c4');g.addColorStop(1,'#e99e54');ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
    ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,r*.95,0,Math.PI*2);ctx.clip();ctx.strokeStyle='rgba(219,123,72,.72)';ctx.lineWidth=Math.max(1,r*.14);ctx.beginPath();ctx.moveTo(p.x-r*.8,p.y-r*.28);ctx.bezierCurveTo(p.x,p.y-r*.8,p.x+r*.65,p.y-r*.15,p.x+r*.78,p.y+r*.48);ctx.moveTo(p.x-r*.55,p.y+r*.78);ctx.bezierCurveTo(p.x-r*.4,p.y,p.x+r*.2,p.y-r*.3,p.x+r*.7,p.y-r*.65);ctx.stroke();ctx.restore();
  }
  function render(now){
    const dt=lastTime?Math.min((now-lastTime)/1000,.05):0;lastTime=now;
    updateGame(dt);
    ctx.clearRect(0,0,width,height);drawBackground(now);drawCourt(now);
    if(state==='game'||state==='result'){
      if(onlineRole==='guest'&&guestSnapshot){
        const snap=guestSnapshot;
        const people=[{...snap.player,z:-snap.player.z}, {...snap.rival,z:-snap.rival.z}].sort((a,b)=>a.z-b.z);
        people.forEach((p,i)=>drawPlayer(p,i===1,now));
        if(snap.ball){const savedBall=ball;ball={...snap.ball,z:-snap.ball.z,vz:-snap.ball.vz};drawBall(now);ball=savedBall;}
      }else{
        const people=[rival,player].filter(Boolean).sort((a,b)=>a.z-b.z);people.forEach(p=>drawPlayer(p,p===player,now));drawBall(now);
      }
    }else{
      const pulse=Math.sin(now*.002)*.14;drawPlayer({x:1.3,z:2.9,jump:Math.max(0,pulse),swing:0},true,now);drawPlayer({x:-1.6,z:-3.3,jump:Math.max(0,-pulse),swing:0},false,now);
      const old=ball;ball={x:1.1+Math.sin(now*.001)*.36,y:3.1+Math.sin(now*.002)*.2,z:-.7,vx:0,vy:0,vz:0};drawBall(now);ball=old;
    }
    frame=requestAnimationFrame(render);
  }
  frame=requestAnimationFrame(render);

  function showGameToast(text){$('game-toast').textContent=text;$('game-toast').classList.add('show');clearTimeout(showGameToast.timer);showGameToast.timer=setTimeout(()=>$('game-toast').classList.remove('show'),1050);}
  function beginServe(forPlayer){
    rally=forPlayer?'serve-player':'serve-rival';serveClock=forPlayer?0:1.0;hitWindow=0;pointPause=0;
    const who=forPlayer?player:rival;ball={x:who.x+(forPlayer?.15:-.15),y:1.9,z:who.z+(forPlayer?-.65:.65),vx:0,vy:0,vz:0,lastHitter:null};
    $('game-hint').innerHTML=forPlayer?'<span>SPACE</span> to serve':'Rival serving…';
  }
  function startMatch(fromNetwork=false){
    if(!fromNetwork&&onlineRole==='guest')return;
    setScreen('game');$('result-modal').classList.add('hidden');$('active-map-label').textContent=selectedMap.name.toUpperCase();
    $('opponent-label').textContent=onlineRole==='host'||onlineRole==='guest'?'FRIEND':'RIVAL';
    player={x:0,z:4.7,jump:0,jumpV:0,swing:0,walking:false};rival={x:0,z:-4.6,jump:0,jumpV:0,swing:0,walking:false};score={player:0,rival:0};matchOver=false;gameTime=0;pointPause=0;remoteMove={x:0,z:0,hit:false};$('you-score').textContent='0';$('rival-score').textContent='0';$('match-status').textContent='FIRST TO 5';
    beginServe(true);music.beep(660,.1,'triangle');
    if(onlineRole==='host'&&connection&&connected)connection.send({type:'start',map:selectedMap.id});
  }
  $('start-match').addEventListener('click',()=>startMatch());
  $('leave-match').addEventListener('click',()=>{if(onlineRole!=='solo')disconnectOnline();setScreen('lobby');});
  function updateScore(){
    const own=onlineRole==='guest'?score.rival:score.player,other=onlineRole==='guest'?score.player:score.rival;
    $('you-score').textContent=own;$('rival-score').textContent=other;
  }
  function finishMatch(){
    if(matchOver)return;matchOver=true;const localWon=onlineRole==='guest'?score.rival>score.player:score.player>score.rival;
    const earned=localWon?75:35;coins+=earned;played++;if(localWon){wins++;streak++;}else streak=0;persist();
    $('result-kicker').textContent=localWon?'MATCH WON':'MATCH COMPLETE';$('result-title').innerHTML=localWon?'COURT<br/><em>OWNED.</em>':'NICE<br/><em>RALLY.</em>';$('result-copy').textContent=localWon?'That was all you. Come back for another.':'Every point makes you better. Run it back!';$('reward-amount').textContent='+'+earned;
    $('result-modal').classList.remove('hidden');state='result';music.beep(localWon?850:480,.3,'triangle');
    if(onlineRole==='host'&&connection)connection.send({type:'finish',won:localWon,earned});
  }
  $('continue-btn').addEventListener('click',()=>{ $('result-modal').classList.add('hidden');if(onlineRole!=='solo')disconnectOnline();setScreen('lobby');});
  function point(who){
    if(pointPause>0||matchOver)return;score[who]++;updateScore();pointPause=1.35;ball.vx=0;ball.vy=0;ball.vz=0;ball.y=.2;if(onlineRole==='host')sendHostState();showGameToast(who==='player'?(onlineRole==='guest'?'POINT!':'NICE!'):(onlineRole==='guest'?'RIVAL SCORES':'POINT LOST'));music.beep(who==='player'?740:310,.2,'triangle');
    if(score[who]>=5&&Math.abs(score.player-score.rival)>=1){setTimeout(finishMatch,1000);return;}
    setTimeout(()=>{if(!matchOver&&state==='game')beginServe(who==='player');},1100);
  }
  function strike(side){
    const person=side==='player'?player:rival, opponent=side==='player'?rival:player;
    if(!person||!ball||pointPause>0||matchOver)return false;
    if((side==='player'&&rally==='serve-player')||(side==='rival'&&rally==='serve-rival')){
      person.swing=.34;ball.vx=clamp((opponent.x-person.x)*.31+(side==='player'?touchMove.x:remoteMove.x)*.45,-2,2);ball.vz=side==='player'?-6.65:6.65;ball.vy=5.1;ball.lastHitter=side;rally='live';$('game-hint').innerHTML='<span>W A S D</span> move · <span>SPACE</span> hit';music.beep(390,.065,'triangle');return true;
    }
    if(ball.lastHitter===side)return false;
    const dx=ball.x-person.x,dz=ball.z-person.z,reach=side==='player'?1.85:1.75;
    if(Math.abs(dx)>reach||Math.abs(dz)>2.0||ball.y>(person.jump||0)+3.0)return false;
    person.swing=.4;ball.x+=side==='player'?-.04:.04;ball.vx=clamp((opponent.x-person.x)*.33+(side==='player'?touchMove.x:remoteMove.x)*.55,-2.5,2.5);ball.vz=side==='player'?-6.7:6.7;ball.vy=5.15;ball.lastHitter=side;hitWindow=0;music.beep(420,.07,'triangle');return true;
  }
  function actionHit(){
    if(state!=='game')return;
    if(onlineRole==='guest'){remoteMove.hit=true;sendInput(true);return;}
    if(rally==='serve-player'){strike('player');return;}
    player.jumpV=4.2;player.jump=Math.max(player.jump,.05);player.swing=.35;hitWindow=.32;strike('player');
  }
  function axes(){
    let x=(keys.has('ArrowRight')||keys.has('d')?1:0)-(keys.has('ArrowLeft')||keys.has('a')?1:0)+touchMove.x;
    let z=(keys.has('ArrowDown')||keys.has('s')?1:0)-(keys.has('ArrowUp')||keys.has('w')?1:0)+touchMove.z;
    x=clamp(x,-1,1);z=clamp(z,-1,1);if(onlineRole==='guest')z=-z;return{x,z};
  }
  function updatePerson(person,move,dt,bounds){
    const speed=5.1;person.x=clamp(person.x+move.x*speed*dt,-4.0,4.0);person.z=clamp(person.z+move.z*speed*dt,bounds[0],bounds[1]);person.walking=Math.abs(move.x)+Math.abs(move.z)>.1;
    person.jump=Math.max(0,person.jump+(person.jumpV||0)*dt);if(person.jump>0){person.jumpV=(person.jumpV||0)-11.8*dt;if(person.jump===0)person.jumpV=0;}else{person.jump=0;person.jumpV=0;}person.swing=Math.max(0,(person.swing||0)-dt);
  }
  function updateGame(dt){
    if(state!=='game'||onlineRole==='guest'||matchOver)return;gameTime+=dt;
    if(pointPause>0)return;
    const move=axes();updatePerson(player,move,dt,[1.3,6.6]);
    if(onlineRole==='host'){
      updatePerson(rival,remoteMove,dt,[-6.6,-1.3]);
      if(remoteMove.hit){strike('rival');remoteMove.hit=false;}
    }else if(rally!=='serve-rival'&&ball.lastHitter==='player'){
      const target=ball.z<-.6?clamp(ball.x+ball.vx*.48,-3.7,3.7):rival.x;
      const dx=target-rival.x,dz=ball.z+3.7-rival.z;updatePerson(rival,{x:clamp(dx*.75,-1,1),z:clamp(dz*.7,-1,1)},dt,[-6.5,-1.45]);
      if(ball.z<-.1&&Math.abs(ball.x-rival.x)<1.9&&Math.abs(ball.z-rival.z)<2.05&&ball.y<3.4&&ball.lastHitter!=='rival')strike('rival');
    }else updatePerson(rival,{x:0,z:0},dt,[-6.5,-1.45]);
    if(rally==='serve-rival'){
      serveClock-=dt;if(serveClock<=0){rival.swing=.3;ball.vx=clamp((player.x-rival.x)*.25,-1.5,1.5);ball.vz=6.65;ball.vy=5.1;ball.lastHitter='rival';rally='live';}
    }
    if(rally==='serve-player'){
      if(hitWindow>0)hitWindow-=dt;
      if(hitWindow>0)strike('player');
    }else if(hitWindow>0){hitWindow-=dt;if(hitWindow>0)strike('player');}
    if(rally==='live'){
      ball.x+=ball.vx*dt;ball.z+=ball.vz*dt;ball.y+=ball.vy*dt;ball.vy-=8.8*dt;
      // A low ball at the tape clips the net instead of magically passing through.
      if(Math.abs(ball.z)<.12&&ball.y<2.1){ball.vz*=-.18;ball.vy=Math.min(ball.vy,-1.2);ball.z=Math.sign(ball.z||1)*.14;}
      if(ball.y<=.1){point(ball.z>0?'rival':'player');}
      if(Math.abs(ball.x)>5.5||Math.abs(ball.z)>8.4)point(ball.z>0?'rival':'player');
    }
    if(onlineRole==='host'&&connection&&connected&&performance.now()-lastPacket>55){lastPacket=performance.now();try{connection.send({type:'state',map:selectedMap.id,player:{x:player.x,z:player.z,jump:player.jump,swing:player.swing,walking:player.walking},rival:{x:rival.x,z:rival.z,jump:rival.jump,swing:rival.swing,walking:rival.walking},ball:{...ball},score:{...score},rally,serveClock,pointPause});}catch{}}
    if(onlineRole==='guest')sendInput(false);
  }
  let inputHit=false,lastInput=0;
  function sendInput(hit){if(onlineRole!=='guest'||!connection||!connected)return;const now=performance.now();if(!hit&&now-lastInput<55)return;lastInput=now;const a=axes();try{connection.send({type:'input',x:a.x,z:a.z,hit:hit||inputHit});}catch{}inputHit=false;}
  window.addEventListener('keydown',e=>{
    const k=e.key.toLowerCase();if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();
    if(k===' '&&!e.repeat){actionHit();return;}keys.add(k);
  });
  window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur',()=>{keys.clear();touchMove={x:0,z:0};});
  document.querySelectorAll('[data-move]').forEach(btn=>{
    const move=btn.dataset.move,vector={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}[move];
    btn.addEventListener('pointerdown',e=>{e.preventDefault();btn.setPointerCapture(e.pointerId);touchMove={x:vector[0],z:vector[1]};});
    ['pointerup','pointercancel','lostpointercapture'].forEach(type=>btn.addEventListener(type,()=>{touchMove={x:0,z:0};}));
  });
  $('touch-hit').addEventListener('pointerdown',e=>{e.preventDefault();actionHit();});

  function setOnlineNote(message){$('connection-note').textContent=message;}
  function disconnectOnline(){
    connected=false;guestSnapshot=null;
    try{connection?.close();}catch{}
    try{peer?.destroy();}catch{}
    connection=null;peer=null;onlineRole='solo';remoteMove={x:0,z:0,hit:false};
    $('room-code').classList.add('hidden');$('room-status').textContent='Waiting for a player…';
  }
  function roomCode(){return 'VV-'+Math.random().toString(36).slice(2,8).toUpperCase();}
  function connectPeerConnection(conn,role){
    connection=conn;onlineRole=role;
    conn.on('open',()=>{
      connected=true;setOnlineNote('Connected · starting your match…');
      if(role==='host'){
        $('room-status').textContent='Player connected · starting match';
        startMatch(true);
      }else conn.send({type:'hello'});
    });
    conn.on('data',data=>{
      if(!data||typeof data!=='object')return;
      if(role==='host'&&data.type==='input'){
        remoteMove={x:clamp(Number(data.x)||0,-1,1),z:clamp(Number(data.z)||0,-1,1),hit:!!data.hit};
      }else if(role==='guest'&&data.type==='start'){
        const map=maps.find(item=>item.id===data.map);if(map){selectedMap=map;updateMapCards();}
        startMatch(true);
      }else if(role==='guest'&&data.type==='state'){
        guestSnapshot=data;
        score=data.score||score;updateScore();
        if(data.map&&selectedMap.id!==data.map){const map=maps.find(item=>item.id===data.map);if(map){selectedMap=map;updateMapCards();$('active-map-label').textContent=map.name.toUpperCase();}}
      }else if(role==='guest'&&data.type==='finish'){
        score=data.score||score;updateScore();finishMatch();
      }else if(role==='host'&&data.type==='hello'){
        $('room-status').textContent='Opponent ready · get set!';
      }
    });
    conn.on('close',()=>{
      connected=false;connection=null;
      if(state==='game'){showToast('Opponent disconnected');setScreen('lobby');}
    });
    conn.on('error',()=>{setOnlineNote('Connection interrupted · try creating a new room');});
  }
  function peerError(error){
    const message=error?.type==='peer-unavailable'?'Room not found. Check the code and try again.':'Could not connect. Please try again.';
    setOnlineNote(message);$('room-status').textContent=message;showToast(message);
    try{peer?.destroy();}catch{}peer=null;
  }
  $('host-online').addEventListener('click',()=>{
    disconnectOnline();
    if(typeof window.Peer!=='function'){setOnlineNote('Online service unavailable. Solo play is ready.');showToast('Online service unavailable');return;}
    const id=roomCode();onlineRole='host';$('room-id').textContent=id;$('room-code').classList.remove('hidden');$('room-status').textContent='Opening your court…';setOnlineNote('Opening a secure peer-to-peer room…');
    try{
      peer=new window.Peer(id);
      peer.on('open',()=>{$('room-status').textContent='Waiting for a player…';setOnlineNote('Share your room code with a friend.');});
      peer.on('connection',conn=>{if(connection){conn.close();return;}connectPeerConnection(conn,'host');});
      peer.on('error',peerError);
    }catch{peerError({});}
  });
  $('join-online').addEventListener('click',()=>{
    const id=$('join-code').value.trim().toUpperCase();if(!id){setOnlineNote('Enter your friend’s room code first.');return;}
    disconnectOnline();
    if(typeof window.Peer!=='function'){setOnlineNote('Online service unavailable. Solo play is ready.');showToast('Online service unavailable');return;}
    onlineRole='guest';setOnlineNote('Connecting to '+id+'…');
    try{
      peer=new window.Peer();
      peer.on('open',()=>{try{const conn=peer.connect(id,{reliable:true});connectPeerConnection(conn,'guest');}catch{peerError({});}});
      peer.on('error',peerError);
    }catch{peerError({});}
  });
  $('copy-room').addEventListener('click',async()=>{
    const id=$('room-id').textContent;
    try{await navigator.clipboard.writeText(id);$('copy-room').textContent='COPIED';setTimeout(()=>$('copy-room').textContent='COPY',1400);}
    catch{$('room-status').textContent='Room code: '+id+' · copy it manually';}
  });
  $('join-code').addEventListener('keydown',e=>{if(e.key==='Enter')$('join-online').click();});
  $('download-btn').addEventListener('click',async()=>{
    const button=$('download-btn'),old=button.textContent;button.textContent='↓ PREPARING…';
    try{
      const [htmlResponse,cssResponse,jsResponse]=await Promise.all([fetch('index.html'),fetch('styles.css'),fetch('game.js')]);
      if(!htmlResponse.ok||!cssResponse.ok||!jsResponse.ok)throw new Error('Download unavailable');
      let html=await htmlResponse.text();const [css,js]=await Promise.all([cssResponse.text(),jsResponse.text()]);
      html=html.replace('<link rel="stylesheet" href="styles.css" />',`<style>\n${css}\n</style>`)
        .replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js" defer></script>','')
        .replace('<script src="game.js" defer></script>',`<script>\n${js.replace(/<\/script/gi,'<\\/script')}\n</script>`);
      const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));const link=document.createElement('a');link.href=url;link.download='volleyverse.html';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('Game downloaded · open volleyverse.html to play');
    }catch{showToast('Use the project folder download from your browser to save the game.');}
    button.textContent=old;
  });

  document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();touchMove={x:0,z:0};}});
  updateScore();
})();
