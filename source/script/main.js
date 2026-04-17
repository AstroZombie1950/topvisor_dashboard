/* ============================================================
   КОНФИГУРАЦИЯ ПРОЕКТОВ
   ============================================================ */
const PROJECTS = [
	{ name: 'DVS',           file: 'source/data/dvs.json'  },
	{ name: 'Kama',          file: 'source/data/kama.json' },
	{ name: 'AutoParts Pro', file: 'source/data/demo.json' }
];

const TOP_CFG = [
	{ key: '1_3',    lbl: '1-3',    cls: 'b13',    min: 1,   max: 3    },
	{ key: '1_10',   lbl: '1-10',   cls: 'b110',   min: 1,   max: 10   },
	{ key: '11_30',  lbl: '11-30',  cls: 'b1130',  min: 11,  max: 30   },
	{ key: '31_50',  lbl: '31-50',  cls: 'b3150',  min: 31,  max: 50   },
	{ key: '51_100', lbl: '51-100', cls: 'b51100', min: 51,  max: 100  },
	{ key: '100+',   lbl: '100+',   cls: 'b100p',  min: 101, max: 9999 }
];

const TAG_COLORS = ['#ef4444','#f59e0b','#22c55e','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316'];

/* ============================================================
   СОСТОЯНИЕ
   ============================================================ */
let rawData      = null;   // загруженный JSON
let activeSearch = 0;      // индекс поисковика
let activeRegion = 0;      // индекс региона
let activeDates  = [];     // индексы видимых колонок дат
let sortMode     = 'default';
let calRange     = { from: null, to: null };  // выбранный диапазон в календаре
let calViewYear  = 0;
let calViewMonth = 0;
let calPickStep  = 0;      // 0 = ждём первую дату, 1 = ждём вторую
let currentProjectIdx = 0;

/* Активные фильтры */
const F = {
	donut:    null,   // 'green'|'yellow'|'red'|null
	topRange: null,   // ключ диапазона или null
	onlyTop:  false,
	status:   [],     // ['found','notfound']
	dyn:      [],     // ['up','down','same']
	group:    null,   // id группы или null
	tag:      null    // id тега или null
};

/* Модалка назначения группы/тега */

/* ============================================================
   СТАРТ
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
	buildProjMenu();
	loadProject(0);

	/* Закрываем дропдауны по клику вне */
	document.addEventListener('click', e => {
		if (!e.target.closest('.tbi'))         closeAllTbi();
		if (!e.target.closest('.sort-wrap'))   document.getElementById('sortWrap').classList.remove('smopen');
		if (!e.target.closest('.filter-wrap')) document.getElementById('filterWrap').classList.remove('fmopen');
	});
});

/* ============================================================
   ПРОЕКТЫ
   ============================================================ */
function buildProjMenu() {
	const dd = document.getElementById('ddProject');
	dd.innerHTML = PROJECTS.map((p, i) =>
		`<div class="ddi" id="pi${i}" onclick="loadProject(${i});closeAllTbi()">
			<span class="dck">✓</span>${p.name}
		</div>`
	).join('');
}

function loadProject(idx) {
	currentProjectIdx = idx;
	fetch(PROJECTS[idx].file)
		.then(r => { if (!r.ok) throw new Error(PROJECTS[idx].file + ' не найден'); return r.json(); })
		.then(json => {
			/* Мёрж групп и тегов из localStorage */
			json = mergeLocalStorage(json, idx);
			rawData      = json;
			activeSearch = 0;
			activeRegion = 0;
			resetAll(false);
			activeDates  = regionData().dates.map((_, i) => i);
			renderAll();
			/* Подсветить текущий */
			PROJECTS.forEach((_, i) => document.getElementById('pi' + i).classList.toggle('ddi-active', i === idx));
			document.getElementById('lblProject').textContent = json.project;
		})
		.catch(e => alert('Ошибка загрузки: ' + e.message));
}

/* ============================================================
   localStorage — мёрж групп и тегов
   ============================================================ */
const LS_KEY = idx => `pos_groups_${PROJECTS[idx].file}`;

function mergeLocalStorage(json, idx) {
	try {
		const saved = JSON.parse(localStorage.getItem(LS_KEY(idx)) || '{}');
		if (saved.groups) json.groups = saved.groups;
		if (saved.tags)   json.tags   = saved.tags;
		/* Мёрж назначений запросов */
		if (saved.kwAssign) {
			json.searchers.forEach(s => s.regions.forEach(r => {
				r.keywords.forEach(kw => {
					const a = saved.kwAssign[kw.phrase];
					if (a) {
						if (a.group !== undefined) kw.group = a.group;
						if (a.tags  !== undefined) kw.tags  = a.tags;
					}
				});
			}));
		}
	} catch (_) {}
	return json;
}

