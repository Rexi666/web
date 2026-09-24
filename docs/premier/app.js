import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEAM_NAME, ENABLE_DISCORD_LOGIN } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------- constantes
const LEVELS = {
  great: { label: 'Genial', short: '★', cls: 'lv-great' },
  good: { label: 'Bien', short: '✓', cls: 'lv-good' },
  normal: { label: 'Normal', short: '•', cls: 'lv-normal' },
  bad: { label: 'Malo', short: '!', cls: 'lv-bad' },
  none: { label: 'No lo tiene', short: '✕', cls: 'lv-none' },
};
const UNRATED = { label: 'Sin valorar', short: '', cls: 'lv-unrated' };
const LEVEL_ORDER = ['great', 'good', 'normal', 'bad', 'none'];

const ROLES = { duelist: 'Duelistas', initiator: 'Iniciadores', controller: 'Controladores', sentinel: 'Centinelas' };
const ROLE_ONE = { duelist: 'Duelista', initiator: 'Iniciador', controller: 'Controlador', sentinel: 'Centinela' };
const ROLE_ORDER = ['duelist', 'initiator', 'controller', 'sentinel'];
const APP_ROLES = { viewer: 'Solo ver', player: 'Jugador', admin: 'Admin' };
const CAL_EVENT_LABELS = { season: 'Temporada', match_days: 'Días de partido', play_day: 'Día elegido' };
const COMP_STATUSES = {
  active: { label: 'Activas', one: 'Activa', icon: '🟢' },
  draft: { label: 'Borradores', one: 'Borrador', icon: '🔵' },
  discarded: { label: 'Descartadas', one: 'Descartada', icon: '🔴' },
};
const COMP_STATUS_ORDER = ['active', 'draft', 'discarded'];

// ---------------------------------------------------------------- estado
const S = {
  session: null, profile: null, loading: true,
  players: [], agents: [], maps: [], pool: new Map(), agentImages: new Map(), mapImages: new Map(),
  comps: [], slots: [], profiles: [], calendarEvents: [],
  attendancePolls: [], attendanceOptions: [], attendanceVotes: [],
  tab: readPref('tab') || 'pool',
  mapId: Number(readPref('map')) || null,
  draft: null, // composición en edición
  generator: null, // selección de agentes y propuestas generadas
  calendarMonth: readPref('calendar-month') || new Date().toISOString().slice(0, 7),
};

// ---------------------------------------------------------------- helpers
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = (p, a) => `${p}:${a}`;
const lvInfo = (lv) => LEVELS[lv] ?? UNRATED;
const byId = (list, id) => list.find((x) => x.id === id);

function readPref(k) { try { return localStorage.getItem('pp:' + k); } catch { return null; } }
function writePref(k, v) { try { localStorage.setItem('pp:' + k, v); } catch { /* sin storage */ } }

const role = () => (S.session ? S.profile?.role ?? 'viewer' : 'anon');
const isAdmin = () => role() === 'admin';
const myPlayer = () => S.players.find((p) => p.user_id && p.user_id === S.session?.user?.id);
const canEditPlayer = (pid) => isAdmin() || (role() === 'player' && myPlayer()?.id === pid);
const redirectUrl = () => new URL('.', window.location.href).href;
const slotsOf = (cid) => S.slots.filter((s) => s.composition_id === cid).sort((a, b) => a.slot - b.slot);

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 6000 : 2500);
}

function friendlyError(error) {
  const m = error?.message ?? String(error);
  if (/invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/email.*already registered|already been registered/i.test(m)) return 'Ese email ya tiene cuenta.';
  if (/row-level security|permission denied/i.test(m)) return 'No tienes permisos para hacer eso.';
  if (/duplicate key.*player_id/i.test(m)) return 'Ese jugador ya está en la composición.';
  if (/duplicate key.*agent_id/i.test(m)) return 'Ese agente ya está en la composición.';
  if (/duplicate key.*user_id/i.test(m)) return 'Esa cuenta ya está vinculada a otro jugador.';
  if (/duplicate key.*discord_id|players_discord_id_unique/i.test(m)) return 'Ese usuario de Discord ya está vinculado a otro jugador.';
  if (/duplicate key/i.test(m)) return 'Ya existe uno con ese nombre.';
  return m;
}

// ---------------------------------------------------------------- datos
async function loadProfile() {
  S.profile = null;
  if (!S.session) return;
  const { data } = await sb.from('profiles').select('*').eq('id', S.session.user.id).maybeSingle();
  S.profile = data;
}

async function loadAgentImages() {
  try {
    const res = await fetch('https://valorant-api.com/v1/agents?language=es-ES&isPlayableCharacter=true');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    S.agentImages = new Map(
      (json.data ?? [])
        .filter((a) => a.isPlayableCharacter && a.displayName && (a.displayIconSmall || a.displayIcon))
        .map((a) => [a.displayName.toLocaleLowerCase('es'), a.displayIconSmall || a.displayIcon])
    );
  } catch (error) {
    // La web sigue funcionando aunque el servicio externo de imágenes no responda.
    console.warn('No se pudieron cargar las imágenes de agentes:', error);
    S.agentImages = new Map();
  }
}

function agentLabel(agent) {
  const image = S.agentImages.get(agent.name.toLocaleLowerCase('es'));
  return `<span class="agent-ident">
    ${image ? `<img class="agent-icon" src="${esc(image)}" alt="" decoding="async" referrerpolicy="no-referrer" onerror="this.hidden=true">` : ''}
    <span>${esc(agent.name)}</span>
  </span>`;
}

async function loadMapImages() {
  try {
    const res = await fetch('https://valorant-api.com/v1/maps?language=es-ES');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    S.mapImages = new Map(
      (json.data ?? [])
        .filter((m) => m.displayName && (m.wideScreenSplash || m.splash))
        .map((m) => [
          m.displayName.toLocaleLowerCase('es'),
          m.wideScreenSplash || m.splash,
        ])
    );
  } catch (error) {
    console.warn('No se pudieron cargar las imágenes de mapas:', error);
    S.mapImages = new Map();
  }
}

async function loadAll() {
  const res = await Promise.all([
    sb.from('players').select('*').order('sort_order').order('name'),
    sb.from('agents').select('*').order('name'),
    sb.from('maps').select('*').order('name'),
    sb.from('player_agents').select('player_id,agent_id,level'),
    sb.from('compositions').select('*').order('is_main', { ascending: false }).order('created_at'),
    sb.from('composition_slots').select('*'),
    sb.from('calendar_events').select('*').order('start_date').order('created_at'),
    S.session ? sb.from('attendance_polls').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
    S.session ? sb.from('attendance_options').select('*').order('event_date').order('event_time') : Promise.resolve({ data: [] }),
    S.session ? sb.from('attendance_votes').select('*') : Promise.resolve({ data: [] }),
    isAdmin() ? sb.from('profiles').select('*').order('created_at') : Promise.resolve({ data: [] }),
  ]);
  const failed = res.find((r) => r.error);
  if (failed) toast('No se pudieron cargar los datos: ' + failed.error.message, 'err');

  const [pl, ag, mp, pa, co, cs, ce, ap, ao, av, pr] = res.map((r) => r.data ?? []);
  Object.assign(S, { players: pl, agents: ag, maps: mp, comps: co, slots: cs, calendarEvents: ce, attendancePolls: ap, attendanceOptions: ao, attendanceVotes: av, profiles: pr });
  S.pool = new Map(pa.map((r) => [key(r.player_id, r.agent_id), r.level]));

  if (!S.mapId || !byId(S.maps, S.mapId)) {
    S.mapId = (S.maps.find((m) => m.in_pool) ?? S.maps[0])?.id ?? null;
  }
}

async function refresh() { await loadAll(); render(); }

// ---------------------------------------------------------------- render
function render() {
  // Se reemplaza #main en cada actualización. Conservamos el scroll interno
  // de la tabla y el de la página para evitar saltos al recibir Realtime.
  const wrap = $('.table-wrap');
  const chips = $('.chips');
  const scrollLeft = wrap?.scrollLeft ?? 0;
  const chipsScrollLeft = chips?.scrollLeft ?? 0;
  const scrollTop = wrap?.scrollTop ?? 0;
  const pageScrollX = window.scrollX;
  const pageScrollY = window.scrollY;

  renderAuth();
  renderTabs();
  const main = $('#main');
  if (S.loading) { main.innerHTML = empty('Cargando…'); return; }
  if (S.tab === 'admin' && !isAdmin()) S.tab = 'pool';
  if (S.tab === 'account' && !S.session) S.tab = 'pool';

  main.innerHTML = S.tab === 'maps'
    ? viewMaps()
    : S.tab === 'calendar'
      ? viewCalendar()
      : S.tab === 'attendance'
        ? viewAttendance()
        : S.tab === 'account'
          ? viewAccount()
          : S.tab === 'admin'
            ? viewAdmin()
            : viewPool();

  const newWrap = $('.table-wrap');
  if (newWrap) {
    newWrap.scrollLeft = scrollLeft;
    newWrap.scrollTop = scrollTop;
  }
  const newChips = $('.chips');
  if (newChips) newChips.scrollLeft = chipsScrollLeft;
  window.scrollTo(pageScrollX, pageScrollY);
}
function renderAuth() {
  $('#brand').textContent = TEAM_NAME;
  const el = $('#auth');
  if (!S.session) {
    el.innerHTML = `<button class="btn" data-action="open-login">Iniciar sesión</button>`;
    return;
  }
  const name = S.profile?.display_name || S.session.user.email;
  el.innerHTML = `
    <span class="who"><span class="who-name">${esc(name)}</span>
      <span class="badge role-${role()}">${APP_ROLES[role()] ?? 'Solo ver'}</span></span>
    <button class="btn ghost" data-action="logout">Salir</button>`;
}

