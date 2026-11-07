const $ = s => document.querySelector(s);
let me = {authenticated:false,user:null,oauthConfigured:false};
let lastStatus = null;

function esc(v){return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function showToast(text){const t=$('#toast');t.textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600);}
function goLogin(){window.location.href='/auth/discord';}

document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#'+b.dataset.page).classList.add('active');});
$('#loginBtn').onclick=goLogin; $('#emptyLogin').onclick=goLogin; $('#accountAction').onclick=()=>me.authenticated?$('#logoutBtn').click():goLogin;
$('#logoutBtn').onclick=async()=>{await fetch('/auth/logout',{method:'POST'});location.href='/';};
$('#refreshLogs').onclick=refresh;
$('#stopBtn').onclick=async()=>{const r=await fetch('/api/session/stop',{method:'POST'});const j=await r.json();if(!r.ok) showToast(j.error||'Unable to stop session'); else {showToast('Session stop requested');await refresh();}};

function statusText(s){return s==='Online'||s==='Active'||s==='Ready'||s==='Running'||s==='Connected'||s==='Loaded'?'good':s==='Degraded'||s==='Error'?'bad':'neutral';}
function renderAccount(){
  $('#loginBtn').classList.toggle('hidden',me.authenticated); $('#logoutBtn').classList.toggle('hidden',!me.authenticated); $('#accountInfo').classList.toggle('hidden',!me.authenticated);
  if(me.authenticated){
    const u=me.user; $('#accountName').textContent=u.global_name||u.username; $('#avatar').src=u.avatar?`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`:'https://cdn.discordapp.com/embed/avatars/0.png';
    $('#accountCardTitle').textContent='Discord connected'; $('#accountCardText').textContent='Signed in as '+(u.global_name||u.username)+'.'; $('#accountAction').textContent='Log out'; $('#emptyText').textContent='You are connected. Your session state will appear here when the bot starts one.';
  } else { $('#accountCardTitle').textContent='Not connected'; $('#accountCardText').textContent=me.oauthConfigured?'Connect Discord to unlock your account view.':'Discord OAuth is not configured on this deployment.'; $('#accountAction').textContent=me.oauthConfigured?'Connect Discord':'OAuth not configured'; $('#emptyText').textContent='Connect your Discord account to see whether you have an active EAM session.'; }
}
function renderStatus(s){
  lastStatus=s; const active=Boolean(s.sessionActive); const bot=s.bot;
  $('#topStatus').textContent=bot==='Online'?'EAM is online':bot==='Starting'?'Starting EAM':'EAM '+bot.toLowerCase(); $('#heroBot').textContent=bot;
  $('#sideStatus').textContent=bot; $('#botStatus').textContent=bot; $('#dmStatus').textContent=s.dmPanel; $('#readerStatus').textContent=s.reader; $('#mathsStatus').textContent=s.maths; $('#dbStatus').textContent=s.database; $('#keysStatus').textContent=s.apiKeys;
  $('#topDot').className='dot '+statusText(bot); $('#heroBot').previousElementSibling.className='dot '+statusText(bot);
  ['botStatus','dmStatus','readerStatus','mathsStatus','dbStatus','keysStatus'].forEach(id=>{$('#'+id).className=statusText($('#'+id).textContent);});
  $('#sessionPanel').classList.toggle('hidden',!active); $('#sessionEmpty').classList.toggle('hidden',active);
  $('#readerBadge').textContent=active?'RUNNING':'IDLE'; $('#readerBadge').className='badge '+(active?'good':'neutral');
  if(active){
    $('#readerTitle').textContent=s.activeUser?`${s.activeUser}'s active session`:'Active EAM session'; $('#readerSubtitle').textContent=s.reader==='Running'?'Reader is currently running.':'A session is active.';
    $('#progressFill').style.width=Math.max(0,Math.min(100,Number(s.progress)||0))+'%'; $('#progressPct').textContent=Math.round(Number(s.progress)||0)+'%'; $('#srpText').textContent=`${s.srp||0} / ${s.target||0} SRP`; $('#elapsed').textContent=s.elapsed||'0s'; $('#questions').textContent=s.questions||0; $('#correct').textContent=s.correct||0; $('#accuracy').textContent=(s.accuracy||0)+'%'; $('#speed').textContent=s.speed||0;
    const own=me.authenticated && s.activeUser && me.user && (s.activeUser===me.user.username || s.activeUser===me.user.global_name); $('#stopBtn').disabled=!own; $('#stopBtn').textContent=own?'Stop my session':'Session belongs to another user';
  } else {
    $('#readerTitle').textContent='No active Reader session'; $('#readerSubtitle').textContent='Start a Reader session from Discord.'; $('#emptyTitle').textContent=me.authenticated?'Nothing is running':'Connect Discord first'; $('#emptyLogin').classList.toggle('hidden',me.authenticated); $('#stopBtn').disabled=true;
  }
  $('#readerPageState').textContent=s.reader; $('#readerPageText').textContent=active?`Active session: ${s.activeUser||'Discord user'}`:'No Reader session is currently running.'; $('#mathsPageState').textContent=s.maths;
  $('#discordLink').href=s.discordInvite||'#';
}
function renderLogs(items){const html=items.map(x=>`<div class="log-line"><span>[${esc(x.time)}]</span><b class="${esc(x.level)}">${esc(x.level)}</b><span>${esc(x.message)}</span></div>`).join('')||'<div class="log-empty">No events yet.</div>';$('#logBox').innerHTML=html;$('#allLogs').innerHTML=html;}
async function refresh(){try{const [m,s,l]=await Promise.all([fetch('/api/me',{cache:'no-store'}).then(r=>r.json()),fetch('/api/status',{cache:'no-store'}).then(r=>r.json()),fetch('/api/logs',{cache:'no-store'}).then(r=>r.json())]);me=m;renderAccount();renderStatus(s);renderLogs(l.logs);}catch(e){$('#topStatus').textContent='Website cannot reach EAM';$('#sideStatus').textContent='Offline';}}

const params=new URLSearchParams(location.search);if(params.get('login')==='failed')showToast('Discord login failed. Please try again.');
setInterval(()=>$('#autoRefresh')?.checked&&refresh(),5000);refresh();