function saveToLocalStorage() {
	if (!rawData) return;
	/* Собрать все назначения запросов */
	const kwAssign = {};
	rawData.searchers.forEach(s => s.regions.forEach(r => {
		r.keywords.forEach(kw => {
			kwAssign[kw.phrase] = { group: kw.group || null, tags: kw.tags || [] };
		});
	}));
	const payload = {
		groups:   rawData.groups || [],
		tags:     rawData.tags   || [],
		kwAssign
	};
	localStorage.setItem(LS_KEY(currentProjectIdx), JSON.stringify(payload));
}

/* ============================================================
   ВСПОМОГАТЕЛЬНЫЕ ГЕТТЕРЫ
   ============================================================ */
function searcherData() { return rawData.searchers[activeSearch]; }
function regionData()   { return searcherData().regions[activeRegion]; }

/* ============================================================
   РЕНДЕР ВСЕГО
   ============================================================ */
function renderAll() {
	const rd = regionData();
	document.getElementById('lblEngine').textContent = searcherData().name;
	document.getElementById('lblRegion').textContent = rd.name;
	document.getElementById('lblDates').textContent  = rd.date_range.from + ' — ' + rd.date_range.to;
	calRange = parseDateRange(rd.date_range.from, rd.date_range.to);

	renderSearcherDropdown();
	renderRegionDropdown();
	renderGroupDropdown();
	renderTagDropdown();
	renderDonut(rd.summary.donut);
	renderMetric('vis', 'Vis', rd.summary.visibility);
	renderMetric('avg', 'Avg', rd.summary.average);
	renderMetric('med', 'Med', rd.summary.median);
	renderTops(rd.summary.tops);
	renderTableHeader();
	buildDateColList();
	buildRows();
}

/* ============================================================
   ПОИСКОВИКИ
   ============================================================ */
function renderSearcherDropdown() {
	const dd = document.getElementById('ddEngine');
	dd.innerHTML = '<div class="ddh">Поисковая система</div>' +
		rawData.searchers.map((s, i) =>
			`<div class="ddi ${i === activeSearch ? 'ddi-active' : ''}" onclick="switchSearcher(${i})">
				<span class="dck">✓</span>${s.name}
			</div>`
		).join('');
}

function switchSearcher(idx) {
	activeSearch = idx;
	activeRegion = 0;
	activeDates  = regionData().dates.map((_, i) => i);
	closeAllTbi();
	renderAll();
}

/* ============================================================
   РЕГИОНЫ
   ============================================================ */
function renderRegionDropdown() {
	const regions = searcherData().regions;
	const dd = document.getElementById('ddRegion');
	dd.innerHTML = '<div class="ddh">Регион</div>' +
		regions.map((r, i) =>
			`<div class="ddi ${i === activeRegion ? 'ddi-active' : ''}" onclick="switchRegion(${i})">
				<span class="dck">✓</span>${r.name}
			</div>`
		).join('');
}

function switchRegion(idx) {
	activeRegion = idx;
	activeDates  = regionData().dates.map((_, i) => i);
	closeAllTbi();
	renderAll();
}

/* ============================================================
   ГРУППЫ
   ============================================================ */
function renderGroupDropdown() {
	const groups = rawData.groups || [];
	const dd = document.getElementById('ddGroups');
	const activeId = F.group;

	const items = [
		`<div class="dd-manage-item ${!activeId ? 'active' : ''}" onclick="filterByGroup(null)">
			<span class="dck">✓</span> Все группы
		</div>`,
		...groups.map(g =>
			`<div class="dd-manage-item ${activeId === g.id ? 'active' : ''}">
				<span class="dck">✓</span>
				<span onclick="filterByGroup('${g.id}')" style="flex:1;cursor:pointer">${esc(g.name)}</span>
				<span class="item-del" onclick="deleteGroup('${g.id}')" title="Удалить">×</span>
			</div>`
		)
	];

	dd.innerHTML = `
		<div class="dd-manage">
			<div class="ddh" style="padding:0 0 8px">Группы запросов</div>
			<div class="dd-manage-list" id="groupList">${items.join('')}</div>
			<div class="ddd"></div>
			<div class="dd-add-row">
				<input class="dd-add-input" id="newGroupInput" placeholder="Название группы" onkeydown="if(event.key==='Enter')addGroup()">
				<button class="dd-add-btn" onclick="addGroup()">+</button>
			</div>
			<div class="ls-note">💾 Группы хранятся в браузере (localStorage) и не зависят от JSON-файла</div>
		</div>`;
}

function filterByGroup(id) {
	F.group = id;
	renderGroupDropdown();
	closeAllTbi();
	applyFilters();
}

function addGroup() {
	const inp = document.getElementById('newGroupInput');
	const name = inp.value.trim();
	if (!name) return;
	if (!rawData.groups) rawData.groups = [];
	const id = 'g' + Date.now();
	rawData.groups.push({ id, name });
	inp.value = '';
	saveToLocalStorage();
	renderGroupDropdown();
}

function deleteGroup(id) {
	rawData.groups = rawData.groups.filter(g => g.id !== id);
	/* Снять у запросов эту группу */
	rawData.searchers.forEach(s => s.regions.forEach(r => {
		r.keywords.forEach(kw => { if (kw.group === id) kw.group = null; });
	}));
	if (F.group === id) F.group = null;
	saveToLocalStorage();
	renderGroupDropdown();
	buildRows();
}