function renderTabs() {
  const tabs = [
    ['pool', 'Agent pool'],
    ['maps', 'Mapas'],
    ['calendar', 'Calendario'],
    ...(S.session ? [['attendance', 'Asistencia']] : []),
    ...(S.session ? [['account', 'Mi cuenta']] : []),
    ...(isAdmin() ? [['admin', 'Admin']] : []),
  ];
  $('#tabs').innerHTML = tabs.map(([id, label]) =>
    `<button class="tab ${S.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}">${label}</button>`).join('');
}

const empty = (msg) => `<div class="empty">${msg}</div>`;

function legend() {
  return `<div class="legend">${[...LEVEL_ORDER, null].map((lv) => {
    const i = lvInfo(lv);
    return `<span class="legend-item"><span class="lv sm ${i.cls}">${i.short}</span>${i.label}</span>`;
  }).join('')}</div>`;
}

function editHint() {
  if (!S.session) return 'Inicia sesión para editar.';
  if (isAdmin()) return 'Toca una casilla para cambiar el nivel de cualquier jugador.';
  if (role() === 'player') {
    return myPlayer()
      ? 'Toca una casilla de tu columna para cambiar tu nivel.'
      : 'Tu cuenta aún no está vinculada a ningún jugador. Pídeselo a un admin.';
  }
  return 'Tu cuenta solo puede ver. Pide permisos a un admin para editar.';
}

