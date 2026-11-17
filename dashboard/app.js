// Token Radar — the dashboard's page logic. No network, no framework.
//
// Reads window.RADAR (written by main.ts from the same board), renders the
// board, the filters, the detail drawer and the live-token table. The URL
// hash carries the state, so a view can be linked and screenshotted:
//   #detail=<slug>            open one protocol's detail drawer
//   #cat=<category>           filter the board to a category
//   #q=<text>                 search the board
//   #set=watchlist|early|all  pick a set of rows
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA || !Array.isArray(DATA.rows)) {
    document.getElementById('rows').innerHTML = '<tr><td colspan="8">No radar data was written. Run main.ts first.</td></tr>';
    return;
  }

  var $ = function (id) { return document.getElementById(id); };
  var state = { q: '', category: 'all', chain: 'all', set: 'all', sort: 'implied', detail: null };

  function money(n) {
    if (n === null || n === undefined) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days < 365) return days + 'd';
    var y = (days / 365).toFixed(1);
    return y + 'y';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'class') node.className = attrs[k];
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') node[k] = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      children.forEach(function (c) { if (c) node.appendChild(c); });
    }
    return node;
  }

  /** Split a farm step into its action and its cost/time tail. */
  function splitStep(step) {
    var i = step.indexOf(' Cost: ');
    if (i < 0) return { action: step, meta: '' };
    return { action: step.slice(0, i), meta: step.slice(i + 7) };
  }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    var parts = h ? h.split('&') : [];
    var out = {};
    parts.forEach(function (p) {
      var kv = p.split('=');
      if (kv.length === 2) out[kv[0]] = decodeURIComponent(kv[1]);
    });
    return out;
  }
  function writeHash() {
    var bits = [];
    if (state.q) bits.push('q=' + encodeURIComponent(state.q));
    if (state.category !== 'all') bits.push('cat=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') bits.push('chain=' + encodeURIComponent(state.chain));
    if (state.set !== 'all') bits.push('set=' + state.set);
    if (state.sort !== 'implied') bits.push('sort=' + state.sort);
    if (state.detail) bits.push('detail=' + encodeURIComponent(state.detail));
    var next = bits.length ? '#' + bits.join('&') : '#';
    if (window.location.hash !== next) history.replaceState(null, '', next);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.rows.filter(function (r) {
      if (state.set === 'watchlist' && !r.on_watchlist) return false;
      if (state.set === 'early' && r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d || 0) - (a.change_7d || 0);
      if (key === 'age') return (b.age_days || 0) - (a.age_days || 0);
      if (key === 'name') return a.name.localeCompare(b.name);
      return b.implied_value_usd - a.implied_value_usd;
    });
    return list;
  }

  function renderBoard() {
    var list = filteredRows();
    var tbody = $('rows');
    tbody.innerHTML = '';
    list.forEach(function (r) {
      var tr = el('tr', { 'data-slug': r.slug, tabindex: '0' });
      if (state.detail === r.slug) tr.className = 'sel';
      var change = r.change_7d;
      var cls = change === null ? 'flat' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
      tr.appendChild(el('td', { class: 'num', text: String(r.rank) }));
      var nameCell = el('td', { class: 'name' });
      nameCell.appendChild(el('b', { text: r.name + (r.on_watchlist ? ' ' : '') }));
      if (r.on_watchlist) nameCell.querySelector('b').appendChild(el('span', { class: 'badge watch', text: 'W' }));
      nameCell.appendChild(el('span', { text: r.slug }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { html: '<span class="cat">' + esc(r.category || 'Uncategorised') + '</span>' }));
      tr.appendChild(el('td', { html: '<span class="chains">' + esc(r.chains.slice(0, 3).join(', ') || '—') + '</span>' }));
      tr.appendChild(el('td', { class: 'num', text: money(r.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num ' + cls, text: pct(change) }));
      tr.appendChild(el('td', { class: 'num', text: ageText(r.age_days) }));
      tr.appendChild(el('td', { class: 'num implied', text: money(r.implied_value_usd) }));
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); }
      });
      tbody.appendChild(tr);
    });
    $('empty').hidden = list.length > 0;
    $('count').textContent = list.length + ' of ' + DATA.rows.length + ' protocols shown';
  }

  function renderLive() {
    var tbody = $('liveRows');
    tbody.innerHTML = '';
    DATA.live.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { class: 'name', html: '<b>' + esc(r.name) + '</b><span>' + esc(r.slug) + '</span>' }));
      tr.appendChild(el('td', { html: '<span class="cat">' + esc(r.category || 'Uncategorised') + '</span>' }));
      tr.appendChild(el('td', { class: 'num', text: money(r.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num', text: money(r.mcap_usd) }));
      tr.appendChild(el('td', { class: 'num', text: r.mcap_per_tvl === null ? '—' : r.mcap_per_tvl.toFixed(2) + '×' }));
      var change = r.change_7d;
      var cls = change === null ? 'flat' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
      tr.appendChild(el('td', { class: 'num ' + cls, text: pct(change) }));
      tbody.appendChild(tr);
    });
  }

  function renderModel() {
    var grid = $('modelGrid');
    grid.innerHTML = '';
    var items = [
      ['Category multiple', 'median mcap / TVL of live tokens in the category'],
      ['Growth factor', '1 + clamped 7-day change × 0.6'],
      ['Maturity factor', '0.70 → 1.00 over 4 years tracked'],
      ['Spread factor', '+3% per extra chain, up to 4'],
    ];
    items.forEach(function (it) {
      var d = el('div', { class: 'm' });
      d.appendChild(el('span', { text: it[0] }));
      d.appendChild(el('b', { text: it[1] }));
      grid.appendChild(d);
    });
    var cats = DATA.category_multiples.slice().sort(function (a, b) { return b.samples - a.samples; }).slice(0, 8);
    cats.forEach(function (c) {
      var d = el('div', { class: 'm' });
      d.appendChild(el('span', { text: c.category + ' (' + c.samples + ' live)' }));
      d.appendChild(el('b', { text: c.multiple.toFixed(2) + '×' }));
      grid.appendChild(d);
    });
    $('globalMult').textContent = DATA.global_multiple.toFixed(2) + '×';
  }

  function renderStats() {
    var stats = $('stats');
    stats.innerHTML = '';
    var top = DATA.rows[0];
    var items = [
      ['Protocols scanned', String(DATA.protocols_scanned), DATA.rows.length + ' ranked on the board'],
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'every one ranked'],
      ['Early finds', String(DATA.early_size), 'below the $50M floor'],
      ['Top implied value', money(top ? top.implied_value_usd : 0), top ? top.name : ''],
    ];
    items.forEach(function (it) {
      var d = el('div');
      d.appendChild(el('dt', { text: it[0] }));
      var dd = el('dd', { text: it[1] });
      if (it[2]) dd.appendChild(el('small', { text: ' ' + it[2] }));
      d.appendChild(dd);
      stats.appendChild(d);
    });
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.detail = slug;
    writeHash();
    renderBoard();
    var inner = $('detailInner');
    inner.innerHTML = '';
    inner.appendChild(el('button', { class: 'close', type: 'button', text: 'Close ×', onclick: closeDetail }));
    inner.appendChild(el('h2', { text: row.name }));
    inner.appendChild(el('p', { class: 'slug', text: '#' + row.rank + ' · ' + row.slug + ' · ' + (row.on_watchlist ? 'watchlist' : 'early find') }));
    row.chains.forEach(function (c) { inner.appendChild(el('span', { class: 'tag', text: c })); });
    inner.appendChild(el('span', { class: 'tag', text: row.category || 'Uncategorised' }));
    var kv = el('dl', { class: 'kv' });
    var facts = [
      ['Implied value', moneyFull(row.implied_value_usd), 'TVL × ' + row.category_multiple.toFixed(2) + '× × factors'],
      ['TVL', moneyFull(row.tvl_usd), '7-day change ' + pct(row.change_7d)],
      ['Age tracked', ageText(row.age_days), row.listed_at ? 'listed ' + row.listed_at : 'listing date not reported'],
      ['Category multiple', row.category_multiple.toFixed(2) + '×', 'median mcap / TVL of live ' + (row.category || 'tokens')],
    ];
    facts.forEach(function (f) {
      var d = el('div');
      d.appendChild(el('dt', { text: f[0] }));
      var dd = el('dd', { text: f[1] });
      dd.appendChild(el('small', { text: f[2] }));
      d.appendChild(dd);
      kv.appendChild(d);
    });
    inner.appendChild(kv);
    inner.appendChild(el('h3', { text: 'How the value breaks down' }));
    var bars = el('div', { class: 'bars' });
    var base = row.tvl_usd * row.category_multiple;
    var barItems = [
      ['TVL × category', base, row.tvl_usd, 'amber'],
      ['After growth ×' + row.growth_factor.toFixed(2), base * row.growth_factor, row.tvl_usd, 'sky'],
      ['After maturity ×' + row.maturity_factor.toFixed(2), base * row.growth_factor * row.maturity_factor, row.tvl_usd, ''],
      ['Implied value', row.implied_value_usd, row.tvl_usd, ''],
    ];
    var max = Math.max.apply(null, barItems.map(function (b) { return b[1]; }));
    barItems.forEach(function (b) {
      var r = el('div', { class: 'bar-row' });
      r.appendChild(el('span', { class: 'lbl', text: b[0] }));
      var bar = el('div', { class: 'bar' });
      var fill = el('i', { class: b[3] || '' });
      fill.style.width = Math.max(2, Math.round((b[1] / max) * 100)) + '%';
      bar.appendChild(fill);
      r.appendChild(bar);
      r.appendChild(el('span', { class: 'val', text: money(b[1]) }));
      bars.appendChild(r);
    });
    inner.appendChild(bars);
    inner.appendChild(el('h3', { text: 'Farm plan — what to do, what it costs, how long it takes' }));
    var ol = el('ol', { class: 'steps' });
    row.farm_steps.forEach(function (s) {
      var part = splitStep(s);
      var li = el('li');
      li.appendChild(document.createTextNode(part.action + ' '));
      if (part.meta) li.appendChild(el('span', { class: 'meta', text: part.meta }));
      ol.appendChild(li);
    });
    inner.appendChild(ol);
    inner.appendChild(el('p', { class: 'fine', text: 'This protocol records no token — that is DefiLlama\u2019s record, not proof it has none. The implied value is this radar\u2019s own claim.' }));
    $('detail').hidden = false;
  }

  function closeDetail() {
    state.detail = null;
    writeHash();
    $('detail').hidden = true;
    renderBoard();
  }

  function fillSelect(id, values) {
    var sel = $(id);
    sel.innerHTML = '';
    values.forEach(function (v) {
      var opt = el('option', { value: v[0], text: v[1] });
      sel.appendChild(opt);
    });
  }

  function init() {
    var cats = {};
    var chains = {};
    DATA.rows.forEach(function (r) {
      cats[r.category || 'Uncategorised'] = true;
      r.chains.forEach(function (c) { chains[c] = true; });
    });
    fillSelect('cat', [['all', 'All categories']].concat(Object.keys(cats).sort().map(function (c) { return [c, c]; })));
    fillSelect('chain', [['all', 'All chains']].concat(Object.keys(chains).sort().map(function (c) { return [c, c]; })));
    var h = readHash();
    if (h.q) state.q = h.q;
    if (h.cat) state.category = h.cat;
    if (h.chain) state.chain = h.chain;
    if (h.set) state.set = h.set;
    if (h.sort) state.sort = h.sort;
    $('q').value = state.q;
    $('cat').value = state.category;
    $('chain').value = state.chain;
    $('set').value = state.set;
    $('sort').value = state.sort;
    $('q').addEventListener('input', function () { state.q = $('q').value; writeHash(); renderBoard(); });
    $('cat').addEventListener('change', function () { state.category = $('cat').value; writeHash(); renderBoard(); });
    $('chain').addEventListener('change', function () { state.chain = $('chain').value; writeHash(); renderBoard(); });
    $('set').addEventListener('change', function () { state.set = $('set').value; writeHash(); renderBoard(); });
    $('sort').addEventListener('change', function () { state.sort = $('sort').value; writeHash(); renderBoard(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
    $('asOf').textContent = '· ' + DATA.as_of;
    $('source').textContent = DATA.source;
    $('modelVer').textContent = DATA.model_version;
    renderStats();
    renderModel();
    renderBoard();
    renderLive();
    if (h.detail) openDetail(h.detail);
  }

  init();
})();