/* ============================================================
   ТЕГИ
   ============================================================ */
let newTagColor = TAG_COLORS[0];

function renderTagDropdown() {
	const tags = rawData.tags || [];
	const dd = document.getElementById('ddTags');
	const activeId = F.tag;

	const items = [
		`<div class="dd-manage-item ${!activeId ? 'active' : ''}" onclick="filterByTag(null)">
			<span class="dck">✓</span> Все теги
		</div>`,
		...tags.map(t =>
			`<div class="dd-manage-item ${activeId === t.id ? 'active' : ''}">
				<span class="dck">✓</span>
				<span class="tag-color-dot" style="background:${t.color}"></span>
				<span onclick="filterByTag('${t.id}')" style="flex:1;cursor:pointer">${esc(t.name)}</span>
				<span class="item-del" onclick="deleteTag('${t.id}')" title="Удалить">×</span>
			</div>`
		)
	];

	const colorOpts = TAG_COLORS.map(c =>
		`<span class="color-opt ${c === newTagColor ? 'selected' : ''}"
			style="background:${c}" onclick="selectTagColor('${c}')"></span>`
	).join('');

	dd.innerHTML = `
		<div class="dd-manage">
			<div class="ddh" style="padding:0 0 8px">Теги</div>
			<div class="dd-manage-list" id="tagList">${items.join('')}</div>
			<div class="ddd"></div>
			<div class="color-picker-row" id="colorPicker">${colorOpts}</div>
			<div class="dd-add-row">
				<input class="dd-add-input" id="newTagInput" placeholder="Название тега" onkeydown="if(event.key==='Enter')addTag()">
				<button class="dd-add-btn" onclick="addTag()">+</button>
			</div>
			<div class="ls-note">💾 Теги хранятся в браузере (localStorage) и не зависят от JSON-файла</div>
		</div>`;
}

function selectTagColor(c) {
	newTagColor = c;
	document.querySelectorAll('.color-opt').forEach(el => {
		el.classList.toggle('selected', el.style.background === c || el.style.backgroundColor === c);
	});
}

function filterByTag(id) {
	F.tag = id;
	renderTagDropdown();
	closeAllTbi();
	applyFilters();
}

function addTag() {
	const inp = document.getElementById('newTagInput');
	const name = inp.value.trim();
	if (!name) return;
	if (!rawData.tags) rawData.tags = [];
	const id = 't' + Date.now();
	rawData.tags.push({ id, name, color: newTagColor });
	inp.value = '';
	saveToLocalStorage();
	renderTagDropdown();
}

function deleteTag(id) {
	rawData.tags = rawData.tags.filter(t => t.id !== id);
	rawData.searchers.forEach(s => s.regions.forEach(r => {
		r.keywords.forEach(kw => {
			if (kw.tags) kw.tags = kw.tags.filter(tid => tid !== id);
		});
	}));
	if (F.tag === id) F.tag = null;
	saveToLocalStorage();
	renderTagDropdown();
	buildRows();
}

/* ============================================================
   ДОНУТ
   ============================================================ */
function renderDonut(d) {
	const total = (d.green.count + d.yellow.count + d.red.count) || 1;
	const cx = 32, cy = 32, r = 26, sw = 10, circ = 2 * Math.PI * r;
	const segs = [
		{ key: 'green',  cnt: d.green.count,  pct: d.green.percent,  color: '#22c55e', sym: '▲' },
		{ key: 'yellow', cnt: d.yellow.count, pct: d.yellow.percent, color: '#f59e0b', sym: '●' },
		{ key: 'red',    cnt: d.red.count,    pct: d.red.percent,    color: '#ef4444', sym: '▼' }
	];
	const isEmpty = segs.every(s => s.cnt === 0);
	let off = 0;
	const arcs = isEmpty
		? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e2e8ed" stroke-width="${sw}"/>`
		: segs.map(s => {
			const len = (s.cnt / total) * circ;
			const isOn = F.donut === s.key;
			const arc = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
				stroke="${s.color}" stroke-width="${sw}"
				stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-off}"
				transform="rotate(-90 ${cx} ${cy})"
				opacity="${F.donut && !isOn ? 0.2 : 1}"
				style="cursor:pointer" onclick="toggleDonut('${s.key}')"/>`;
			off += len; return arc;
		}).join('');

	document.getElementById('donutSvg').innerHTML = arcs;
	document.getElementById('donutLegend').innerHTML = segs.map(s => {
		const isOn = F.donut === s.key;
		/* SVG-иконки в кружочке для каждого типа */
		const iconSvg = {
			green:  `<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.5" fill="${s.color}"/><path d="M5 9.5L8 6l3 3.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
			yellow: `<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.5" fill="${s.color}"/><path d="M5 8h6" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`,
			red:    `<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.5" fill="${s.color}"/><path d="M5 6.5L8 10l3-3.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`
		};
		return `<div class="leg-item ${isOn ? 'leg-on' : ''}" style="color:${s.color}" onclick="toggleDonut('${s.key}')">
			${iconSvg[s.key]}
			<span class="leg-cnt">${s.cnt}</span>
			<span class="leg-pct">${s.pct}%</span>
		</div>`;
	}).join('');
}