// ---------- vista: agent pool
function viewPool() {
  const players = S.players;
  if (!players.length) {
    return empty(isAdmin() ? 'Aún no hay jugadores. Añádelos en la pestaña Admin.' : 'Aún no hay jugadores.');
  }
  const agents = S.agents.filter((a) => a.active);
  const me = myPlayer()?.id;

  let body = '';
  for (const r of ROLE_ORDER) {
    const list = agents.filter((a) => a.role === r);
    if (!list.length) continue;
    body += `<tr class="role-row"><th colspan="${players.length + 1}">${ROLES[r]}</th></tr>`;
    for (const a of list) {
      body += `<tr><th class="agent-name" scope="row">${agentLabel(a)}</th>` + players.map((p) => {
        const lv = S.pool.get(key(p.id, a.id));
        const i = lvInfo(lv);
        const editable = canEditPlayer(p.id);
        const title = `${esc(p.name)} con ${esc(a.name)}: ${i.label}`;
        return `<td class="${p.id === me ? 'me' : ''}"><button class="lv ${i.cls}" title="${title}" aria-label="${title}"
          ${editable ? `data-action="pick-level" data-p="${p.id}" data-a="${a.id}"` : 'disabled'}>${i.short}</button></td>`;
      }).join('') + '</tr>';
    }
  }

  const totals = players.map((p) => {
    const great = agents.filter((a) => S.pool.get(key(p.id, a.id)) === 'great').length;
    const good = agents.filter((a) => S.pool.get(key(p.id, a.id)) === 'good').length;
    const normal = agents.filter((a) => S.pool.get(key(p.id, a.id)) === 'normal').length;
    return `<td class="total" title="${great} genial, ${good} bien, ${normal} normal">${great + good + normal}</td>`;
  }).join('');

  return `
    <section class="pool-view">
      <div class="view-head">
        <h1>Agent pool</h1>
        <p class="hint">${editHint()}</p>
        ${legend()}
      </div>
      <div class="table-wrap">
        <table class="pool">
          <thead><tr><th class="corner"></th>${players.map((p) =>
    `<th class="player-h ${p.id === me ? 'me' : ''}" scope="col"><span>${esc(p.name)}</span></th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
          <tfoot><tr><th class="agent-name" title="Agentes con nivel bien o genial">Jugables</th>${totals}</tr></tfoot>
        </table>
      </div>
    </section>`;
}

// ---------- vista: calendario
function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function calendarItems() {
  const items = [];
  for (const event of S.calendarEvents) {
    if (event.type === 'season') {
      let current = new Date(`${event.start_date}T12:00:00`);
      const end = new Date(`${event.end_date}T12:00:00`);
      while (current <= end) {
        items.push({ date: localDateKey(current), event, time: null });
        current.setDate(current.getDate() + 1);
      }
    } else if (event.type === 'match_days') {
      for (const occurrence of event.occurrences ?? []) {
        if (occurrence.date) items.push({ date: occurrence.date, event, time: occurrence.time || null });
      }
    } else if (event.start_date) {
      items.push({ date: event.start_date, event, time: event.event_time?.slice(0, 5) || null });
    }
  }
  return items;
}

function formatCalendarTime(time) {
  return time ? time.slice(0, 5) : '';
}

function viewCalendar() {
  const [year, month] = S.calendarMonth.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const leading = (first.getDay() + 6) % 7;
  const totalCells = Math.ceil((leading + last.getDate()) / 7) * 7;
  const items = calendarItems();
  const today = localDateKey(new Date());
  const monthTitle = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(first);

  const cells = Array.from({ length: totalCells }, (_, index) => {
    const day = index - leading + 1;
    if (day < 1 || day > last.getDate()) return '<div class="calendar-day outside"></div>';
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayItems = items.filter((item) => item.date === date);
    const events = dayItems.map(({ event, time }) => {
      const map = event.map_id ? byId(S.maps, event.map_id) : null;
      const label = event.type === 'season'
        ? event.title
        : `${time ? `${formatCalendarTime(time)} · ` : ''}${map?.name ? `${map.name} · ` : ''}${event.title}`;
      return `<button class="calendar-event ev-${event.type}" data-action="view-calendar-event" data-id="${event.id}" title="${esc(label)}">${esc(label)}</button>`;
    }).join('');
    return `<div class="calendar-day ${date === today ? 'today' : ''}">
      <div class="calendar-day-number">${day}</div>
      <div class="calendar-day-events">${events}</div>
    </div>`;
  }).join('');

  return `<section class="calendar-view">
    <div class="calendar-toolbar">
      <div>
        <h1>Calendario</h1>
        <div class="calendar-legend">
          <span><i class="legend-dot season"></i> Temporada</span>
          <span><i class="legend-dot match"></i> Días de partido</span>
          <span><i class="legend-dot play"></i> Día elegido</span>
        </div>
      </div>
      ${isAdmin() ? '<button class="btn primary" data-action="new-calendar-event">Nuevo evento</button>' : ''}
    </div>
    <div class="calendar-nav">
      <button class="btn sm" data-action="calendar-prev">‹</button>
      <h2>${esc(monthTitle)}</h2>
      <button class="btn sm" data-action="calendar-next">›</button>
    </div>
    <div class="calendar-scroll">
      <div class="calendar-grid calendar-weekdays">
        ${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => `<div>${d}</div>`).join('')}
      </div>
      <div class="calendar-grid calendar-days">${cells}</div>
    </div>
  </section>`;
}

function changeCalendarMonth(delta) {
  const [year, month] = S.calendarMonth.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  S.calendarMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  writePref('calendar-month', S.calendarMonth);
  render();
}

function calendarOccurrencesText(event) {
  return (event?.occurrences ?? []).map((o) => `${o.date}${o.time ? ` ${o.time.slice(0, 5)}` : ''}`).join('\n');
}

function openCalendarEditor(event = null) {
  if (!isAdmin()) return;
  $('#modal').classList.remove('generator-dialog');
  const type = event?.type ?? 'season';
  const mapOptions = `<option value="">Sin mapa</option>` + S.maps
    .filter((m) => m.in_pool)
    .map((m) => `<option value="${m.id}" ${m.id === event?.map_id ? 'selected' : ''}>${esc(m.name)}</option>`)
    .join('');
  $('#modal').innerHTML = `<form class="modal-body" data-form="save-calendar-event" data-id="${event?.id ?? ''}">
    <div class="modal-head"><h2>${event ? 'Editar evento' : 'Nuevo evento'}</h2>
      <button type="button" class="icon-btn" data-action="close-modal" aria-label="Cerrar">✕</button></div>
    <label class="field"><span>Tipo</span><select name="type" data-calendar-type>
      ${Object.entries(CAL_EVENT_LABELS).map(([value, label]) => `<option value="${value}" ${value === type ? 'selected' : ''}>${label}</option>`).join('')}
    </select></label>
    <label class="field"><span>Título</span><input name="title" required maxlength="80" value="${esc(event?.title ?? '')}" placeholder="Ej. Premier Acto 2"></label>
    <div data-calendar-fields></div>
    <label class="field"><span>Notas</span><textarea name="notes" rows="3" maxlength="1000">${esc(event?.notes ?? '')}</textarea></label>
    <div class="modal-foot">
      ${event ? '<button type="button" class="btn ghost danger" data-action="delete-calendar-event">Eliminar</button>' : ''}
      <button type="button" class="btn ghost" data-action="close-modal">Cancelar</button>
      <button type="submit" class="btn primary">Guardar</button>
    </div>
  </form>`;
  renderCalendarFormFields(type, event, mapOptions);
  const dialog = $('#modal');
  if (!dialog.open) dialog.showModal();
}

function renderCalendarFormFields(type, event = null, mapOptions = null) {
  const container = $('[data-calendar-fields]', $('#modal'));
  if (!container) return;
  const options = mapOptions ?? (`<option value="">Sin mapa</option>` + S.maps
    .filter((m) => m.in_pool)
    .map((m) => `<option value="${m.id}" ${m.id === event?.map_id ? 'selected' : ''}>${esc(m.name)}</option>`)
    .join(''));
  if (type === 'season') {
    container.innerHTML = `<div class="field-row">
      <label class="field grow"><span>Inicio</span><input type="date" name="start_date" required value="${event?.start_date ?? ''}"></label>
      <label class="field grow"><span>Fin</span><input type="date" name="end_date" required value="${event?.end_date ?? ''}"></label>
    </div>`;
  } else if (type === 'match_days') {
    container.innerHTML = `<label class="field"><span>Mapa</span><select name="map_id">${options}</select></label>
      <label class="field"><span>Días y horas</span>
        <textarea name="occurrences" rows="5" required placeholder="2026-10-02 20:00\n2026-10-03 18:30">${esc(calendarOccurrencesText(event))}</textarea>
        <small class="field-help">Una fecha por línea con formato AAAA-MM-DD HH:MM.</small>
      </label>`;
  } else {
    container.innerHTML = `<label class="field"><span>Mapa</span><select name="map_id">${options}</select></label>
      <div class="field-row">
        <label class="field grow"><span>Día que jugaremos</span><input type="date" name="start_date" required value="${event?.start_date ?? ''}"></label>
        <label class="field grow"><span>Hora</span><input type="time" name="event_time" value="${event?.event_time?.slice(0, 5) ?? ''}"></label>
      </div>`;
  }
}

function parseOccurrences(text) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const occurrences = [];
  for (const line of lines) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?$/);
    if (!match || Number.isNaN(Date.parse(`${match[1]}T12:00:00`))) return null;
    occurrences.push({ date: match[1], time: match[2] || null });
  }
  return occurrences;
}

function showCalendarEvent(event) {
  if (!event) return;
  if (isAdmin()) return openCalendarEditor(event);
  const map = event.map_id ? byId(S.maps, event.map_id) : null;
  const details = event.type === 'season'
    ? `${event.start_date} → ${event.end_date}`
    : event.type === 'match_days'
      ? calendarOccurrencesText(event).replaceAll('\n', '<br>')
      : `${event.start_date}${event.event_time ? ` · ${event.event_time.slice(0, 5)}` : ''}`;
  $('#modal').innerHTML = `<div class="modal-body narrow"><div class="modal-head"><h2>${esc(event.title)}</h2>
    <button type="button" class="icon-btn" data-action="close-modal">✕</button></div>
    <span class="calendar-type-badge ev-${event.type}">${CAL_EVENT_LABELS[event.type]}</span>
    ${map ? `<p><strong>Mapa:</strong> ${esc(map.name)}</p>` : ''}<p>${details}</p>
    ${event.notes ? `<p class="notes">${esc(event.notes)}</p>` : ''}</div>`;
  $('#modal').showModal();
}

// ---------- vista: asistencia
const ATTENDANCE_CHOICES = {
  available: { label: 'Disponible', icon: '✅' },
  maybe: { label: 'Por confirmar', icon: '❓' },
  unavailable: { label: 'No disponible', icon: '❌' },
};
function attendanceDateLabel(option) {
  const date = new Date(`${option.event_date}T12:00:00`);
  const label = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}${option.event_time ? ` · ${option.event_time.slice(0, 5)}` : ''}`;
}
function votesFor(optionId, choice) {
  return S.attendanceVotes.filter((v) => v.option_id === optionId && v.choice === choice);
}
function voteNames(optionId, choice) {
  return votesFor(optionId, choice).map((v) => byId(S.players, v.player_id)?.name).filter(Boolean);
}
function openAttendancePoll() {
  const events = S.calendarEvents.filter((e) => e.type === 'match_days' && (e.occurrences ?? []).length);
  if (!events.length) return toast('No hay conjuntos de días de partido disponibles.', 'err');
  $('#modal').innerHTML = `<form class="modal-body" data-form="open-attendance-poll">
    <div class="modal-head"><h2>Abrir votación de asistencia</h2><button type="button" class="icon-btn" data-action="close-modal">✕</button></div>
    <label class="field"><span>Conjunto de días</span><select name="event_id" required>
      ${events.map((e) => `<option value="${e.id}">${esc(e.title)} · ${esc(byId(S.maps, e.map_id)?.name ?? 'Sin mapa')}</option>`).join('')}
    </select></label>
    <label class="field"><span>Título de la votación</span><input name="title" required maxlength="100" value="Disponibilidad Premier"></label>
    <p class="hint">Se incluirán todas las fechas y horas del conjunto seleccionado.</p>
    <div class="modal-foot"><button type="button" class="btn ghost" data-action="close-modal">Cancelar</button><button class="btn primary">Abrir votación</button></div>
  </form>`;
  $('#modal').showModal();
}
function viewAttendance() {
  const me = myPlayer();
  const polls = S.attendancePolls
    .filter((poll) => poll.status === 'open')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const cards = polls.map((poll) => {
    const options = S.attendanceOptions.filter((o) => o.poll_id === poll.id);
    const map = byId(S.maps, poll.map_id);
    const optionCards = options.map((option) => {
      const myVote = me && S.attendanceVotes.find((v) => v.option_id === option.id && v.player_id === me.id)?.choice;
      const selected = poll.selected_option_id === option.id;
      const groups = Object.entries(ATTENDANCE_CHOICES).map(([choice, info]) => {
        const names = voteNames(option.id, choice);
        return `<div class="attendance-result ${choice}"><strong>${info.icon} ${info.label} · ${names.length}</strong><span>${esc(names.join(', ') || 'Nadie')}</span></div>`;
      }).join('');
      const buttons = poll.status === 'open' && me
        ? `<div class="attendance-actions">${Object.entries(ATTENDANCE_CHOICES).map(([choice, info]) => `<button class="vote-btn ${choice} ${myVote === choice ? 'active' : ''}" data-action="attendance-vote" data-id="${option.id}" data-choice="${choice}">${info.icon} ${info.label}</button>`).join('')}</div>`
        : '';
      const close = poll.status === 'open' && isAdmin()
        ? `<button class="btn sm primary" data-action="close-attendance" data-poll="${poll.id}" data-id="${option.id}">Elegir este día y cerrar</button>` : '';
      return `<article class="attendance-option ${selected ? 'selected' : ''}"><div class="attendance-option-head"><h3>${esc(attendanceDateLabel(option))}</h3>${selected ? '<span class="badge role-admin">Día elegido</span>' : ''}</div>${buttons}<div class="attendance-results">${groups}</div>${close}</article>`;
    }).join('');
    return `<section class="attendance-poll"><header><div><h2>${esc(poll.title)}</h2><p class="hint">${esc(map?.name ?? 'Sin mapa')} · ${poll.status === 'open' ? 'Votación abierta' : 'Votación cerrada'}</p></div><span class="badge ${poll.status === 'open' ? 'role-player' : ''}">${poll.status === 'open' ? 'Abierta' : 'Cerrada'}</span></header><div class="attendance-options">${optionCards}</div></section>`;
  }).join('');
  return `<section><div class="attendance-toolbar"><div><h1>Asistencia</h1><p class="hint">Vota tu disponibilidad para cada fecha. Puedes cambiar tu voto mientras la votación esté abierta.</p></div>${isAdmin() ? '<button class="btn primary" data-action="open-attendance">Abrir votación</button>' : ''}</div>${!myPlayer() ? '<div class="empty">Tu cuenta debe estar vinculada a un jugador para votar.</div>' : ''}${cards || empty('No hay votaciones de asistencia.')}</section>`;
}

