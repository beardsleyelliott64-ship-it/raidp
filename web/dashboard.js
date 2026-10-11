const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const crypto = require('node:crypto');

const publicDir = path.join(__dirname, 'public');
const logs = [];
const sessions = new Map();
const oauthStates = new Map();
const activeSessions = new Map();
const MAX_LOGS = 250;
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;
let server;
const state = {
  bot: 'Starting', dmPanel: 'Idle', reader: 'Idle', maths: 'Idle',
  database: 'Starting', apiKeys: 'Loaded', sessionActive: false,
  progress: 0, srp: 0, target: 0, questions: 0, correct: 0,
  accuracy: 0, elapsed: '0s', speed: 0, activeUser: null,
  lastUpdate: new Date().toISOString()
};

function env(name, fallback='') { return process.env[name] || fallback; }
function oauthConfigured() {
  return Boolean(env('DISCORD_CLIENT_ID', env('CLIENT_ID')) && env('DISCORD_CLIENT_SECRET', env('CLIENT_SECRET')));
}
function baseUrl(req) {
  if (env('DISCORD_REDIRECT_URI')) return env('DISCORD_REDIRECT_URI').replace(/\/discord\/callback$/, '');
  const host = req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  return `${proto}://${host}`;
}
function redirectUri(req) {
  return env('DISCORD_REDIRECT_URI', `${baseUrl(req)}/auth/discord/callback`);
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function sessionFor(req) {
  const id = parseCookies(req).eam_session;
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || session.expires < Date.now()) { sessions.delete(id); return null; }
  return session;
}
function pushLog(level, message) {
  const allowed = new Set(['INFO','SUCCESS','WARN','ERROR']);
  level = allowed.has(String(level).toUpperCase()) ? String(level).toUpperCase() : 'INFO';
  message = String(message || '').slice(0, 700);
  if (!message) return;
  logs.unshift({ time: new Date().toLocaleTimeString('en-GB', {hour12:false}), level, message });
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  if (level === 'ERROR') state.bot = 'Degraded';
  state.lastUpdate = new Date().toISOString();
}
function setStatus(patch) { Object.assign(state, patch || {}, {lastUpdate:new Date().toISOString()}); }
function registerSession(userId, info) { activeSessions.set(String(userId), { ...info, userId:String(userId), startedAt:Date.now() }); setStatus({sessionActive:true, activeSessions:activeSessions.size, activeUser:info?.username || null}); }
function unregisterSession(userId) { activeSessions.delete(String(userId)); const latest=[...activeSessions.values()].sort((a,b)=>b.startedAt-a.startedAt)[0]; setStatus({sessionActive:activeSessions.size>0, activeSessions:activeSessions.size, activeUser:latest?.username || null}); }
async function stopSession(userId) { const session=activeSessions.get(String(userId)); if (!session?.stop) return false; await session.stop(); return true; }
function send(res, status, body, type='application/json', extra={}) {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control':'no-store', ...extra});
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function redirect(res, location, cookies=[]) {
  res.writeHead(302, {'Location': location, 'Cache-Control':'no-store', 'Set-Cookie': cookies});
  res.end();
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data='';
    req.on('data', c => { data += c; if (data.length > 256*1024) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch(e){ reject(e); } });
    req.on('error', reject);
  });
}
function safeFile(p) {
  const target = path.normalize(path.join(publicDir, p));
  return target.startsWith(publicDir) ? target : null;
}
async function exchangeCode(code, req) {
  const params = new URLSearchParams({
    client_id: env('DISCORD_CLIENT_ID', env('CLIENT_ID')),
    client_secret: env('DISCORD_CLIENT_SECRET', env('CLIENT_SECRET')),
    grant_type: 'authorization_code', code,
    redirect_uri: redirectUri(req)
  });
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:params});
  if (!tokenRes.ok) throw new Error(`Discord token exchange failed (${tokenRes.status})`);
  return tokenRes.json();
}
async function discordUser(accessToken) {
  const r = await fetch('https://discord.com/api/users/@me', {headers:{Authorization:`Bearer ${accessToken}`}});
  if (!r.ok) throw new Error(`Discord user lookup failed (${r.status})`);
  return r.json();
}