function toggleDonut(key) {
	F.donut = (F.donut === key) ? null : key;
	renderDonut(regionData().summary.donut);
	applyFilters();
}

/* ============================================================
   МЕТРИКИ + SPARKLINE
   ============================================================ */
function renderMetric(id, cap, m) {
	const dEl = document.getElementById(id + 'Delta');
	if (m.delta != null) {
		dEl.textContent = (m.delta > 0 ? '+' : '') + m.delta;
		dEl.className   = 'metric-delta ' + (m.delta > 0 ? 'pos' : 'neg');
	} else {
		dEl.textContent = '—';
		dEl.className   = 'metric-delta';
	}
	document.getElementById(id + 'Val').textContent = m.value ?? '—';
	drawSpk(document.getElementById('spk' + cap), m.sparkline);
}

function drawSpk(el, pts) {
	if (!el || !pts?.length) return;
	const W = 110, H = 30, P = 3;
	const mn = Math.min(...pts), mx = Math.max(...pts), rng = mx - mn || 1;
	const cs = pts.map((v, i) => ({
		x: P + (i / (pts.length - 1)) * (W - 2 * P),
		y: H - P - ((v - mn) / rng) * (H - 2 * P)
	}));
	el.innerHTML = `
		<polyline points="${cs.map(c => c.x + ',' + c.y).join(' ')}"
			fill="none" stroke="#93c5fd" stroke-width="1.5" stroke-linejoin="round"/>
		${cs.map(c => `<circle cx="${c.x}" cy="${c.y}" r="2" fill="#3b82f6"/>`).join('')}`;
}

/* ============================================================
   ТОПЫ
   ============================================================ */
function renderTops(tops) {
	/* Две колонки по 3 ряда — как в референсе */
	const col1 = TOP_CFG.slice(0, 3); /* 1-3, 1-10, 11-30 */
	const col2 = TOP_CFG.slice(3);    /* 31-50, 51-100, 100+ */

	const makeCol = cfg => cfg.map(c => {
		const t    = tops[c.key];
		const isOn = F.topRange === c.key;
		const d    = t.delta != null
			? `<span class="badge-dlt ${t.delta > 0 ? 'pos' : t.delta < 0 ? 'neg' : ''}">${t.delta > 0 ? '+' : ''}${t.delta !== 0 ? t.delta : '—'}</span>`
			: `<span class="badge-dlt" style="color:var(--muted)">—</span>`;
		return `<div class="top-badge ${isOn ? 'tbadge-on' : ''}" onclick="toggleTopRange('${c.key}')">
			<span class="badge-lbl ${c.cls}">${c.lbl}</span>
			<span class="badge-pct">${t.percent}%</span>
			<span class="badge-cnt">${t.count}</span>
			${d}
		</div>`;
	}).join('');

	document.getElementById('topsWrap').innerHTML =
		`<div class="tops-col">${makeCol(col1)}</div><div class="tops-col">${makeCol(col2)}</div>`;
}

function toggleTopRange(key) {
	F.topRange = (F.topRange === key) ? null : key;
	renderTops(regionData().summary.tops);
	applyFilters();
}

/* ============================================================
   ЗАГОЛОВОК ТАБЛИЦЫ
   ============================================================ */
function renderTableHeader() {
	const tr = document.querySelector('#posTable thead tr');
	while (tr.children.length > 3) tr.removeChild(tr.lastChild);
	regionData().dates.forEach((d, i) => {
		const th = document.createElement('th');
		th.className  = 'thd';
		th.dataset.di = i;
		const p = regionData().dates_top10_percent?.[i];
		th.innerHTML  = `${d}<br><span class="thsub">1-10</span> <span class="thpct">${p != null ? p + '%' : ''}</span>`;
		tr.appendChild(th);
	});
}

/* ============================================================
   СПИСОК ДАТ В ДРОПДАУНЕ ДАТ
   ============================================================ */
function buildDateColList() {
	const rd = regionData();
	document.getElementById('dateColList').innerHTML = rd.dates.map((d, i) =>
		`<label class="dci">
			<input type="checkbox" ${activeDates.includes(i) ? 'checked' : ''} data-di="${i}" onchange="syncDates()"> ${d}
		</label>`
	).join('');
}

function syncDates() {
	activeDates = [...document.querySelectorAll('#dateColList input:checked')].map(c => +c.dataset.di);
	applyDateVis();
}
function selectAllDates()  { document.querySelectorAll('#dateColList input').forEach(c => c.checked = true);  syncDates(); }
function selectLastN(n)    { document.querySelectorAll('#dateColList input').forEach((c, i) => c.checked = i < n); syncDates(); }
function applyDateFilter() { syncDates(); closeAllTbi(); }

