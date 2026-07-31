// ==UserScript==
// @name         LS Theme — Replace Landing With Embedded Code Searcher
// @namespace    ethan.tools
// @description  Replaces the theme landing page (wall/desk) with the embedded Code Searcher UI inside #editor_content
// @match        https://*/admin/themes/*
// @match        https://*.webshopapp.com/admin/themes/*
// @match        https://*.shoplightspeed.com/admin/themes/*
// @exclude      https://*/admin/themes/*/templates.json
// @grant        none
// @version      1.0
// ==/UserScript==

(function () {
  'use strict';

  const onReady = (fn) => (document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', fn, { once: true })
    : fn());

  onReady(() => {
    // Only on /admin/themes/{id}
    const m = location.pathname.match(/\/admin\/themes\/(\d+)(?:$|[/?#])/);
    if (!m) return;
    const themeId = m[1];

    // Find the landing block inside the editor_content and replace it
    const landing = document.querySelector('#editor_content .theme-landing-page');
    if (!landing) return;

    // ---------- styles (glassy iOS-like, light, no background) ----------
    const styles = `
      .tm-slot { padding: 24px 0 40px; }
      .tm-card {
        background: rgba(255,255,255,0.72);
        border: 1px solid rgba(255,255,255,0.6);
        border-radius: 16px;
        box-shadow: 0 18px 40px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.4);
        backdrop-filter: blur(16px) saturate(120%);
        -webkit-backdrop-filter: blur(16px) saturate(120%);
      }
      .tm-header {
        display:flex; gap:10px; align-items:center; flex-wrap:wrap;
        padding:16px; position:sticky; top:0; z-index:2;
      }
      .tm-title {
        font: 700 20px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial;
        color:#10b981; text-shadow: 0 0 6px rgba(16,185,129,.35);
        margin-right:auto;
      }
      .tm-input {
        flex:1; min-width:240px;
        padding:10px 12px; border:1px solid rgba(0,0,0,.1); border-radius:10px; outline:none;
        background: rgba(255,255,255,0.85);
      }
      .tm-pill {
        appearance:none; border:1px solid rgba(0,0,0,.12); background:rgba(255,255,255,.9);
        padding:8px 10px; border-radius:999px; cursor:pointer; font-size:12px;
      }
      .tm-status { padding: 0 16px 12px; color:#3c3c3c; opacity:.8; }
      .tm-results { display:grid; gap:16px; padding: 0 16px 16px; }
      .tm-result-card { padding:14px; }
      .tm-snippet {
        font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
        background: rgba(255,255,255,.7);
        border: 1px solid rgba(0,0,0,.08);
        border-radius: 10px;
        padding: 10px;
        word-break: break-word;
      }
      .tm-results mark { background:#ffef8a; padding:0 .15em; border-radius:2px; }
      .tm-open { font-weight:600; }
      /* keep container width similar to platform cards */
      #tm-embed.container { max-width: 1100px; }
    `;
    const style = document.createElement('style');
    style.textContent = styles;
    document.documentElement.appendChild(style);

    // ---------- build the embedded UI ----------
    const container = document.createElement('div');
    container.className = 'info container';
    container.id = 'tm-embed';
    container.innerHTML = `
      <div class="tm-slot">
        <div class="tm-card">
          <div class="tm-header">
            <div class="tm-title">Code Searcher</div>
            <input id="tmq" class="tm-input" type="search" placeholder="Search this theme’s templates… (Ctrl/⌘+Shift+F)">
            <label class="tm-pill"><input id="tm-regex" type="checkbox"> Regex</label>
            <label class="tm-pill"><input id="tm-case" type="checkbox"> Case</label>
            <button id="tm-go" class="tm-pill">Search</button>
            <button id="tm-refresh" class="tm-pill" title="Re-fetch templates.json">↻</button>
          </div>
          <div id="tm-status" class="tm-status">Loading theme templates…</div>
          <div id="tm-results" class="tm-results"></div>
        </div>
      </div>
    `;

    // Replace the whole landing area with our embed
    landing.replaceWith(container);

    // ---------- helpers ----------
    const $ = (sel, ctx=document) => ctx.querySelector(sel);
    const el = (tag, props={}) => Object.assign(document.createElement(tag), props);
    const escapeHTML = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

    async function loadTemplates() {
      const url = `${location.origin}/admin/themes/${themeId}/templates.json`;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.theme_templates)) throw new Error('Invalid JSON');
      return data.theme_templates.map(t => ({
        key: String(t.key || ''),
        id: t.id ?? '',
        content: String(t.content || '')
      }));
    }

    function findMatches(haystack, needle, { regex, caseSensitive }) {
      const matches = [];
      if (!needle) return matches;
      if (regex) {
        const flags = caseSensitive ? 'g' : 'gi';
        let r;
        try { r = new RegExp(needle, flags); } catch { return matches; }
        let m;
        while ((m = r.exec(haystack)) !== null) {
          matches.push({ index: m.index, length: m[0].length || 1 });
          if (!m[0].length) r.lastIndex++;
        }
      } else {
        const h = caseSensitive ? haystack : haystack.toLowerCase();
        const n = caseSensitive ? needle : needle.toLowerCase();
        let i = 0;
        while ((i = h.indexOf(n, i)) !== -1) {
          matches.push({ index: i, length: n.length || 1 });
          i += Math.max(n.length, 1);
        }
      }
      return matches;
    }

    function snippet(text, { index, length }, radius = 90) {
      const start = Math.max(0, index - radius);
      const end = Math.min(text.length, index + length + radius);
      const before = escapeHTML(text.slice(start, index));
      const hit = escapeHTML(text.slice(index, index + length));
      const after = escapeHTML(text.slice(index + length, end));
      return `${start>0?'…':''}${before}<mark>${hit}</mark>${after}${end<text.length?'…':''}`;
    }

    function renderResults(list, q, totalChecked) {
      const results = $('#tm-results');
      const status = $('#tm-status');
      if (!q) {
        status.textContent = `Type to search across ${totalChecked} templates.`;
        results.innerHTML = '';
        return;
      }
      const totalMatches = list.reduce((a, b) => a + b.matches.length, 0);
      status.textContent = `Found ${totalMatches} match${totalMatches===1?'':'es'} in ${list.length} template${list.length===1?'':'s'}.`;

      if (!totalMatches) {
        results.innerHTML = `<div class="tm-card tm-result-card" style="text-align:center;color:#777;">No matches.</div>`;
        return;
      }

      const frag = document.createDocumentFragment();
      list.forEach(item => {
        const card = el('div', { className: 'tm-result-card tm-card' });
        const head = el('div');
        head.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="font-weight:700;">${escapeHTML(item.key)}</div>
            <div style="opacity:.75">${item.matches.length} hit${item.matches.length===1?'':'s'}</div>
          </div>`;
        card.appendChild(head);

        const listEl = el('div', { style: 'display:grid;gap:10px;margin-top:8px' });
        item.matches.slice(0, 6).forEach(m => {
          const row = el('div');
          row.innerHTML = `
            <div class="tm-snippet">${snippet(item.content, m)}</div>
            <div style="margin-top:6px;">
              <button class="tm-pill tm-open" data-key="${escapeHTML(item.key)}" data-q="${escapeHTML(q)}">Open in editor</button>
            </div>`;
          listEl.appendChild(row);
        });
        card.appendChild(listEl);
        frag.appendChild(card);
      });

      results.innerHTML = '';
      results.appendChild(frag);

      // Wire "Open in editor" buttons
      results.querySelectorAll('.tm-open').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.getAttribute('data-key');
          // Open the Lightspeed editor for that template key.
          // We also append a marker query so a companion userscript could highlight inside the editor if needed.
          const href = `/admin/themes/${themeId}/templates?key=${encodeURIComponent(key)}&tmq=${encodeURIComponent($('#tmq').value.trim())}`;
          location.assign(href);
        });
      });
    }

    // ---------- state & events ----------
    let templates = [];
    const ui = {
      input: $('#tmq', container),
      btn: $('#tm-go', container),
      status: $('#tm-status', container),
      results: $('#tm-results', container),
      regex: $('#tm-regex', container),
      case:  $('#tm-case', container),
      refresh: $('#tm-refresh', container),
    };

    async function bootstrap() {
      ui.status.textContent = 'Loading theme templates…';
      try {
        templates = await loadTemplates();
        ui.status.textContent = `Loaded ${templates.length} templates. Type a query to search.`;
      } catch (e) {
        ui.status.textContent = `Failed to load templates.json (${e.message}).`;
      }
    }

    function doSearch() {
      const q = ui.input.value.trim();
      if (!q || !templates.length) return renderResults([], q, templates.length || 0);
      const opts = { regex: ui.regex.checked, caseSensitive: ui.case.checked };
      const out = [];
      for (const t of templates) {
        const contentHits = findMatches(t.content, q, opts);
        const keyHits = q ? findMatches(t.key, q, opts) : [];
        if (contentHits.length || keyHits.length) {
          out.push({ key: t.key, id: t.id, content: t.content,
            matches: contentHits.length ? contentHits : keyHits.map(()=>({index:0,length:0})) });
        }
      }
      renderResults(out, q, templates.length);
    }

    ui.btn.addEventListener('click', doSearch);
    ui.refresh.addEventListener('click', bootstrap);
    ui.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); }});
    let typetimer;
    ui.input.addEventListener('input', () => { clearTimeout(typetimer); typetimer = setTimeout(doSearch, 220); });
    window.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); ui.input.focus(); ui.input.select(); }
    });

    bootstrap();
  });
})();
