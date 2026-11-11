const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const crypto = require('node:crypto');

// Bookmarklet flow: shared pending sessions + cookie receiver
// Loaded lazily so the web server starts even before the bot is fully ready.
function getBookmarkletFlow() {
    try { return require('../handlers/readerBookmarkletFlow.js'); }
    catch { return null; }
}

const publicDir = path.join(__dirname, 'public');
const logs = [];
const sessions = new Map();
const oauthStates = new Map();
const activeSessions = new Map();
// In-memory store for per-user login progress PNGs served at /progress/:key.png
// Key is a short session key (userId + timestamp). TTL handled by clearProgressImage.
const progressImages = new Map();
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
    // -----------------------------------------------------------------------
    // Bookmarklet routes
    // GET /bm/:token serves a classic script. The bookmarklet injects it as a
    // page script (rather than dynamic-importing a module from this host), so
    // the Sparx /token fetch uses the Sparx Reader page's origin and cookies.
    // POST /api/bm/:token receives the short-lived JWT handoff.
    const bmMatch = parsed.pathname.match(/^\/bm\/([a-f0-9]{10})$/);
    if (req.method === 'GET' && bmMatch) {
        const token = bmMatch[1];
        const origin = `${(req.headers['x-forwarded-proto'] || 'https').split(',')[0]}://${req.headers.host}`;
        const botUrl = JSON.stringify(origin + '/api/bm/' + token);
        const script = [
            `(() => {`,
            `  const botUrl = ${botUrl};`,
            `  const show = (ok, detail) => {`,
            `    const el = Object.assign(document.createElement('div'), {`,
            `      textContent: ok ? '✓ Connected to Lumen' : '✗ Connection failed' + (detail ? ': ' + detail : '')`,
            `    });`,
            `    Object.assign(el.style, { position:'fixed', top:'20px', right:'20px', padding:'14px 24px',`,
            `      background:ok ? '#23a55a' : '#da373c', color:'#fff', borderRadius:'8px',`,
            `      fontFamily:'sans-serif', fontSize:'15px', fontWeight:'600', zIndex:'2147483647' });`,
            `    document.body.appendChild(el); setTimeout(() => el.remove(), 7000);`,
            `  };`,
            `  (async () => {`,
            `    try {`,
            `      // This is a classic page script, so the browser makes the request`,
            `      // in the Sparx page context and can attach Sparx session cookies.`,
            `      const tokenResponse = await fetch('https://api.sparx-learning.com/token', {`,
            `        method:'GET', credentials:'include',`,
            `        headers:{ accept:'*/*' }`,
            `      });`,
            `      if (!tokenResponse.ok) throw new Error('Sparx token endpoint returned HTTP ' + tokenResponse.status);`,
            `      const authToken = (await tokenResponse.text()).trim();`,
            `      if (!authToken || authToken.startsWith('{') || authToken.split('.').length !== 3)`,
            `        throw new Error('No JWT returned; sign in to Sparx Reader and reload the page');`,
            `      const handoff = await fetch(botUrl, {`,
            `        method:'POST', credentials:'omit', mode:'cors',`,
            `        headers:{ 'Content-Type':'application/json' },`,
            `        body:JSON.stringify({ authToken })`,
            `      });`,
            `      if (!handoff.ok) throw new Error('Lumen handoff failed (HTTP ' + handoff.status + ')');`,
            `      show(true);`,
            `    } catch (error) { show(false, error && error.message ? error.message : 'browser blocked the request'); }`,
            `  })();`,
            `})();`
        ].join('\n');

        res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        return res.end(script);
    }

    const bmApiMatch = parsed.pathname.match(/^\/api\/bm\/([a-f0-9]{10})$/);
    if (req.method === 'OPTIONS' && bmApiMatch) {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
        });
        return res.end();
    }
    if (req.method === 'POST' && bmApiMatch) {
        const token = bmApiMatch[1];
        let body;
        try { body = await readBody(req); } catch {
            return send(res, 400, { error: 'invalid json' }, 'application/json', {
                'Access-Control-Allow-Origin': '*'
            });
        }

        const authToken    = typeof body?.authToken    === 'string' ? body.authToken.trim()    : '';
        const cookieString = typeof body?.cookieString === 'string' ? body.cookieString.trim() : '';
        const legacyCookie = typeof body?.cookie       === 'string' ? body.cookie.trim()       : '';

        const jwt = authToken;
        const cookies = cookieString || legacyCookie;

        if (!jwt && !cookies) {
            return send(res, 400, { error: 'no authToken or cookie' }, 'application/json', {
                'Access-Control-Allow-Origin': '*'
            });
        }

        const flow = getBookmarkletFlow();
        if (!flow) {
            return send(res, 503, { error: 'bot not ready' }, 'application/json', {
                'Access-Control-Allow-Origin': '*'
            });
        }

        const result = await flow.onCookieReceived(token, jwt, cookies).catch(e => ({ ok: false, error: e.message }));
        return send(res, result.ok ? 200 : 404, result, 'application/json', {
            'Access-Control-Allow-Origin': '*'
        });
    }

    // Progress bar PNG endpoint: /progress/:key.png?t=timestamp
    // Serves a dynamically generated PNG stored by setProgressImage().
    // Discord MediaGallery references this URL to display the bar inline in ephemeral messages.
    const progressMatch = parsed.pathname.match(/^\/progress\/([a-zA-Z0-9_-]+)\.png$/);
    if (req.method === 'GET' && progressMatch) {
        const key = progressMatch[1];
        const pngBuf = progressImages.get(key);
        if (!pngBuf) return send(res, 404, 'Not found', 'text/plain');
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': pngBuf.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache'
        });
        return res.end(pngBuf);
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

function setProgressImage(key, pngBuffer) {
    progressImages.set(key, pngBuffer);
    // Auto-clean after 5 minutes to prevent memory leak
    setTimeout(() => progressImages.delete(key), 5 * 60 * 1000);
}
function clearProgressImage(key) {
    progressImages.delete(key);
}

module.exports = { start, pushLog, setStatus, registerSession, unregisterSession, stopSession, setProgressImage, clearProgressImage };