function applyDateVis() {
	document.querySelectorAll('th.thd').forEach(th =>
		th.style.display = activeDates.includes(+th.dataset.di) ? '' : 'none'
	);
	document.querySelectorAll('#tbody tr').forEach(row =>
		[...row.querySelectorAll('td.tdpos')].forEach((td, i) =>
			td.style.display = activeDates.includes(i) ? '' : 'none'
		)
	);
	updateResetBtn();
}

/* ============================================================
   СТРОКИ ТАБЛИЦЫ
   ============================================================ */
function buildRows() {
	const rd   = regionData();
	let kws    = [...rd.keywords];
	const tags = rawData.tags   || [];
	const grps = rawData.groups || [];

	/* Сортировка */
	if      (sortMode === 'name-az')   kws.sort((a, b) => a.phrase.localeCompare(b.phrase, 'ru'));
	else if (sortMode === 'name-za')   kws.sort((a, b) => b.phrase.localeCompare(a.phrase, 'ru'));
	else if (sortMode === 'freq-desc') kws.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
	else if (sortMode === 'freq-asc')  kws.sort((a, b) => (a.frequency || 0) - (b.frequency || 0));
	else if (sortMode === 'pos-asc')   kws.sort((a, b) => (fp(a) || 999) - (fp(b) || 999));
	else if (sortMode === 'pos-desc')  kws.sort((a, b) => (fp(b) || 0)   - (fp(a) || 0));

	document.getElementById('tbody').innerHTML = kws.map((k, origIdx) =>
		rowHtml(k, origIdx, rd.dates.length, grps, tags)
	).join('');

	applyDateVis();
	applyFilters();
}

function fp(k) { return k.positions?.find(p => p !== null) ?? null; }

