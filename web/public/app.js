const $ = s => document.querySelector(s);
let lastStatus = null;

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showToast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Nav ───────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav').forEach(b => b.onclick = () => {
  document.querySelectorAll('.nav').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $('#' + b.dataset.page).classList.add('active');
});

$('#refreshLogs').onclick = refresh;

function statusClass(s) {
  const good = new Set(['Online', 'Active', 'Ready', 'Running', 'Connected', 'Loaded']);
  const bad  = new Set(['Degraded', 'Error', 'Offline']);
  return good.has(s) ? 'good' : bad.has(s) ? 'bad' : '';
}

function renderStatus(s) {
  lastStatus = s;
  const active = Boolean(s.sessionActive);
  const bot    = s.bot;

  $('#topStatus').textContent  = bot === 'Online' ? 'EAM is online' : bot === 'Starting' ? 'Starting EAM' : 'EAM ' + bot.toLowerCase();
  $('#sideStatus').textContent = bot;
  const botCls = statusClass(bot);
  $('#topDot').className = 'dot ' + botCls;
  $('#sidebarDot').className = 'dot ' + botCls;

  $('#heroBot').textContent     = bot;
  $('#heroDot').className       = 'dot ' + botCls;
  $('#heroReader').textContent  = s.reader  || 'Idle';
  $('#heroMaths').textContent   = s.maths   || 'Idle';
  $('#heroScience').textContent = s.science || 'Idle';
  $('#heroSeneca').textContent  = s.seneca  || 'Idle';
  ['heroReader', 'heroMaths', 'heroScience', 'heroSeneca'].forEach(id => {
    $('#' + id).className = statusClass($('#' + id).textContent);
  });

  $('#botStatus').textContent    = bot;
  $('#dmStatus').textContent     = s.dmPanel;
  $('#readerStatus').textContent = s.reader;
  $('#mathsStatus').textContent  = s.maths;
  $('#dbStatus').textContent     = s.database;
  $('#keysStatus').textContent   = s.apiKeys;
  ['botStatus','dmStatus','readerStatus','mathsStatus','dbStatus','keysStatus'].forEach(id => {
    $('#' + id).className = statusClass($('#' + id).textContent);
  });

  if ($('#pf-maths'))   { $('#pf-maths').textContent   = s.maths   || 'Idle'; $('#pf-maths').className   = statusClass(s.maths   || 'Idle'); }
  if ($('#pf-reader'))  { $('#pf-reader').textContent  = s.reader  || 'Idle'; $('#pf-reader').className  = statusClass(s.reader  || 'Idle'); }
  if ($('#pf-science')) { $('#pf-science').textContent = s.science || 'Idle'; $('#pf-science').className = statusClass(s.science || 'Idle'); }

  $('#sessionPanel').classList.toggle('hidden', !active);
  $('#sessionEmpty').classList.toggle('hidden', active);
  $('#readerBadge').textContent = active ? 'RUNNING' : 'IDLE';
  $('#readerBadge').className   = 'badge ' + (active ? 'good' : 'neutral');

  if (active) {
    $('#readerTitle').textContent    = s.activeUser ? `${s.activeUser}'s session` : 'Active EAM session';
    $('#readerSubtitle').textContent = s.reader === 'Running' ? 'Reader is currently running.' : 'A session is active.';
    const pct = Math.max(0, Math.min(100, Number(s.progress) || 0));
    $('#progressFill').style.width = pct + '%';
    $('#progressPct').textContent  = Math.round(pct) + '%';
    $('#srpText').textContent      = `${s.srp || 0} / ${s.target || 0} SRP`;
    $('#elapsed').textContent      = s.elapsed || '0s';
    $('#questions').textContent    = s.questions || 0;
    $('#correct').textContent      = s.correct   || 0;
    $('#accuracy').textContent     = (s.accuracy || 0) + '%';
    $('#speed').textContent        = s.speed     || 0;

    $('#progressFill2').style.width = pct + '%';
    $('#progressPct2').textContent  = Math.round(pct) + '%';
    $('#srpText2').textContent      = `${s.srp || 0} / ${s.target || 0} SRP`;
    $('#elapsed2').textContent      = s.elapsed || '0s';
    $('#questions2').textContent    = s.questions || 0;
    $('#correct2').textContent      = s.correct   || 0;
    $('#accuracy2').textContent     = (s.accuracy || 0) + '%';
    $('#speed2').textContent        = s.speed     || 0;
    $('#sessionPanel2').classList.remove('hidden');
    $('#sessionBadge2').textContent = 'RUNNING';
    $('#sessionBadge2').className   = 'badge good';
  } else {
    $('#readerTitle').textContent    = 'No active session';
    $('#readerSubtitle').textContent = 'Start a session from Discord to see it here.';
    $('#emptyTitle').textContent     = 'Nothing running';
    $('#sessionPanel2').classList.add('hidden');
    $('#sessionBadge2').textContent  = 'IDLE';
    $('#sessionBadge2').className    = 'badge neutral';
  }

  $('#readerPageState').textContent = s.reader || 'Idle';
  $('#readerPageText').textContent  = active ? `Active session: ${s.activeUser || 'Discord user'}` : 'No session is currently running.';
  $('#mathsPageState').textContent  = s.maths || 'Idle';
  $('#mathsDot2').className         = 'dot ' + statusClass(s.maths || '');

  $('#discordLink').href    = s.discordInvite || '#';
  $('#heroDiscordBtn').href = s.discordInvite || '#';
}

function renderLogs(items) {
  const html = items.map(x =>
    `<div class="log-line"><span>[${esc(x.time)}]</span><b class="${esc(x.level)}">${esc(x.level)}</b><span>${esc(x.message)}</span></div>`
  ).join('') || '<div class="log-empty">No events yet.</div>';
  $('#logBox').innerHTML  = html;
  $('#allLogs').innerHTML = html;
}

async function refresh() {
  try {
    const [s, l] = await Promise.all([
      fetch('/api/status', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/logs',   { cache: 'no-store' }).then(r => r.json())
    ]);
    renderStatus(s);
    renderLogs(l.logs);
  } catch (e) {
    $('#topStatus').textContent  = 'Cannot reach EAM';
    $('#sideStatus').textContent = 'Offline';
  }
}

setInterval(() => $('#autoRefresh')?.checked && refresh(), 5000);
refresh();