// ---------- vista: mapas y composiciones
function viewMaps() {
  if (!S.maps.length) return empty('No hay mapas. Añádelos en Admin.');
  const sorted = [...S.maps].sort((a, b) => (b.in_pool - a.in_pool) || a.name.localeCompare(b.name));
  const map = byId(S.maps, S.mapId);
  const comps = S.comps.filter((c) => c.map_id === S.mapId);

  const chips = sorted.map((m) => {
    const n = S.comps.filter((c) => c.map_id === m.id).length;
    return `<button class="chip ${m.id === S.mapId ? 'active' : ''} ${m.in_pool ? '' : 'off'}"
      data-action="select-map" data-id="${m.id}" title="${m.in_pool ? '' : 'Fuera del map pool'}">
      ${esc(m.name)}${n ? `<span class="count">${n}</span>` : ''}</button>`;
  }).join('');

  const mapImage = map
    ? S.mapImages.get(map.name.toLocaleLowerCase('es'))
    : null;

  return `
    <section>
      <div class="chips" role="tablist">${chips}</div>
      <div class="map-hero ${mapImage ? 'has-image' : ''}">
        ${mapImage ? `<img class="map-image" src="${esc(mapImage)}" alt="Vista del mapa ${esc(map?.name ?? '')}" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('.map-hero').classList.remove('has-image'); this.remove()">` : ''}
        <div class="map-hero-shade"></div>
        <div class="map-head">
          <h1 class="map-title">${esc(map?.name ?? '')}</h1>
          ${map && !map.in_pool ? '<span class="badge">Fuera del map pool</span>' : ''}
          ${isAdmin() ? `<div class="map-actions">
            <button class="btn" data-action="generate-comp">Generar composición</button>
            <button class="btn primary" data-action="new-comp">Nueva composición</button>
          </div>` : ''}
        </div>
      </div>
      ${comps.length
      ? `<div class="comp-sections">${COMP_STATUS_ORDER.map((status) => {
        const group = comps.filter((c) => (c.status ?? 'active') === status);
        const info = COMP_STATUSES[status];
        return `<section class="comp-section status-${status}">
          <div class="comp-section-head"><h2>${info.icon} ${info.label}</h2><span class="badge">${group.length}</span></div>
          ${group.length ? `<div class="comps">${group.map(compCard).join('')}</div>` : `<p class="comp-section-empty">No hay composiciones ${info.label.toLowerCase()}.</p>`}
        </section>`;
      }).join('')}</div>`
      : empty(isAdmin() ? 'Aún no hay composiciones para este mapa. Crea la primera.' : 'Aún no hay composiciones para este mapa.')}
    </section>`;
}

function compCard(c) {
  const slots = slotsOf(c.id);
  const warnings = [];
  const roleCount = {};

  const rows = [1, 2, 3, 4, 5].map((n) => {
    const s = slots.find((x) => x.slot === n);
    const p = s && byId(S.players, s.player_id);
    const a = s && byId(S.agents, s.agent_id);
    const lv = p && a ? S.pool.get(key(p.id, a.id)) : undefined;
    if (a) roleCount[a.role] = (roleCount[a.role] ?? 0) + 1;
    if (p && a && (lv === 'none' || lv === 'bad')) {
      warnings.push(`${p.name} ${lv === 'none' ? 'no tiene' : 'va mal con'} ${a.name}`);
    }
    const i = lvInfo(lv);
    return `<li class="slot">
      <span class="slot-agent">${a ? esc(a.name) : '<em>Sin agente</em>'}</span>
      <span class="slot-player">${p ? esc(p.name) : '<em>Sin jugador</em>'}</span>
      ${p && a ? `<span class="lv sm ${i.cls}" title="${i.label}">${i.short}</span>` : '<span class="lv sm lv-empty"></span>'}
    </li>`;
  }).join('');

  const summary = ROLE_ORDER.filter((r) => roleCount[r])
    .map((r) => `<span class="role-pill r-${r}">${roleCount[r]} ${roleCount[r] > 1 ? ROLES[r].toLowerCase() : ROLE_ONE[r].toLowerCase()}</span>`)
    .join('');

  return `
    <article class="comp status-${c.status ?? 'active'} ${c.is_main ? 'main' : ''}">
      <header class="comp-head">
        <h2>${c.is_main ? '<span class="star" title="Composición principal">★</span> ' : ''}${esc(c.name)} <span class="comp-status-label">${COMP_STATUSES[c.status ?? 'active'].one}</span></h2>
        ${isAdmin() ? `<div class="comp-actions">
          <button class="btn sm" data-action="edit-comp" data-id="${c.id}">Editar</button>
          <button class="btn sm ghost" data-action="dup-comp" data-id="${c.id}">Duplicar</button>
          <button class="btn sm ghost danger" data-action="del-comp" data-id="${c.id}">Borrar</button>
        </div>` : ''}
      </header>
      <ul class="slots">${rows}</ul>
      ${summary ? `<div class="roles">${summary}</div>` : ''}
      ${warnings.length ? `<p class="warn">${warnings.map(esc).join('. ')}.</p>` : ''}
      ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ''}
    </article>`;
}

// ---------- generador de composiciones
const LEVEL_SCORE = { great: 5, good: 4, normal: 3, bad: 1, none: 0 };

function openCompositionGenerator() {
  if (S.players.length < 5) {
    return toast('Necesitas al menos 5 jugadores para generar una composición.', 'err');
  }
  S.generator = { agentIds: [null, null, null, null, null], results: [] };
  renderGeneratorSetup();
  const dlg = $('#modal');
  if (!dlg.open) dlg.showModal();
}

function generatorAgentOptions(selectedId, index) {
  const used = new Set(
    S.generator.agentIds.filter((id, i) => i !== index && id)
  );
  const agents = S.agents.filter((a) => a.active || a.id === selectedId);
  const option = (a) => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''} ${used.has(a.id) ? 'disabled' : ''}>
    ${esc(a.name)}${used.has(a.id) ? ' (seleccionado)' : ''}
  </option>`;

  return ROLE_ORDER.map((roleId) => {
    const roleAgents = agents
      .filter((a) => a.role === roleId)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!roleAgents.length) return '';
    return `<optgroup label="${ROLES[roleId]}">${roleAgents.map(option).join('')}</optgroup>`;
  }).join('');
}

function renderGeneratorSetup() {
  const g = S.generator;
  $('#modal').classList.remove('generator-dialog');
  const rows = g.agentIds.map((agentId, index) => `
    <label class="generator-agent-row">
      <span class="generator-number">${index + 1}</span>
      <select data-generator-agent="${index}" aria-label="Agente ${index + 1}">
        <option value="">Selecciona un agente…</option>
        ${generatorAgentOptions(agentId, index)}
      </select>
    </label>`).join('');

  $('#modal').innerHTML = `
    <form class="modal-body" data-form="generate-compositions">
      <div class="modal-head">
        <div>
          <h2>Generar composición</h2>
          <p class="hint">Selecciona 5 agentes. Se buscarán hasta 3 asignaciones de jugadores.</p>
        </div>
        <button type="button" class="icon-btn" data-action="close-modal" aria-label="Cerrar">✕</button>
      </div>
      <div class="generator-agents">${rows}</div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-action="close-modal">Cancelar</button>
        <button type="submit" class="btn primary">Buscar combinaciones</button>
      </div>
    </form>`;
}

function generateBestCompositions(agentIds, limit = 3) {
  const agents = agentIds.map((id) => byId(S.agents, id));
  const candidates = agents.map((agent) =>
    S.players.map((player) => {
      const level = S.pool.get(key(player.id, agent.id)) ?? null;
      return { player, level, score: LEVEL_SCORE[level] ?? 2 };
    }).sort((a, b) => b.score - a.score || a.player.sort_order - b.player.sort_order || a.player.name.localeCompare(b.player.name))
  );

  const best = [];
  const usedPlayers = new Set();
  const assignment = [];

  function addResult(score) {
    const result = {
      score,
      slots: assignment.map((choice, index) => ({
        slot: index + 1,
        player_id: choice.player.id,
        agent_id: agents[index].id,
        level: choice.level,
      })),
    };
    best.push(result);
    best.sort((a, b) => b.score - a.score);
    if (best.length > limit) best.pop();
  }

  function search(agentIndex, score) {
    if (agentIndex === agents.length) {
      addResult(score);
      return;
    }

    const remainingBest = candidates.slice(agentIndex)
      .reduce((total, list) => total + (list.find((c) => !usedPlayers.has(c.player.id))?.score ?? 0), 0);
    if (best.length === limit && score + remainingBest < best[best.length - 1].score) return;

    for (const choice of candidates[agentIndex]) {
      if (usedPlayers.has(choice.player.id)) continue;
      usedPlayers.add(choice.player.id);
      assignment.push(choice);
      search(agentIndex + 1, score + choice.score);
      assignment.pop();
      usedPlayers.delete(choice.player.id);
    }
  }

  search(0, 0);
  return best;
}