function rowHtml(k, origIdx, datesCount, grps, tags) {
	const freq  = k.frequency ?? '—';
	const p0    = k.positions?.[0] ?? null;
	const d0    = k.deltas?.[0]    ?? 0;
	const dyn   = d0 > 0 ? 'up' : d0 < 0 ? 'down' : 'same';
	const hasPos = k.positions?.some(p => p !== null && p !== undefined);
	const p0attr = p0 ?? 9999;

	/* Ячейки позиций */
	const cells = Array.from({ length: datesCount }, (_, i) => {
		const p = k.positions?.[i] ?? null;
		const d = k.deltas?.[i]    ?? 0;
		if (p === null || p === undefined)
			return `<td class="tdpos"><div class="pos-cell nf">--</div></td>`;
		const dh = (d && d !== 0)
			? `<span class="pdlt ${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : ''}${d}</span>` : '';
		return `<td class="tdpos"><div class="pos-cell ${pc(p, d)}">${p}${dh}</div></td>`;
	}).join('');

	/* Группа */
	const grpObj  = grps.find(g => g.id === k.group);
	const phraseAttr = esc(k.phrase).replace(/'/g, '&#39;');
	const grpHtml = grpObj
		? `<span class="grp-badge" onclick="openModalByPhrase('${phraseAttr}')" title="Изменить">${esc(grpObj.name)}</span>`
		: `<span style="color:var(--muted);cursor:pointer;font-size:12px" onclick="openModalByPhrase('${phraseAttr}')">+ группа</span>`;

	/* Теги-точки */
	const kwTags  = (k.tags || []).map(tid => tags.find(t => t.id === tid)).filter(Boolean);
	const tagsHtml = kwTags.length
		? kwTags.map(t => `<span class="tag-dot" style="background:${t.color}" title="${esc(t.name)}"></span>`).join('')
		: `<span style="color:var(--muted);cursor:pointer;font-size:11px" onclick="openModalByPhrase('${phraseAttr}')">+</span>`;

	return `<tr data-dyn="${dyn}" data-status="${hasPos ? 'found' : 'notfound'}" data-p0="${p0attr}" data-grp="${k.group || ''}" data-tags="${(k.tags || []).join(',')}">
		<td class="tdi">—</td>
		<td class="tdp">${esc(k.phrase)}</td>
		<td class="tdf">${freq}</td>
		${cells}
	</tr>`;
}

function pc(p, d) {
	/* Не найдено — обрабатывается отдельно */
	if (p === null || p === undefined) return '';

	/* Цвет по дельте */
	if (d > 3)  return 'pd-up3';
	if (d >= 2) return 'pd-up2';
	if (d === 1) return 'pd-up1';
	if (d < -3) return 'pd-dn3';
	if (d <= -2) return 'pd-dn2';
	if (d === -1) return 'pd-dn1';

	/* Дельта = 0 — цвет по диапазону */
	if (p <= 10) return 'pt1'; /* все топ-10 один голубой */
	return 'pnone';
}

/* ============================================================
   ФИЛЬТРАЦИЯ
   ============================================================ */
function applyFilters() {
	const q      = document.getElementById('searchInput').value.toLowerCase();
	const fStatus = [...document.querySelectorAll('.fchip[data-fs].fchip-on')].map(c => c.dataset.fs);
	const fDyn    = [...document.querySelectorAll('.fchip[data-fd].fchip-on')].map(c => c.dataset.fd);
	const rows    = document.querySelectorAll('#tbody tr');
	let vis = 0;

	rows.forEach(row => {
		const phrase = row.querySelector('.tdp')?.textContent.toLowerCase() || '';
		const dyn    = row.dataset.dyn;
		const status = row.dataset.status;
		const p0     = +row.dataset.p0;
		const grp    = row.dataset.grp;
		const rowTags= row.dataset.tags ? row.dataset.tags.split(',').filter(Boolean) : [];

		let show = phrase.includes(q);

		/* Фильтр донута */
		if (show && F.donut) {
			if (F.donut === 'green'  && p0 > 10)              show = false;
			if (F.donut === 'yellow' && (p0 <= 10 || p0 > 100)) show = false;
			if (F.donut === 'red'    && p0 <= 100)             show = false;
		}
		/* Фильтр топ-диапазона */
		if (show && F.topRange) {
			const c = TOP_CFG.find(x => x.key === F.topRange);
			if (c && (p0 < c.min || p0 > c.max)) show = false;
		}
		/* Только топ-100 */
		if (show && F.onlyTop && p0 > 100) show = false;
		/* Чипы статуса и динамики */
		if (show && fStatus.length && !fStatus.includes(status)) show = false;
		if (show && fDyn.length    && !fDyn.includes(dyn))       show = false;
		/* Группа */
		if (show && F.group && grp !== F.group) show = false;
		/* Тег */
		if (show && F.tag && !rowTags.includes(F.tag)) show = false;

		row.style.display = show ? '' : 'none';
		if (show) vis++;
	});

	document.getElementById('emptyState').style.display = vis === 0 ? 'block' : 'none';
	document.getElementById('kwCount').textContent = `(${vis}/${regionData().keywords.length})`;
	updateResetBtn();
}

function toggleChip(el) {
	el.classList.toggle('fchip-on');
	updateFBadge();
}
function updateFBadge() {
	const n = document.querySelectorAll('.fchip.fchip-on').length;
	const b = document.getElementById('filterBadge');
	b.style.display = n ? 'inline' : 'none';
	b.textContent   = n;
}

/* ============================================================
   СБРОС
   ============================================================ */
function resetAll(rerender = true) {
	Object.assign(F, { donut: null, topRange: null, onlyTop: false, status: [], dyn: [], group: null, tag: null });
	document.getElementById('searchInput').value = '';
	document.querySelectorAll('.fchip').forEach(c => c.classList.remove('fchip-on'));
	const onlyTopBtn = document.getElementById('onlyTopBtn');
	if (onlyTopBtn) onlyTopBtn.classList.remove('tbtn-on');
	document.getElementById('filterBadge').style.display = 'none';
	if (rerender && rawData) {
		activeDates = regionData().dates.map((_, i) => i);
		selectAllDates();
		renderDonut(regionData().summary.donut);
		renderTops(regionData().summary.tops);
		buildRows();
	}
	updateResetBtn();
}

function updateResetBtn() {
	const fChips = document.querySelectorAll('.fchip.fchip-on').length;
	const active = F.donut || F.topRange || F.onlyTop || fChips || F.group || F.tag
		|| document.getElementById('searchInput').value
		|| (rawData && activeDates.length < regionData().dates.length);
	document.getElementById('resetBtn').style.display = active ? '' : 'none';
}

/* ============================================================
   СОРТИРОВКА
   ============================================================ */
function toggleSort() { document.getElementById('sortWrap').classList.toggle('smopen'); }

function setSort(el) {
	event.stopPropagation();
	sortMode = el.dataset.s;
	document.querySelectorAll('.smi').forEach(s => s.classList.remove('smi-on'));
	el.classList.add('smi-on');
	document.getElementById('sortWrap').classList.remove('smopen');
	buildRows();
}

function toggleFilterMenu() { document.getElementById('filterWrap').classList.toggle('fmopen'); }

function toggleOnlyTop() {
	F.onlyTop = !F.onlyTop;
	const onlyTopBtn = document.getElementById('onlyTopBtn');
	if (onlyTopBtn) onlyTopBtn.classList.toggle('tbtn-on', F.onlyTop);
	applyFilters();
}

/* ============================================================
   МОДАЛКА — НАЗНАЧЕНИЕ ГРУППЫ И ТЕГОВ
   ============================================================ */
let modalPhrase = null;

function openModalByPhrase(phrase) {
	const kw = regionData().keywords.find(k => k.phrase === phrase);
	if (!kw) return;
	modalPhrase = phrase;
	const grps = rawData.groups || [];
	const tags = rawData.tags   || [];

	document.getElementById('modalPhrase').textContent = kw.phrase;

	document.getElementById('modalGroups').innerHTML = [
		`<label class="modal-opt ${!kw.group ? 'mopt-on' : ''}">
			<input type="radio" name="mgr" value="" ${!kw.group ? 'checked' : ''}> Без группы
		</label>`,
		...grps.map(g =>
			`<label class="modal-opt ${kw.group === g.id ? 'mopt-on' : ''}">
				<input type="radio" name="mgr" value="${g.id}" ${kw.group === g.id ? 'checked' : ''}> ${esc(g.name)}
			</label>`
		)
	].join('') || '<div style="color:var(--muted);font-size:12px;padding:4px 0">Группы не созданы</div>';

	document.getElementById('modalTags').innerHTML = tags.map(t => {
		const checked = (kw.tags || []).includes(t.id);
		return `<label class="modal-opt ${checked ? 'mopt-on' : ''}">
			<input type="checkbox" name="mtg" value="${t.id}" ${checked ? 'checked' : ''}>
			<span class="tag-color-dot" style="background:${t.color}"></span>${esc(t.name)}
		</label>`;
	}).join('') || '<div style="color:var(--muted);font-size:12px;padding:4px 0">Теги не созданы</div>';

	document.querySelectorAll('#modalGroups .modal-opt input').forEach(inp => {
		inp.addEventListener('change', () => {
			document.querySelectorAll('#modalGroups .modal-opt').forEach(o => o.classList.remove('mopt-on'));
			inp.closest('.modal-opt').classList.add('mopt-on');
		});
	});
	document.querySelectorAll('#modalTags .modal-opt input').forEach(inp => {
		inp.addEventListener('change', () => inp.closest('.modal-opt').classList.toggle('mopt-on', inp.checked));
	});

	document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
	document.getElementById('modalOverlay').classList.remove('open');
	modalPhrase = null;
}

function saveModal() {
	if (!modalPhrase) return;
	const kw = regionData().keywords.find(k => k.phrase === modalPhrase);
	if (!kw) return;

	/* Группа */
	const gr = document.querySelector('input[name="mgr"]:checked');
	kw.group = gr ? (gr.value || null) : null;

	/* Теги */
	kw.tags = [...document.querySelectorAll('input[name="mtg"]:checked')].map(i => i.value);

	closeModal();
	saveToLocalStorage();
	buildRows();
}

/* ============================================================
   КАЛЕНДАРЬ
   ============================================================ */
const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь',
	'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DAYS_RU = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function openCalendar() {
	closeAllTbi();
	const now = new Date();
	calViewYear  = now.getFullYear();
	calViewMonth = now.getMonth(); // 0-based, показываем текущий в третьей колонке
	calPickStep  = 0;
	renderCalendar();
	document.getElementById('calOverlay').classList.add('open');
}

