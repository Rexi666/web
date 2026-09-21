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

// ---------------------------------------------------------------- estado
const S = {
  session: null, profile: null, loading: true,
  players: [], agents: [], maps: [], pool: new Map(), agentImages: new Map(),
  comps: [], slots: [], profiles: [],
  tab: readPref('tab') || 'pool',
  mapId: Number(readPref('map')) || null,
  draft: null, // composición en edición
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
    ${image ? `<img class="agent-icon" src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.hidden=true">` : ''}
    <span>${esc(agent.name)}</span>
  </span>`;
}

async function loadAll() {
  const res = await Promise.all([
    sb.from('players').select('*').order('sort_order').order('name'),
    sb.from('agents').select('*').order('name'),
    sb.from('maps').select('*').order('name'),
    sb.from('player_agents').select('player_id,agent_id,level'),
    sb.from('compositions').select('*').order('is_main', { ascending: false }).order('created_at'),
    sb.from('composition_slots').select('*'),
    isAdmin() ? sb.from('profiles').select('*').order('created_at') : Promise.resolve({ data: [] }),
  ]);
  const failed = res.find((r) => r.error);
  if (failed) toast('No se pudieron cargar los datos: ' + failed.error.message, 'err');

  const [pl, ag, mp, pa, co, cs, pr] = res.map((r) => r.data ?? []);
  Object.assign(S, { players: pl, agents: ag, maps: mp, comps: co, slots: cs, profiles: pr });
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
  const scrollLeft = wrap?.scrollLeft ?? 0;
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

  return `
    <section>
      <div class="chips" role="tablist">${chips}</div>
      <div class="map-head">
        <h1 class="map-title">${esc(map?.name ?? '')}</h1>
        ${map && !map.in_pool ? '<span class="badge">Fuera del map pool</span>' : ''}
        ${isAdmin() ? '<button class="btn primary" data-action="new-comp">Nueva composición</button>' : ''}
      </div>
      ${comps.length
      ? `<div class="comps">${comps.map(compCard).join('')}</div>`
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
    <article class="comp ${c.is_main ? 'main' : ''}">
      <header class="comp-head">
        <h2>${c.is_main ? '<span class="star" title="Composición principal">★</span> ' : ''}${esc(c.name)}</h2>
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

function renderEditor() {
  const d = S.draft;
  const usedPlayers = (slot) => new Set(d.slots.filter((s) => s !== slot && s.player_id).map((s) => s.player_id));

  const slotRows = d.slots.map((s, idx) => {
    const used = usedPlayers(s);
    const lv = s.player_id && s.agent_id ? S.pool.get(key(s.player_id, s.agent_id)) : undefined;
    const i = lvInfo(lv);
    return `<div class="edit-slot">
      <select data-draft="player" data-idx="${idx}" aria-label="Jugador ${idx + 1}">
        <option value="">Jugador…</option>
        ${S.players.map((p) => `<option value="${p.id}" ${p.id === s.player_id ? 'selected' : ''}>
          ${esc(p.name)}${used.has(p.id) ? ' (en uso)' : ''}</option>`).join('')}
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
      <div class="edit-slots">${slotRows}</div>
      <label class="field"><span>Notas</span>
        <textarea data-draft="notes" rows="3" maxlength="1000" placeholder="Setups, quién entra primero, alternativas…">${esc(d.notes)}</textarea></label>
      <label class="check"><input type="checkbox" data-draft="main" ${d.is_main ? 'checked' : ''}> Composición principal del mapa</label>
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
    case 'map': d.map_id = Number(el.value); return;
    case 'player': d.slots[idx].player_id = el.value ? Number(el.value) : null; break;
    case 'agent': d.slots[idx].agent_id = el.value ? Number(el.value) : null; break;
  }
  renderEditor(); // los desplegables dependen del jugador elegido
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
        <p class="hint">Vincula cada jugador a su cuenta para que pueda editar su propio agent pool.</p>
        <div class="table-scroll"><table class="admin-table">
          <thead><tr><th>Nombre</th><th>Cuenta</th><th>Orden</th><th></th></tr></thead>
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
    case 'close-modal': $('#modal').close(); S.draft = null; break;
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
  $('#modal').addEventListener('close', () => { S.draft = null; });

  render();
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  await Promise.all([loadProfile(), loadAgentImages()]);
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