function renderGeneratorResults() {
  $('#modal').classList.add('generator-dialog');
  const results = S.generator.results;
  const cards = results.map((result, index) => {
    const rows = result.slots.map((slot) => {
      const player = byId(S.players, slot.player_id);
      const agent = byId(S.agents, slot.agent_id);
      const info = lvInfo(slot.level);
      return `<li class="generator-slot">
        <strong>${esc(agent?.name)}</strong>
        <span>${esc(player?.name)}</span>
        <span class="lv sm ${info.cls}" title="${info.label}">${info.short}</span>
      </li>`;
    }).join('');
    return `<article class="generator-result ${index === 0 ? 'best' : ''}">
      <div class="generator-result-head">
        <h3>Opción ${index + 1}${index === 0 ? ' · Mejor puntuación' : ''}</h3>
        <span class="badge">${result.score}/25</span>
      </div>
      <ul>${rows}</ul>
      <button type="button" class="btn primary wide" data-action="accept-generated" data-index="${index}">Usar esta composición</button>
    </article>`;
  }).join('');

  $('#modal').innerHTML = `
    <div class="modal-body generator-results-body">
      <div class="modal-head">
        <div>
          <h2>Composiciones propuestas</h2>
          <p class="hint">Se priorizan los niveles Genial, Bien y Normal, sin repetir jugadores.</p>
        </div>
        <button type="button" class="icon-btn" data-action="close-modal" aria-label="Cerrar">✕</button>
      </div>
      <div class="generator-results">${cards}</div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-action="back-generator">Cambiar agentes</button>
        <button type="button" class="btn ghost" data-action="close-modal">Cancelar</button>
      </div>
    </div>`;
}

function acceptGeneratedComposition(index) {
  const result = S.generator?.results[index];
  if (!result) return;
  const count = S.comps.filter((c) => c.map_id === S.mapId).length;
  S.draft = {
    id: null,
    map_id: S.mapId,
    name: `Comp generada ${count + 1}`,
    notes: '',
    is_main: false,
    status: 'draft',
    slots: result.slots.map(({ slot, player_id, agent_id }) => ({ slot, player_id, agent_id })),
  };
  S.generator = null;
  renderEditor();
}

// ---------- editor de composición (modal)
function openCompEditor(comp, duplicate = false) {
  const slots = comp ? slotsOf(comp.id) : [];
  const count = S.comps.filter((c) => c.map_id === S.mapId).length;
  S.draft = {
    id: comp && !duplicate ? comp.id : null,
    map_id: comp?.map_id ?? S.mapId,
    name: comp ? (duplicate ? `${comp.name} (copia)` : comp.name) : `Comp ${count + 1}`,
    notes: comp?.notes ?? '',
    is_main: comp && !duplicate ? comp.is_main : false,
    status: comp && !duplicate ? (comp.status ?? 'active') : (duplicate ? (comp?.status ?? 'active') : 'active'),
    slots: [1, 2, 3, 4, 5].map((n) => {
      const s = slots.find((x) => x.slot === n);
      return { slot: n, player_id: s?.player_id ?? null, agent_id: s?.agent_id ?? null };
    }),
  };
  renderEditor();
  const dlg = $('#modal');
  if (!dlg.open) dlg.showModal();
}

function agentOptions(slot) {
  const d = S.draft;
  const usedElsewhere = new Set(d.slots.filter((s) => s !== slot && s.agent_id).map((s) => s.agent_id));
  const agents = S.agents.filter((a) => a.active || a.id === slot.agent_id);
  const opt = (a, suffix = '') => `<option value="${a.id}" ${a.id === slot.agent_id ? 'selected' : ''}>
    ${esc(a.name)}${suffix}${usedElsewhere.has(a.id) ? ' (en uso)' : ''}</option>`;

  if (!slot.player_id) {
    return ROLE_ORDER.map((r) => `<optgroup label="${ROLES[r]}">${agents.filter((a) => a.role === r).map((a) => opt(a)).join('')}</optgroup>`).join('');
  }
  const groups = [...LEVEL_ORDER.slice(0, 3), null, ...LEVEL_ORDER.slice(3)]; // genial, bien, normal, sin valorar, malo, no lo tiene
  return groups.map((lv) => {
    const list = agents.filter((a) => (S.pool.get(key(slot.player_id, a.id)) ?? null) === lv);
    if (!list.length) return '';
    return `<optgroup label="${lvInfo(lv).label}">${list.map((a) => opt(a)).join('')}</optgroup>`;
  }).join('');
}

function playerOptions(slot) {
  const d = S.draft;
  const usedElsewhere = new Set(
    d.slots.filter((s) => s !== slot && s.player_id).map((s) => s.player_id)
  );
  const opt = (p) => `<option value="${p.id}" ${p.id === slot.player_id ? 'selected' : ''}>
    ${esc(p.name)}${usedElsewhere.has(p.id) ? ' (en uso)' : ''}</option>`;

  // Sin agente seleccionado mantenemos el orden habitual de jugadores.
  if (!slot.agent_id) return S.players.map((p) => opt(p)).join('');

  // Con agente seleccionado agrupamos a los jugadores según su nivel con él.
  const groups = [...LEVEL_ORDER.slice(0, 3), null, ...LEVEL_ORDER.slice(3)];
  return groups.map((lv) => {
    const list = S.players.filter(
      (p) => (S.pool.get(key(p.id, slot.agent_id)) ?? null) === lv
    );
    if (!list.length) return '';
    return `<optgroup label="${lvInfo(lv).label}">${list.map((p) => opt(p)).join('')}</optgroup>`;
  }).join('');
}