function closeCalendar() {
	document.getElementById('calOverlay').classList.remove('open');
}

function calNavMonth(delta) {
	calViewMonth += delta;
	if (calViewMonth > 11) { calViewMonth -= 12; calViewYear++; }
	if (calViewMonth < 0)  { calViewMonth += 12; calViewYear--; }
	renderCalendar();
}

function renderCalendar() {
	const rd = regionData();
	const checkDates = new Set(rd.check_dates || []);
	const serpDates  = new Set(rd.serp_changes || []);

	/* Рисуем 3 месяца: -2, -1, 0 относительно calViewMonth */
	const container = document.getElementById('calMonths');
	container.innerHTML = '';

	for (let offset = -2; offset <= 0; offset++) {
		let m = calViewMonth + offset;
		let y = calViewYear;
		while (m < 0)  { m += 12; y--; }
		while (m > 11) { m -= 12; y++; }
		container.appendChild(renderMonth(y, m, checkDates, serpDates, offset === -2, offset === 0));
	}
}

function renderMonth(year, month, checkDates, serpDates, showPrev, showNext) {
	const div = document.createElement('div');
	div.className = 'cal-month';

	/* Заголовок */
	const head = document.createElement('div');
	head.className = 'cal-month-head';
	head.innerHTML = `
		<span class="cal-nav ${showPrev ? '' : 'invisible'}" onclick="calNavMonth(-1)">‹</span>
		<span>${MONTHS_RU[month]} ${year}</span>
		<span class="cal-nav ${showNext ? '' : 'invisible'}" onclick="calNavMonth(1)">›</span>`;
	div.appendChild(head);

	/* Сетка */
	const grid = document.createElement('div');
	grid.className = 'cal-grid';

	/* Заголовки дней */
	DAYS_RU.forEach(d => {
		const el = document.createElement('div');
		el.className = 'cal-dow';
		el.textContent = d;
		grid.appendChild(el);
	});

	/* Первый день месяца (0=вс, 1=пн...) — приводим к понедельнику */
	const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
	for (let i = 0; i < firstDow; i++) {
		const el = document.createElement('div');
		el.className = 'cal-day cd-empty';
		grid.appendChild(el);
	}

	const daysInMonth = new Date(year, month + 1, 0).getDate();
	const today = new Date();

	for (let day = 1; day <= daysInMonth; day++) {
		const dateStr = formatDate(year, month + 1, day);
		const el = document.createElement('div');
		el.className = 'cal-day';

		/* Сегодня */
		if (year === today.getFullYear() && month === today.getMonth() && day === today.getDate())
			el.classList.add('cd-today');

		/* Range-подсветка */
		const ts = new Date(year, month, day).getTime();
		const f  = calRange.from ? parseDMY(calRange.from).getTime() : null;
		const t  = calRange.to   ? parseDMY(calRange.to).getTime()   : null;
		if (f && t) {
			if (ts === f && ts === t) el.classList.add('cd-range-start', 'cd-range-end');
			else if (ts === f)        el.classList.add('cd-range-start');
			else if (ts === t)        el.classList.add('cd-range-end');
			else if (ts > f && ts < t) el.classList.add('cd-in-range');
		} else if (f && ts === f) {
			el.classList.add('cd-range-start');
		}

		const num = document.createElement('div');
		num.textContent = day;
		el.appendChild(num);

		/* Точки */
		const hasCk   = checkDates.has(dateStr);
		const hasSrp  = serpDates.has(dateStr);
		if (hasCk || hasSrp) {
			const dots = document.createElement('div');
			dots.className = 'cal-day-dots';
			if (hasCk)  dots.innerHTML += '<span class="cd-dot cd-dot-check"></span>';
			if (hasSrp) dots.innerHTML += '<span class="cd-dot cd-dot-serp"></span>';
			el.appendChild(dots);
		}

		el.addEventListener('click', () => calDayClick(dateStr));
		grid.appendChild(el);
	}

	div.appendChild(grid);
	return div;
}