function start() {
  if (server) return server;
  const port = Number(process.env.PORT || process.env.WEB_PORT || 3000);
  const host = process.env.WEB_HOST || '0.0.0.0';
  server = http.createServer(async (req,res) => {
    const parsed = url.parse(req.url, true);

    if (req.method === 'GET' && parsed.pathname === '/auth/discord') {
      if (!oauthConfigured()) return send(res, 503, {error:'Discord OAuth is not configured', setup:'Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET'});
      const stateId = crypto.randomBytes(24).toString('hex');
      oauthStates.set(stateId, {created:Date.now()});
      const params = new URLSearchParams({client_id:env('DISCORD_CLIENT_ID', env('CLIENT_ID')), response_type:'code', redirect_uri:redirectUri(req), scope:'identify'});
      return redirect(res, `https://discord.com/oauth2/authorize?${params.toString()}`);
    }

    if (req.method === 'GET' && parsed.pathname === '/auth/discord/callback') {
      try {
        const {code, state:stateId} = parsed.query;
        const oauthState = oauthStates.get(stateId);
        oauthStates.delete(stateId);
        if (!code || !oauthState || Date.now() - oauthState.created > 10*60*1000) return redirect(res, '/?login=failed');
        const token = await exchangeCode(code, req);
        const user = await discordUser(token.access_token);
        const sessionId = crypto.randomBytes(32).toString('hex');
        sessions.set(sessionId, {expires:Date.now()+SESSION_TTL, user:{id:user.id, username:user.username, global_name:user.global_name, avatar:user.avatar}});
        return redirect(res, '/', [`eam_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL/1000}`]);
      } catch (e) {
        pushLog('ERROR', `[WEB AUTH] ${e.message}`);
        return redirect(res, '/?login=failed');
      }
    }

    if (req.method === 'POST' && parsed.pathname === '/auth/logout') {
      const sid = parseCookies(req).eam_session;
      if (sid) sessions.delete(sid);
      return redirect(res, '/', ['eam_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0']);
    }

    if (req.method === 'POST' && parsed.pathname === '/api/session/stop') {
      const session = sessionFor(req);
      if (!session) return send(res,401,{error:'Connect your Discord account first'});
      try {
        const stopped = await stopSession(session.user.id);
        return send(res, stopped ? 200 : 404, {ok:stopped, error:stopped ? undefined : 'No active session for this Discord account'});
      } catch (e) { pushLog('ERROR', `[WEB SESSION] Stop failed: ${e.message}`); return send(res,500,{error:'Unable to stop the session'}); }
    }

    if (req.method === 'GET' && parsed.pathname === '/api/me') {
      const session = sessionFor(req);
      return send(res,200,{authenticated:Boolean(session), user:session?.user || null, oauthConfigured:oauthConfigured()});
    }
    if (req.method === 'GET' && parsed.pathname === '/api/health') return send(res,200,{ok:true});
    if (req.method === 'GET' && parsed.pathname === '/api/status') {
      return send(res,200,{...state, discordInvite:env('DISCORD_INVITE_URL','https://discord.com/'), oauthConfigured:oauthConfigured()});
    }
    if (req.method === 'GET' && parsed.pathname === '/api/logs') return send(res,200,{logs});
    if (req.method === 'POST' && parsed.pathname === '/api/status') {
      try { setStatus(await readBody(req)); return send(res,200,{ok:true,status:state}); } catch(e){ return send(res,400,{error:'invalid json'}); }
    }
    if (req.method === 'POST' && parsed.pathname === '/api/logs') {
      try { const b=await readBody(req); pushLog(b.level,b.message); return send(res,200,{ok:true}); } catch(e){ return send(res,400,{error:'invalid json'}); }
    }
    if (req.method !== 'GET' || !parsed.pathname.startsWith('/api/')) {
      let p = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
      const file = safeFile(p);
      if (!file) return send(res,403,'Forbidden','text/plain');
      fs.readFile(file,(err,data)=>{
        if(err) return send(res,404,'Not found','text/plain');
        const ext=path.extname(file); const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8'};
        send(res,200,data,types[ext]||'application/octet-stream');
      });
      return;
    }
    send(res,404,{error:'not found'});
  });
  server.listen(port,host,()=>{ pushLog('SUCCESS',`EAM Web Dashboard listening on ${host}:${port}`); });
  return server;
}

module.exports = { start, pushLog, setStatus, registerSession, unregisterSession, stopSession };