function renderEditor() {
  $('#modal').classList.remove('generator-dialog');
  const d = S.draft;

  const slotRows = d.slots.map((s, idx) => {
    const lv = s.player_id && s.agent_id ? S.pool.get(key(s.player_id, s.agent_id)) : undefined;
    const i = lvInfo(lv);
    return `<div class="edit-slot">
      <select data-draft="player" data-idx="${idx}" aria-label="Jugador ${idx + 1}">
        <option value="">Jugador…</option>${playerOptions(s)}
      </select>
      <select data-draft="agent" data-idx="${idx}" aria-label="Agente ${idx + 1}">
        <option value="">Agente…</option>${agentOptions(s)}
      </select>
      <span class="lv sm ${s.player_id && s.agent_id ? i.cls : 'lv-empty'}" title="${i.label}">${s.player_id && s.agent_id ? i.short : ''}</span>
    </div>`;
  }).join('');

  $('#modal').innerHTML = `
    <form class="modal-body" data-form="save-comp">
      <div class="modal-head">
        <h2>${d.id ? 'Editar composición' : 'Nueva composición'}</h2>
        <button type="button" class="icon-btn" data-action="close-modal" aria-label="Cerrar">✕</button>
      </div>
      <div class="field-row">
        <label class="field grow"><span>Nombre</span>
          <input data-draft="name" value="${esc(d.name)}" required maxlength="60"></label>
        <label class="field"><span>Mapa</span>
          <select data-draft="map">${S.maps.map((m) =>
    `<option value="${m.id}" ${m.id === d.map_id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Estado</span>
        <select data-draft="status">${Object.entries(COMP_STATUSES).map(([value, info]) =>
      `<option value="${value}" ${value === d.status ? 'selected' : ''}>${info.icon} ${info.one}</option>`).join('')}</select>
      </label>
      <div class="edit-slots">${slotRows}</div>
      <label class="field"><span>Notas</span>
        <textarea data-draft="notes" rows="3" maxlength="1000" placeholder="Setups, quién entra primero, alternativas…">${esc(d.notes)}</textarea></label>
      <label class="check"><input type="checkbox" data-draft="main" ${d.is_main ? 'checked' : ''} ${d.status !== 'active' ? 'disabled' : ''}> Composición principal del mapa</label>
      ${d.status !== 'active' ? '<p class="hint">Solo una composición activa puede ser principal.</p>' : ''}
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-action="close-modal">Cancelar</button>
        <button type="submit" class="btn primary">Guardar composición</button>
      </div>
    </form>`;
}

function onDraftInput(el) {
  const d = S.draft;
  if (!d) return;
  const idx = Number(el.dataset.idx);
  switch (el.dataset.draft) {
    case 'name': d.name = el.value; return;
    case 'notes': d.notes = el.value; return;
    case 'main': d.is_main = el.checked; return;
    case 'status': d.status = el.value; if (d.status !== 'active') d.is_main = false; renderEditor(); return;
    case 'map': d.map_id = Number(el.value); return;
    case 'player': d.slots[idx].player_id = el.value ? Number(el.value) : null; break;
    case 'agent': d.slots[idx].agent_id = el.value ? Number(el.value) : null; break;
  }
  renderEditor(); // ambos desplegables dependen de la selección del otro
  $(`[data-draft="${el.dataset.draft}"][data-idx="${idx}"]`)?.focus();
}

async function saveDraft() {
  const d = S.draft;
  const players = d.slots.map((s) => s.player_id).filter(Boolean);
  const agents = d.slots.map((s) => s.agent_id).filter(Boolean);
  if (new Set(players).size !== players.length) return toast('Hay un jugador repetido.', 'err');
  if (new Set(agents).size !== agents.length) return toast('Hay un agente repetido.', 'err');
  if (!d.name.trim()) return toast('Ponle un nombre a la composición.', 'err');

  const { error } = await sb.rpc('save_composition', {
    p_id: d.id, p_map_id: d.map_id, p_name: d.name.trim(), p_notes: d.notes.trim() || null,
    p_is_main: d.is_main, p_slots: d.slots,
  });
  if (error) return toast(friendlyError(error), 'err');
  const statusQuery = d.id
    ? sb.from('compositions').update({ status: d.status }).eq('id', d.id)
    : sb.from('compositions').update({ status: d.status }).eq('map_id', d.map_id).eq('name', d.name.trim());
  const { error: statusError } = await statusQuery;
  if (statusError) return toast('La composición se guardó, pero no se pudo guardar su estado: ' + friendlyError(statusError), 'err');
  $('#modal').close();
  S.mapId = d.map_id;
  S.draft = null;
  toast('Composición guardada');
  await refresh();
}

// ---------- vista: mi cuenta
function viewAccount() {
  const email = S.session?.user?.email ?? '';
  return `
    <section class="account-view">
      <div class="view-head">
        <h1>Mi cuenta</h1>
        <p class="hint">Sesión iniciada como ${esc(email)}.</p>
      </div>
      <div class="admin-block account-card">
        <h2>Cambiar contraseña</h2>
        <p class="hint">La nueva contraseña debe tener al menos 8 caracteres.</p>
        <form class="password-form" data-form="change-password">
          <label class="field">
            <span>Nueva contraseña</span>
            <div class="pw-wrap">
              <input type="password" name="password" required minlength="8" autocomplete="new-password">
              <button type="button" class="pw-toggle" data-action="toggle-pw" aria-label="Mostrar contraseña">👁</button>
            </div>
          </label>
          <label class="field">
            <span>Repite la nueva contraseña</span>
            <div class="pw-wrap">
              <input type="password" name="password_confirm" required minlength="8" autocomplete="new-password">
              <button type="button" class="pw-toggle" data-action="toggle-pw" aria-label="Mostrar contraseña">👁</button>
            </div>
          </label>
          <button class="btn primary" type="submit">Cambiar contraseña</button>
        </form>
      </div>
    </section>`;
}

// ---------- vista: admin
function viewAdmin() {
  const profileOpts = (sel) => `<option value="">Sin cuenta</option>` + S.profiles.map((p) =>
    `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.display_name || p.email)}</option>`).join('');

  const players = S.players.map((p) => `
    <tr>
      <td><input data-change="player-name" data-id="${p.id}" value="${esc(p.name)}" aria-label="Nombre"></td>
      <td><select data-change="player-user" data-id="${p.id}" aria-label="Cuenta vinculada">${profileOpts(p.user_id)}</select></td>
      <td><input data-change="player-discord" data-id="${p.id}" value="${esc(p.discord_id ?? '')}" inputmode="numeric" pattern="[0-9]{17,20}" maxlength="20" placeholder="Discord ID" aria-label="Discord ID"></td>
      <td><input class="num" type="number" data-change="player-order" data-id="${p.id}" value="${p.sort_order}" aria-label="Orden"></td>
      <td><button class="btn sm ghost danger" data-action="del-player" data-id="${p.id}">Borrar</button></td>
    </tr>`).join('');

  const users = S.profiles.map((u) => `
    <tr>
      <td>${esc(u.display_name || '—')}<div class="sub">${esc(u.email || '')}</div></td>
      <td><select data-change="user-role" data-id="${u.id}" ${u.id === S.session.user.id ? 'disabled title="No puedes cambiar tu propio rol"' : ''}>
        ${Object.entries(APP_ROLES).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}
      </select></td>
      <td>${esc(S.players.find((p) => p.user_id === u.id)?.name ?? '')}</td>
      <td>${u.id === S.session.user.id
      ? '<span class="sub">Tu cuenta</span>'
      : `<button class="btn sm ghost danger" data-action="del-user" data-user-id="${u.id}">Eliminar</button>`}
      </td>
    </tr>`).join('');

  const roleSelect = (sel, attrs) => `<select ${attrs}>${ROLE_ORDER.map((r) =>
    `<option value="${r}" ${r === sel ? 'selected' : ''}>${ROLE_ONE[r]}</option>`).join('')}</select>`;

  const agents = [...S.agents].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name))
    .map((a) => `
    <tr class="${a.active ? '' : 'inactive'}">
      <td><input data-change="agent-name" data-id="${a.id}" value="${esc(a.name)}" aria-label="Nombre"></td>
      <td>${roleSelect(a.role, `data-change="agent-role" data-id="${a.id}" aria-label="Rol"`)}</td>
      <td><label class="check"><input type="checkbox" data-change="agent-active" data-id="${a.id}" ${a.active ? 'checked' : ''}> Visible</label></td>
    </tr>`).join('');

  const maps = S.maps.map((m) => `
    <tr class="${m.in_pool ? '' : 'inactive'}">
      <td><input data-change="map-name" data-id="${m.id}" value="${esc(m.name)}" aria-label="Nombre"></td>
      <td><label class="check"><input type="checkbox" data-change="map-pool" data-id="${m.id}" ${m.in_pool ? 'checked' : ''}> En map pool</label></td>
      <td><button class="btn sm ghost danger" data-action="del-map" data-id="${m.id}">Borrar</button></td>
    </tr>`).join('');

  return `
    <div class="admin">
      <section class="admin-block">
        <h2>Jugadores</h2>
        <p class="hint">Vincula cada jugador a su cuenta web y a su ID de Discord. El bot reconocerá como admins a los jugadores cuya cuenta web tenga rol Admin.</p>
        <div class="table-scroll"><table class="admin-table">
          <thead><tr><th>Nombre</th><th>Cuenta</th><th>Discord ID</th><th>Orden</th><th></th></tr></thead>
          <tbody>${players}</tbody></table></div>
        <form class="add-row" data-form="add-player">
          <input name="name" placeholder="Nombre del jugador" required maxlength="40">
          <button class="btn primary">Añadir jugador</button>
        </form>
      </section>

      <section class="admin-block">
        <h2>Cuentas y permisos</h2>
        <p class="hint">Jugador: edita solo su agent pool. Admin: edita todo, incluidas las composiciones.</p>
        <div class="table-scroll"><table class="admin-table">
          <thead><tr><th>Cuenta</th><th>Permiso</th><th>Jugador</th><th></th></tr></thead>
          <tbody>${users || '<tr><td colspan="4">Nadie se ha registrado todavía.</td></tr>'}</tbody></table></div>
      </section>

      <section class="admin-block">
        <h2>Crear cuenta</h2>
        <p class="hint">Crea una cuenta sin que el usuario reciba ningún email. Después vincúlala a un jugador en la tabla de arriba.</p>
        <form class="create-user-form" data-form="create-user">
          <div class="field-row">
            <label class="field grow"><span>Email</span><input name="email" type="email" required autocomplete="off"></label>
            <label class="field grow"><span>Nombre (visible en la web)</span><input name="display_name" type="text" maxlength="40" autocomplete="off"></label>
          </div>
          <div class="field-row">
            <label class="field grow"><span>Contraseña (mín. 8 caracteres)</span>
              <div class="pw-wrap"><input name="password" type="password" required minlength="8" autocomplete="new-password" id="new-pw">
              <button type="button" class="pw-toggle" data-action="toggle-pw" aria-label="Mostrar contraseña">👁</button></div>
            </label>
            <button class="btn primary" style="align-self:flex-end;flex:none">Crear cuenta</button>
          </div>
        </form>
      </section>

      <section class="admin-block">
        <h2>Agentes</h2>
        <div class="table-scroll"><table class="admin-table">
          <thead><tr><th>Nombre</th><th>Rol</th><th></th></tr></thead>
          <tbody>${agents}</tbody></table></div>
        <form class="add-row" data-form="add-agent">
          <input name="name" placeholder="Nuevo agente" required maxlength="30">
          ${roleSelect('duelist', 'name="role" aria-label="Rol"')}
          <button class="btn primary">Añadir agente</button>
        </form>
      </section>

      <section class="admin-block">
        <h2>Mapas</h2>
        <div class="table-scroll"><table class="admin-table">
          <thead><tr><th>Nombre</th><th></th><th></th></tr></thead>
          <tbody>${maps}</tbody></table></div>
        <form class="add-row" data-form="add-map">
          <input name="name" placeholder="Nuevo mapa" required maxlength="30">
          <button class="btn primary">Añadir mapa</button>
        </form>
      </section>
    </div>`;
}

// ---------------------------------------------------------------- menú de nivel
let menuEl = null;
function closeMenu() {
  menuEl?.remove();
  menuEl = null;
  document.removeEventListener('pointerdown', onOutside, true);
}
function onOutside(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }

function openLevelMenu(anchor, pid, aid) {
  closeMenu();
  const current = S.pool.get(key(pid, aid)) ?? null;
  const items = [...LEVEL_ORDER, null];
  const p = byId(S.players, pid), a = byId(S.agents, aid);

  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  menuEl.setAttribute('role', 'menu');
  menuEl.innerHTML = `<div class="menu-title">${esc(p?.name)} con ${esc(a?.name)}</div>` +
    items.map((lv, i) => {
      const info = lvInfo(lv);
      return `<button role="menuitem" data-i="${i}" class="${lv === current ? 'current' : ''}">
        <span class="lv sm ${info.cls}">${info.short}</span>${info.label}</button>`;
    }).join('');
  document.body.appendChild(menuEl);

  const r = anchor.getBoundingClientRect();
  const { offsetWidth: w, offsetHeight: h } = menuEl;
  let left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;

  menuEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    closeMenu();
    setLevel(pid, aid, items[Number(b.dataset.i)]);
    anchor.focus?.();
  });
  menuEl.querySelector('button.current, button')?.focus();
  setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
}

async function setLevel(pid, aid, level) {
  const k = key(pid, aid);
  const prev = S.pool.get(k);
  if (level) S.pool.set(k, level); else S.pool.delete(k);
  render();

  const q = level
    ? sb.from('player_agents').upsert({ player_id: pid, agent_id: aid, level, updated_at: new Date().toISOString() })
    : sb.from('player_agents').delete().match({ player_id: pid, agent_id: aid });
  const { error } = await q;
  if (error) {
    if (prev) S.pool.set(k, prev); else S.pool.delete(k);
    render();
    toast(friendlyError(error), 'err');
  }
}

// ---------------------------------------------------------------- login
function openLogin() {
  $('#modal').innerHTML = `
    <form class="modal-body narrow" data-form="login">
      <div class="modal-head">
        <h2>Iniciar sesión</h2>
        <button type="button" class="icon-btn" data-action="close-modal" aria-label="Cerrar">✕</button>
      </div>
      <label class="field"><span>Email</span>
        <input type="email" name="email" required autocomplete="email"></label>
      <label class="field"><span>Contraseña</span>
        <div class="pw-wrap">
          <input type="password" name="password" id="login-pw" required autocomplete="current-password">
          <button type="button" class="pw-toggle" data-action="toggle-pw" aria-label="Mostrar contraseña">👁</button>
        </div>
      </label>
      <button class="btn primary wide">Entrar</button>
      ${ENABLE_DISCORD_LOGIN ? `
        <div class="or">o</div>
        <button type="button" class="btn discord wide" data-action="login-discord">Entrar con Discord</button>
      ` : ''}
    </form>`;
  $('#modal').showModal();
  $('#modal input[name=email]').focus();
}

// Función para crear cuenta desde el panel Admin (llama a la Edge Function)
async function apiCreateUser(email, password, displayName) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Sesión caducada, vuelve a iniciar sesión');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-user-premier`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password, display_name: displayName }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(json.error || `Error HTTP ${res.status} al crear la cuenta`);
  }
  return json.data;
}