function calDayClick(dateStr) {
	if (calPickStep === 0) {
		calRange.from = dateStr;
		calRange.to   = null;
		calPickStep   = 1;
	} else {
		const f = parseDMY(calRange.from).getTime();
		const t = parseDMY(dateStr).getTime();
		if (t < f) { calRange.from = dateStr; calRange.to = calRange.from; }
		else        { calRange.to   = dateStr; }
		calPickStep = 0;
	}
	renderCalendar();
}

function applyCalendar() {
	if (!calRange.from || !calRange.to) { alert('Выберите диапазон дат'); return; }
	/* Фильтрация колонок по попаданию в диапазон */
	const rd   = regionData();
	const from = parseDMY(calRange.from).getTime();
	const to   = parseDMY(calRange.to).getTime();
	activeDates = rd.dates.map((d, i) => {
		const ts = parseDMY(d).getTime();
		return (ts >= from && ts <= to) ? i : null;
	}).filter(i => i !== null);
	if (!activeDates.length) activeDates = rd.dates.map((_, i) => i);
	applyDateVis();
	/* Синхронизировать чекбоксы */
	document.querySelectorAll('#dateColList input').forEach((c, i) => c.checked = activeDates.includes(i));
	closeCalendar();
	/* Обновить лейбл */
	document.getElementById('lblDates').textContent = calRange.from + ' — ' + calRange.to;
}

/* Пресеты */
function calPreset(type) {
	document.querySelectorAll('.cal-preset').forEach(el => el.classList.remove('cp-on'));
	event.target.classList.add('cp-on');
	const now = new Date();
	const fmt  = d => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
	let from, to = fmt(now);
	if (type === 'year')   { const d = new Date(now); d.setFullYear(d.getFullYear()-1); from = fmt(d); }
	if (type === 'prevmo') {
		const f = new Date(now.getFullYear(), now.getMonth()-1, 1);
		const t = new Date(now.getFullYear(), now.getMonth(), 0);
		from = fmt(f); to = fmt(t);
	}
	if (type === 'curmo')  { from = fmt(new Date(now.getFullYear(), now.getMonth(), 1)); }
	if (type === '1mo')    { const d = new Date(now); d.setMonth(d.getMonth()-1); from = fmt(d); }
	if (type === '1wk')    { const d = new Date(now); d.setDate(d.getDate()-7); from = fmt(d); }
	if (type === 'custom') { calRange = { from: null, to: null }; renderCalendar(); return; }
	calRange = { from, to };
	renderCalendar();
}

/* ============================================================
   УТИЛИТЫ — ДАТЫ
   ============================================================ */
function parseDMY(str) {
	/* DD.MM.YYYY */
	const [d, m, y] = str.split('.').map(Number);
	return new Date(y, m - 1, d);
}
function formatDate(y, m, d) {
	return `${String(d).padStart(2,'0')}.${String(m).padStart(2,'0')}.${y}`;
}
function parseDateRange(fromStr, toStr) {
	return { from: fromStr, to: toStr };
}

/* ============================================================
   ТОПБАР ДРОПДАУНЫ
   ============================================================ */
function toggleTbi(id) {
	const el = document.getElementById(id);
	const was = el.classList.contains('tbi-open');
	closeAllTbi();
	if (!was) el.classList.add('tbi-open');
}
function closeAllTbi() {
	document.querySelectorAll('.tbi').forEach(e => e.classList.remove('tbi-open'));
}

/* ============================================================
   УТИЛИТЫ
   ============================================================ */
function esc(s) {
	return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}