async function apiDeleteUser(userId) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Sesión caducada, vuelve a iniciar sesión');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-user-premier`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action: 'delete', user_id: userId }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(json.error || `Error HTTP ${res.status} al eliminar la cuenta`);
  }
  return json.data;
}

// ---------------------------------------------------------------- eventos
async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = Number(el.dataset.id);
  switch (el.dataset.action) {
    case 'tab':
      S.tab = el.dataset.tab; writePref('tab', S.tab); render(); break;
    case 'select-map':
      S.mapId = id; writePref('map', id); render(); break;
    case 'calendar-prev': changeCalendarMonth(-1); break;
    case 'calendar-next': changeCalendarMonth(1); break;
    case 'new-calendar-event': openCalendarEditor(); break;
    case 'open-attendance': openAttendancePoll(); break;
    case 'attendance-vote': {
      const { error } = await sb.rpc('vote_attendance', { p_option_id: id, p_choice: el.dataset.choice });
      if (error) toast(friendlyError(error), 'err'); else { toast('Voto guardado'); await refresh(); }
      break;
    }
    case 'close-attendance': {
      if (!confirm('¿Cerrar la votación y elegir esta fecha? Se creará el día elegido en el calendario.')) return;
      const { error } = await sb.rpc('close_attendance_poll', { p_poll_id: Number(el.dataset.poll), p_selected_option_id: id });
      if (error) toast(friendlyError(error), 'err'); else { toast('Votación cerrada y fecha elegida'); await refresh(); }
      break;
    }
    case 'view-calendar-event': showCalendarEvent(byId(S.calendarEvents, id)); break;
    case 'delete-calendar-event': {
      const form = el.closest('[data-form="save-calendar-event"]');
      const eventId = Number(form?.dataset.id);
      if (!eventId || !confirm('¿Eliminar este evento del calendario?')) return;
      $('#modal').close();
      await mutate(sb.from('calendar_events').delete().eq('id', eventId), 'Evento eliminado');
      break;
    }
    case 'pick-level':
      openLevelMenu(el, Number(el.dataset.p), Number(el.dataset.a)); break;
    case 'open-login': openLogin(); break;
    case 'toggle-pw': {
      const input = el.parentElement?.querySelector('input');
      if (!input) break;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      el.textContent = showing ? '👁' : '🙈';
      el.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
      input.focus();
      break;
    }
    case 'login-discord': {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: redirectUrl() } });
      if (error) toast(friendlyError(error), 'err');
      break;
    }
    case 'logout': await sb.auth.signOut(); break;
    case 'close-modal': $('#modal').close(); S.draft = null; S.generator = null; break;
    case 'generate-comp': openCompositionGenerator(); break;
    case 'back-generator': renderGeneratorSetup(); break;
    case 'accept-generated': acceptGeneratedComposition(Number(el.dataset.index)); break;
    case 'new-comp': openCompEditor(null); break;
    case 'edit-comp': openCompEditor(byId(S.comps, id)); break;
    case 'dup-comp': openCompEditor(byId(S.comps, id), true); break;
    case 'del-comp': {
      const c = byId(S.comps, id);
      if (!confirm(`¿Borrar la composición "${c?.name}"?`)) return;
      await mutate(sb.from('compositions').delete().eq('id', id), 'Composición borrada');
      break;
    }
    case 'del-user': {
      const userId = el.dataset.userId;
      const user = S.profiles.find((u) => u.id === userId);
      if (!userId || !user) return;
      if (userId === S.session?.user?.id) return toast('No puedes eliminar tu propia cuenta.', 'err');

      const linkedPlayer = S.players.find((p) => p.user_id === userId);
      const label = user.display_name || user.email || 'esta cuenta';
      const extra = linkedPlayer
        ? ` Se desvinculará del jugador ${linkedPlayer.name}, pero el jugador y su agent pool no se borrarán.`
        : '';
      if (!confirm(`¿Eliminar definitivamente la cuenta "${label}"?${extra}`)) return;

      el.disabled = true;
      try {
        await apiDeleteUser(userId);
        toast('Cuenta eliminada');
        await refresh();
      } catch (error) {
        el.disabled = false;
        toast(friendlyError(error), 'err');
      }
      break;
    }
    case 'del-player': {
      const p = byId(S.players, id);
      if (!confirm(`¿Borrar a ${p?.name}? Se pierde su agent pool y sale de todas las composiciones.`)) return;
      await mutate(sb.from('players').delete().eq('id', id), 'Jugador borrado');
      break;
    }
    case 'del-map': {
      const m = byId(S.maps, id);
      if (!confirm(`¿Borrar ${m?.name} y todas sus composiciones? Si solo sale del map pool, desmarca la casilla.`)) return;
      await mutate(sb.from('maps').delete().eq('id', id), 'Mapa borrado');
      break;
    }
  }
}

async function mutate(query, okMsg) {
  const { error } = await query;
  if (error) toast(friendlyError(error), 'err');
  else if (okMsg) toast(okMsg);
  await refresh();
}

async function onChange(e) {
  const calendarType = e.target.closest('[data-calendar-type]');
  if (calendarType) {
    const form = calendarType.closest('form');
    const existing = byId(S.calendarEvents, Number(form?.dataset.id));
    renderCalendarFormFields(calendarType.value, existing);
    return;
  }

  const generatorSelect = e.target.closest('[data-generator-agent]');
  if (generatorSelect && S.generator) {
    const index = Number(generatorSelect.dataset.generatorAgent);
    S.generator.agentIds[index] = generatorSelect.value ? Number(generatorSelect.value) : null;
    renderGeneratorSetup();
    $(`[data-generator-agent="${index}"]`)?.focus();
    return;
  }

  const d = e.target.closest('[data-draft]');
  if (d) {
    if (d.tagName === 'SELECT' || d.type === 'checkbox') onDraftInput(d);
    return;
  }

  const el = e.target.closest('[data-change]');
  if (!el) return;
  const raw = el.dataset.id;
  const id = Number(raw);
  const v = el.type === 'checkbox' ? el.checked : el.value;
  const ops = {
    'player-name': () => sb.from('players').update({ name: String(v).trim() }).eq('id', id),
    'player-user': () => sb.from('players').update({ user_id: v || null }).eq('id', id),
    'player-discord': () => sb.from('players').update({ discord_id: String(v).trim() || null }).eq('id', id),
    'player-order': () => sb.from('players').update({ sort_order: Number(v) || 0 }).eq('id', id),
    'user-role': () => sb.from('profiles').update({ role: v }).eq('id', raw),
    'agent-name': () => sb.from('agents').update({ name: String(v).trim() }).eq('id', id),
    'agent-role': () => sb.from('agents').update({ role: v }).eq('id', id),
    'agent-active': () => sb.from('agents').update({ active: v }).eq('id', id),
    'map-name': () => sb.from('maps').update({ name: String(v).trim() }).eq('id', id),
    'map-pool': () => sb.from('maps').update({ in_pool: v }).eq('id', id),
  };
  const op = ops[el.dataset.change];
  if (op) await mutate(op(), 'Guardado');
}

function onInput(e) {
  const d = e.target.closest('[data-draft]');
  if (d && ((d.tagName === 'INPUT' && d.type !== 'checkbox') || d.tagName === 'TEXTAREA')) onDraftInput(d);
}

async function onSubmit(e) {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  switch (form.dataset.form) {
    case 'login': {
      const email = String(fd.get('email')).trim();
      const password = String(fd.get('password') ?? '');
      const submit = form.querySelector('button[type="submit"], button:not([type])');
      if (submit) submit.disabled = true;

      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (submit) submit.disabled = false;
      if (error) return toast(friendlyError(error), 'err');

      $('#modal').close();
      toast('Sesión iniciada');
      break;
    }
    case 'create-user': {
      const email = String(fd.get('email')).trim();
      const password = String(fd.get('password') ?? '');
      const displayName = String(fd.get('display_name') ?? '').trim();
      const submit = form.querySelector('button[type="submit"], button:not([type])');

      if (password.length < 8) return toast('La contraseña debe tener al menos 8 caracteres.', 'err');
      if (submit) submit.disabled = true;
      try {
        await apiCreateUser(email, password, displayName);
        form.reset();
        toast('Cuenta creada correctamente');
        await refresh();
      } catch (error) {
        toast(friendlyError(error), 'err');
      } finally {
        if (submit) submit.disabled = false;
      }
      break;
    }
    case 'change-password': {
      const password = String(fd.get('password') ?? '');
      const confirmation = String(fd.get('password_confirm') ?? '');
      if (password.length < 8) return toast('La contraseña debe tener al menos 8 caracteres.', 'err');
      if (password !== confirmation) return toast('Las contraseñas no coinciden.', 'err');

      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      const { error } = await sb.auth.updateUser({ password });
      if (submit) submit.disabled = false;
      if (error) return toast(friendlyError(error), 'err');

      form.reset();
      toast('Contraseña actualizada correctamente');
      break;
    }
    case 'open-attendance-poll': {
      const event = byId(S.calendarEvents, Number(fd.get('event_id')));
      if (!event || event.type !== 'match_days') return toast('Selecciona un conjunto de días válido.', 'err');
      const options = (event.occurrences ?? []).filter((o) => o.date).map((o, i) => ({ date: o.date, time: o.time?.slice(0, 5) ?? null, sort_order: i }));
      const { error } = await sb.rpc('open_attendance_poll', {
        p_title: String(fd.get('title') ?? '').trim(), p_map_id: event.map_id, p_source_event_id: event.id, p_options: options,
      });
      if (error) return toast(friendlyError(error), 'err');
      $('#modal').close(); toast('Votación abierta'); await refresh(); break;
    }
    case 'save-calendar-event': {
      const type = String(fd.get('type'));
      const id = Number(form.dataset.id) || null;
      const title = String(fd.get('title') ?? '').trim();
      const notes = String(fd.get('notes') ?? '').trim() || null;
      let payload = { type, title, notes, map_id: null, start_date: null, end_date: null, event_time: null, occurrences: [], updated_at: new Date().toISOString() };
      if (type === 'season') {
        payload.start_date = String(fd.get('start_date') ?? '');
        payload.end_date = String(fd.get('end_date') ?? '');
        if (!payload.start_date || !payload.end_date || payload.end_date < payload.start_date) return toast('Revisa las fechas de la temporada.', 'err');
      } else if (type === 'match_days') {
        payload.map_id = fd.get('map_id') ? Number(fd.get('map_id')) : null;
        payload.occurrences = parseOccurrences(String(fd.get('occurrences') ?? ''));
        if (!payload.occurrences?.length) return toast('Añade al menos un día válido con formato AAAA-MM-DD HH:MM.', 'err');
      } else {
        payload.map_id = fd.get('map_id') ? Number(fd.get('map_id')) : null;
        payload.start_date = String(fd.get('start_date') ?? '');
        payload.event_time = String(fd.get('event_time') ?? '') || null;
        if (!payload.start_date) return toast('Selecciona el día que jugaréis.', 'err');
      }
      const query = id
        ? sb.from('calendar_events').update(payload).eq('id', id)
        : sb.from('calendar_events').insert(payload);
      const { error } = await query;
      if (error) return toast(friendlyError(error), 'err');
      $('#modal').close();
      toast(id ? 'Evento actualizado' : 'Evento creado');
      await refresh();
      break;
    }
    case 'generate-compositions': {
      const agentIds = S.generator?.agentIds ?? [];
      if (agentIds.some((id) => !id)) return toast('Selecciona los 5 agentes.', 'err');
      if (new Set(agentIds).size !== 5) return toast('No puedes repetir agentes.', 'err');
      S.generator.results = generateBestCompositions(agentIds, 3);
      if (!S.generator.results.length) return toast('No se encontraron combinaciones.', 'err');
      renderGeneratorResults();
      break;
    }
    case 'save-comp': await saveDraft(); break;
    case 'add-player':
      await mutate(sb.from('players').insert({ name: String(fd.get('name')).trim(), sort_order: S.players.length }), 'Jugador añadido');
      break;
    case 'add-agent':
      await mutate(sb.from('agents').insert({ name: String(fd.get('name')).trim(), role: fd.get('role') }), 'Agente añadido');
      break;
    case 'add-map':
      await mutate(sb.from('maps').insert({ name: String(fd.get('name')).trim() }), 'Mapa añadido');
      break;
  }
}

// ---------------------------------------------------------------- arranque
let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    // Si estás escribiendo en un campo de la página, espera para no pisarte
    const a = document.activeElement;
    if (a && $('#main').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return scheduleReload();
    refresh();
  }, 400);
}

async function init() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  addEventListener('scroll', closeMenu, true);
  $('#modal').addEventListener('close', () => { S.draft = null; S.generator = null; });

  render();
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  await Promise.all([loadProfile(), loadAgentImages(), loadMapImages()]);
  await loadAll();
  S.loading = false;
  render();

  sb.auth.onAuthStateChange((_event, session) => {
    const changed = (session?.user?.id ?? null) !== (S.session?.user?.id ?? null);
    S.session = session;
    // No se puede hacer await a Supabase dentro del callback: se difiere
    if (changed) setTimeout(async () => { await loadProfile(); await refresh(); }, 0);
  });

  sb.channel('premier-db')
    .on('postgres_changes', { event: '*', schema: 'public' }, scheduleReload)
    .subscribe();
}

init();