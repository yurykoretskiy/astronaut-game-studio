/* Astronaut Fork v3 — Control Studio Workbench
 * Two-Level Pan/Zoom Route Canvas (Auto-Fit Snake Layout + Level-2 Multi-Row Flowchart with Distractor Branches & Inline Notes)
 * + Style & Character Portfolio Cards (1-click Cross-Scene Propagation)
 * + Slot & Provenance Studio + Full 717-Image Library Browser + Direct Disk Save
 */
(function (root) {
  'use strict';

  const G = root.FORK_GAME;
  const E = root.ENG;
  const D = root.SDK;
  const TR = (root.FORK_TRANSITIONS && root.FORK_TRANSITIONS.after_mission) || {};
  const SLOTS = (root.FORK_SLOTS && root.FORK_SLOTS.slots) || [];
  const GAPS = (root.FORK_GAPS && root.FORK_GAPS.gaps) || [];
  const STYLE_CARDS = root.FORK_STYLE_CARDS || [];
  const FULL_LIBRARY = root.FORK_FULL_LIBRARY || { pictures: [], distinct_pictures: 0, files_found: 0 };

  const NOTES_KEY = 'astronaut_fork_v1_notes';

  let canvasLevel = 'whole'; // 'whole' or mission index (0..4)
  let pan = { x: 20, y: 16, scale: 0.85 };
  let worldBounds = { w: 1200, h: 400 };
  let activeTab = 'guide'; // guide | cards | slots | library | notes | template | spec
  let slotFilter = 'active'; // active | all | gaps | defects
  let libSearch = '';
  let libMakerFilter = 'all';
  let libAssignSlot = SLOTS[0] ? SLOTS[0].id : '';
  let historyStack = [];
  let traceLog = [];
  let qaResult = null;
  let notes = [];

  try {
    const raw = root.localStorage && root.localStorage.getItem(NOTES_KEY);
    if (raw) notes = JSON.parse(raw);
  } catch (_) {}

  function saveNotes() {
    try {
      if (root.localStorage) root.localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch (_) {}
  }

  function addQuickNote(whereLabel, defaultText) {
    const txt = root.prompt ? root.prompt(`Add review/idea note for [${whereLabel}]:`, defaultText || '') : defaultText;
    if (!txt || !txt.trim()) return;
    notes.unshift({
      where: whereLabel,
      text: txt.trim(),
      created_at: new Date().toISOString(),
    });
    saveNotes();
    renderDeck();
  }

  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  }

  async function saveToProjectFile(filename, obj) {
    if (root.showSaveFilePicker) {
      try {
        const handle = await root.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(obj, null, 2) + '\n');
        await writable.close();
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    downloadJson(filename, obj);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function fitToViewport() {
    const vp = document.getElementById('canvas-viewport');
    const world = document.getElementById('canvas-world');
    if (!vp || !world) return;
    const vw = vp.clientWidth || 580;
    const vh = vp.clientHeight || 420;
    const pad = 28;
    const sx = (vw - pad * 2) / Math.max(320, worldBounds.w);
    const sy = (vh - pad * 2) / Math.max(220, worldBounds.h);
    pan.scale = Math.max(0.42, Math.min(1.15, Math.min(sx, sy)));
    pan.x = Math.round((vw - worldBounds.w * pan.scale) / 2);
    pan.y = Math.max(12, Math.round((vh - worldBounds.h * pan.scale) / 2));
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${pan.scale})`;
  }

  // --- Two-Level Pan/Zoom Route Canvas ---
  function renderCanvas(autoFit) {
    const vp = document.getElementById('canvas-viewport');
    const world = document.getElementById('canvas-world');
    const crumb = document.getElementById('canvas-crumb');
    if (!vp || !world) return;
    world.innerHTML = '';

    const snap = G.getSnapshot();
    const st = snap.state;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = '2800px';
    svg.style.height = '1800px';
    svg.style.pointerEvents = 'none';
    world.append(svg);

    function drawEdge(x1, y1, x2, y2, color, dashed) {
      const dx = Math.abs(x2 - x1);
      const dy = Math.abs(y2 - y1);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let d;
      if (dy > 40 && dx < 60) {
        const my = (y1 + y2) / 2;
        d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
      } else {
        const mx = (x1 + x2) / 2;
        d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      }
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', color || '#38bdf8');
      p.setAttribute('stroke-width', '2.5');
      if (dashed) p.setAttribute('stroke-dasharray', '6 5');
      svg.appendChild(p);
    }

    function slotThumb(slotId) {
      const c = G.resolveCandidate(slotId);
      if (c && c.rel_asset) return c.rel_asset;
      const s = SLOTS.find((x) => x.id === slotId);
      const first = s && s.candidates && s.candidates[0];
      return first && first.rel_asset ? first.rel_asset : null;
    }

    function addNode(x, y, tag, title, sub, cls, onClick, onDbl, thumbUrl) {
      const n = el('div', 'flow-node ' + (cls || '') + (thumbUrl ? ' has-thumb' : ''));
      n.style.left = x + 'px';
      n.style.top = y + 'px';
      if (thumbUrl) {
        const th = el('div', 'fn-thumb');
        th.style.backgroundImage = `url("${thumbUrl}")`;
        n.append(th);
      }
      n.append(el('div', 'fn-tag', tag), el('div', 'fn-title', title), el('div', 'fn-sub', sub));
      n.onclick = (e) => { e.stopPropagation(); if (onClick) onClick(); };
      if (onDbl) n.ondblclick = (e) => { e.stopPropagation(); onDbl(); };
      world.append(n);
      return { x, y, w: 180, h: thumbUrl ? 124 : 76 };
    }

    if (canvasLevel === 'whole') {
      crumb.textContent = 'Whole Game (Level 1 — 12-node snake flow · click to jump, double-click a mission to drill down)';
      const chain = [
        {
          tag: 'INTRO', title: 'Crash Story', sub: `${D.intro.length} beats`,
          thumb: slotThumb('story:b01'),
          isCurrent: st.scr === 'intro' && !snap.transitionFor,
          isDone: st.scr !== 'intro',
          jump: () => G.jumpTo({ type: 'intro', beat: 0 }),
        },
        {
          tag: 'HUB', title: 'Planet Map', sub: `${D.regions.length} regions`,
          thumb: slotThumb('map:background'),
          isCurrent: st.scr === 'map' && !snap.transitionFor,
          isDone: st.done.length > 0,
          jump: () => G.jumpTo({ type: 'map', done: st.done, unlocks: st.unlocks }),
        },
      ];
      D.missions.forEach((m, k) => {
        chain.push({
          tag: `M${k + 1} · ${m.mechanic.toUpperCase()}`, title: m.title, sub: `${m.steps.length} steps (dbl-click)`,
          thumb: slotThumb(`mission:${m.id}:background`),
          isCurrent: st.scr === 'mission' && st.m === k && !snap.transitionFor,
          isDone: st.done.includes(m.id),
          jump: () => G.jumpTo({ type: 'mission', m: k, step: 0 }),
          drill: () => { canvasLevel = k; renderCanvas(true); },
        });
        const tr = TR[m.id];
        if (tr) {
          chain.push({
            tag: tr.is_chapter_ending ? 'CH.1 FINALE' : `SCENE T${k + 1}`,
            title: tr.title, sub: tr.is_chapter_ending ? 'Orbit contact!' : 'Post-mission scene',
            thumb: slotThumb(`transition:after:${m.id}`),
            isCurrent: snap.transitionFor === m.id,
            isDone: st.done.includes(m.id) && snap.transitionFor !== m.id,
            jump: () => G.jumpTo({ type: 'transition', missionId: m.id }),
          });
        }
      });

      // Clean 4-column snake layout (Row 0: L->R, Row 1: R->L, Row 2: L->R) so edges never zig-zag across nodes!
      const COLS = 4;
      const STEP_X = 205;
      const STEP_Y = 148;
      const coords = [];
      let maxX = 0, maxY = 0;

      chain.forEach((item, idx) => {
        const row = Math.floor(idx / COLS);
        const colInRow = idx % COLS;
        const col = (row % 2 === 1) ? (COLS - 1 - colInRow) : colInRow;
        const x = 16 + col * STEP_X;
        const y = 16 + row * STEP_Y;
        const cls = item.isCurrent ? 'current' : item.isDone ? 'done' : '';
        const box = addNode(x, y, item.tag, item.title, item.sub, cls, item.jump, item.drill, item.thumb);
        box.row = row;
        box.col = col;
        coords.push(box);
        if (x + box.w > maxX) maxX = x + box.w;
        if (y + box.h > maxY) maxY = y + box.h;
      });
      worldBounds = { w: maxX + 24, h: maxY + 24 };

      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i], b = coords[i + 1];
        if (a.row === b.row) {
          if (a.col < b.col) {
            drawEdge(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2, '#38bdf8', false);
          } else {
            drawEdge(a.x, a.y + a.h / 2, b.x + b.w, b.y + b.h / 2, '#38bdf8', false);
          }
        } else {
          drawEdge(a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y, '#38bdf8', false);
        }
      }
    } else {
      // Level 2: Multi-Row Wrapped Mission Flowchart with Expected Path, Distractor Branches & Inline +Note
      const m = D.missions[canvasLevel];
      const steps = E.prep(m);
      crumb.textContent = `Mission ${canvasLevel + 1}: ${m.title} (${steps.length} steps — Level 2 Flowchart · click step or wrong branch to test)`;
      const nw = E.newWords();
      const COLS = 3;
      const STEP_X = 272;
      const STEP_Y = 235;
      const coords = [];
      let maxX = 0, maxY = 0;

      // Sample distractors for this mission
      const allTargets = m.mechanic === 'repair' ? Object.keys(m.names || {})
        : m.mechanic === 'fetch' ? (m.placement || []).map((p) => p.id)
        : m.mechanic === 'scan' ? Object.keys(m.creatures || {})
        : E.bank(m);

      steps.forEach((sp, idx) => {
        const row = Math.floor(idx / COLS);
        const colInRow = idx % COLS;
        const col = (row % 2 === 1) ? (COLS - 1 - colInRow) : colInRow;
        const x = 16 + col * STEP_X;
        const y = 16 + row * STEP_Y;
        const isCurrent = st.scr === 'mission' && st.m === canvasLevel && st.i === idx && !snap.transitionFor;
        const isDone = st.scr === 'mission' && st.m === canvasLevel && st.i > idx;
        const expFlat = sp.groups.flat();
        const expLabel = sp.groups.map((g) => g.join(' + ')).join(' → ');
        const distractors = allTargets.filter((t) => !expFlat.includes(t)).slice(0, 2);
        const words = (nw[canvasLevel + ':' + idx] || []).slice(0, 3).join(', ');

        const card = el('div', 'flow-node level2-step ' + (isCurrent ? 'current' : isDone ? 'done' : ''));
        card.style.left = x + 'px';
        card.style.top = y + 'px';
        card.append(
          el('div', 'fn-tag', `STEP ${idx + 1}/${steps.length}${words ? ' · NEW: ' + words : ''}`),
          el('div', 'fn-title', (sp.say || sp.line || '').slice(0, 56) + ((sp.say || sp.line || '').length > 56 ? '…' : '')),
          el('div', 'fn-expected', `✓ Expected: ${expLabel}`)
        );

        const branches = el('div', 'fn-branches');
        const wrongBtn = el('button', 'fn-branch-pill',
          `✕ Distractor (${distractors.join(', ') || 'wrong click'}) → -10% Power · 3x Glow Hint`);
        wrongBtn.type = 'button';
        wrongBtn.onclick = (e) => {
          e.stopPropagation();
          G.jumpTo({ type: 'mission', m: canvasLevel, step: idx });
          const bad = G.findWrongAction();
          if (bad) G.act(bad);
        };
        branches.append(wrongBtn);
        card.append(branches);

        const footer = el('div', 'fn-footer');
        footer.append(el('span', 'fn-sub', '0% → Auto-Recharge'));
        const noteBtn = el('button', 'fn-note-btn', '+ Note');
        noteBtn.type = 'button';
        noteBtn.onclick = (e) => {
          e.stopPropagation();
          addQuickNote(`${m.title} · Step ${idx + 1}`, `Step ${idx + 1} (${expLabel}): `);
        };
        footer.append(noteBtn);
        card.append(footer);

        card.onclick = (e) => {
          e.stopPropagation();
          G.jumpTo({ type: 'mission', m: canvasLevel, step: idx });
        };
        world.append(card);

        const box = { x, y, w: 245, h: 190, row, col };
        coords.push(box);
        if (x + box.w > maxX) maxX = x + box.w;
        if (y + box.h > maxY) maxY = y + box.h;
      });

      worldBounds = { w: maxX + 24, h: maxY + 24 };
      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i], b = coords[i + 1];
        if (a.row === b.row) {
          if (a.col < b.col) drawEdge(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2, '#22c55e', false);
          else drawEdge(a.x, a.y + a.h / 2, b.x + b.w, b.y + b.h / 2, '#22c55e', false);
        } else {
          drawEdge(a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y, '#22c55e', false);
        }
      }
    }

    if (autoFit) {
      fitToViewport();
    } else {
      world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${pan.scale})`;
    }
  }

  // --- Bottom Control Deck ---
  function renderDeck() {
    const body = document.getElementById('deck-body');
    if (!body) return;
    body.innerHTML = '';

    document.querySelectorAll('.deck-tabs button[data-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === activeTab);
    });

    const snap = G.getSnapshot();

    if (activeTab === 'guide') {
      const next = G.nextRightAction();
      const row = el('div', '');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.flexWrap = 'wrap';
      row.style.alignItems = 'center';
      row.style.marginBottom = '10px';

      const backBtn = el('button', '', '◀ Back');
      backBtn.disabled = historyStack.length === 0;
      backBtn.onclick = () => {
        const prev = historyStack.pop();
        if (prev) {
          if (prev.transitionFor) G.jumpTo({ type: 'transition', missionId: prev.transitionFor });
          else if (prev.state.scr === 'intro') G.jumpTo({ type: 'intro', beat: prev.state.beat });
          else if (prev.state.scr === 'map') G.jumpTo({ type: 'map', done: prev.state.done, unlocks: prev.state.unlocks });
          else if (prev.state.scr === 'mission') G.jumpTo({ type: 'mission', m: prev.state.m, step: prev.state.i });
        }
      };

      const nextBtn = el('button', 'primary', next ? `Next ▶ (${next.act})` : 'Chapter 1 Finished');
      nextBtn.disabled = !next;
      nextBtn.onclick = () => {
        if (!next) return;
        historyStack.push(snap);
        traceLog.unshift(`[OK] ${snap.where} -> ${next.act} (${next.why})`);
        G.act(next.act);
      };

      const wrongBtn = el('button', 'bad', '⚡ Try Wrong Click');
      const badAct = G.findWrongAction();
      wrongBtn.disabled = !badAct;
      wrongBtn.onclick = () => {
        if (!badAct) return;
        historyStack.push(snap);
        traceLog.unshift(`[WRONG] ${snap.where} -> clicked "${badAct}"`);
        G.act(badAct);
      };

      const noteBtn = el('button', '', '📝 + Note Here');
      noteBtn.onclick = () => addQuickNote(snap.where, '');

      const qaBtn = el('button', 'accent', '🧪 Run 5-Mission BFS + 42-Step QA');
      qaBtn.onclick = () => {
        const pos = E.positive();
        const bfs = E.explore();
        const lad = E.ladder();
        qaResult = { pos, bfs, lad };
        renderDeck();
      };

      row.append(backBtn, nextBtn, wrongBtn, noteBtn, qaBtn);
      body.append(row);

      if (next) {
        const hint = el('div', '', `Guide preview: ${next.why}`);
        hint.style.color = '#93c5fd';
        hint.style.marginBottom = '8px';
        body.append(hint);
      }

      if (qaResult) {
        const box = el('div', '');
        box.style.padding = '8px 10px';
        box.style.background = '#0f172a';
        box.style.border = '1px solid #22c55e';
        box.style.borderRadius = '8px';
        box.style.marginBottom = '8px';
        box.innerHTML =
          `<strong>Independent Engine QA:</strong> ` +
          `Walkthrough=${qaResult.pos.ok ? 'PASS' : 'FAIL'} (${qaResult.pos.clicks} clicks) · ` +
          `BFS=${qaResult.bfs.states.toLocaleString()} states / ${qaResult.bfs.edges.toLocaleString()} edges / ${qaResult.bfs.trapped.length} dead ends · ` +
          `Ladder=${qaResult.lad.recovered}/${qaResult.lad.steps} steps recovered, glow=${qaResult.lad.glow}, recharge=${qaResult.lad.recharge}`;
        body.append(box);
      }

      const logEl = el('pre', '');
      logEl.style.margin = '0';
      logEl.style.fontSize = '11px';
      logEl.style.color = '#94a3b8';
      logEl.textContent = traceLog.slice(0, 12).join('\n') || 'Trace log empty. Use Next ▶ or click directly on the game stage.';
      body.append(logEl);
    }
    else if (activeTab === 'cards') {
      const intro = el('div', 'fn-sub',
        'Character & World Portfolio Cards — locked visual style rules, reference anchors, and 1-click propagation across every scene where a character or world asset appears.');
      intro.style.marginBottom = '10px';
      body.append(intro);

      const grid = el('div', 'style-card-grid');
      STYLE_CARDS.forEach((sc) => {
        const card = el('div', 'style-card');
        const head = el('div', 'slot-card-head');
        head.append(el('strong', '', sc.title), el('span', 'qa-pill qa-clean', `${(sc.slots || []).length} linked slots`));
        card.append(head);
        card.append(el('div', 'fn-sub', sc.rules));

        // Reference thumbnails resolved from linked slots
        const thumbs = el('div', 'style-card-thumbs');
        (sc.slots || []).slice(0, 4).forEach((sid) => {
          const cand = G.resolveCandidate(sid);
          if (cand && cand.rel_asset) {
            const im = el('img', '');
            im.src = cand.rel_asset;
            im.alt = sid;
            im.title = `${sid} (${cand.filename})`;
            thumbs.append(im);
          }
        });
        if (thumbs.childNodes.length) card.append(thumbs);

        // 1-click variant propagation across scenes (if variants defined)
        if (sc.variants && sc.variants.length) {
          const vRow = el('div', 'slot-actions');
          sc.variants.forEach((v) => {
            const vb = el('button', 'primary', `⚡ Apply "${v.label}" Across All Scenes`);
            vb.onclick = () => {
              (sc.slots || []).forEach((sid) => {
                const sl = SLOTS.find((x) => x.id === sid);
                if (!sl) return;
                const match = sl.candidates.find((c) => c.filename.includes(v.match) || c.source_tag.includes(v.match));
                if (match) G.setSlotOverride(sid, match.id);
              });
              renderDeck();
            };
            vRow.append(vb);
          });
          card.append(vRow);
        }

        // Cross-Scene Impact Matrix chips (click to jump/filter)
        const chips = el('div', 'impact-chips');
        (sc.slots || []).forEach((sid) => {
          const ch = el('span', 'impact-chip', sid);
          ch.onclick = () => {
            activeTab = 'slots';
            slotFilter = 'all';
            renderDeck();
          };
          chips.append(ch);
        });
        card.append(chips);
        grid.append(card);
      });
      body.append(grid);
    }
    else if (activeTab === 'slots') {
      const bar = el('div', '');
      bar.style.display = 'flex';
      bar.style.gap = '6px';
      bar.style.flexWrap = 'wrap';
      bar.style.marginBottom = '10px';

      const filters = [
        ['active', `Active Scene (${snap.activeSlots.length})`],
        ['all', `All Slots (${SLOTS.length})`],
        ['gaps', `Empty / Gaps (${SLOTS.filter((s) => !s.candidates.length).length})`],
        ['defects', `Alpha/Border Defects (${SLOTS.filter((s) => s.candidates.some((c) => c.qa_status === 'border_defect' || c.qa_status === 'opaque_cutout')).length})`],
      ];
      filters.forEach(([k, lbl]) => {
        const b = el('button', slotFilter === k ? 'active' : '', lbl);
        b.onclick = () => { slotFilter = k; renderDeck(); };
        bar.append(b);
      });

      const saveBtn = el('button', 'primary', '💾 Save decisions.json to Disk');
      saveBtn.style.marginLeft = 'auto';
      saveBtn.onclick = () => {
        saveToProjectFile('astronaut-fork-decisions.json', {
          exported_at: new Date().toISOString(),
          fork: 'astronaut-fork-v3',
          slot_overrides: G.getSlotOverrides(),
          decisions: G.getDecisions(),
        });
      };
      bar.append(saveBtn);
      body.append(bar);

      const activeSet = new Set(snap.activeSlots);
      let list = SLOTS;
      if (slotFilter === 'active') list = SLOTS.filter((s) => activeSet.has(s.id));
      else if (slotFilter === 'gaps') list = SLOTS.filter((s) => !s.candidates.length);
      else if (slotFilter === 'defects') list = SLOTS.filter((s) => s.candidates.some((c) => c.qa_status === 'border_defect' || c.qa_status === 'opaque_cutout'));

      const grid = el('div', 'slot-grid');
      const decs = G.getDecisions();

      list.forEach((slot) => {
        const card = el('div', 'slot-card');
        const live = G.resolveCandidate(slot.id);
        const dec = decs[slot.id] || { approval: slot.yury_approval || 'unreviewed' };

        const head = el('div', 'slot-card-head');
        head.append(el('span', 'slot-id', slot.id));
        const pills = el('div', '');
        const qaCls = !live ? 'qa-missing' : live.qa_status === 'clean' ? 'qa-clean' : 'qa-defect';
        pills.append(el('span', 'qa-pill ' + qaCls, live ? live.qa_status : 'empty'));
        const apCls = dec.approval === 'approved' ? 'appr-approved' : dec.approval === 'rejected' ? 'appr-rejected' : 'appr-unreviewed';
        const apSpan = el('span', 'qa-pill ' + apCls, ' ' + dec.approval);
        apSpan.style.marginLeft = '4px';
        pills.append(apSpan);
        head.append(pills);
        card.append(head);

        if (live && live.rel_asset) {
          const img = el('img', 'slot-thumb');
          img.src = live.rel_asset;
          img.alt = slot.label;
          card.append(img);
          const meta = el('div', 'fn-sub',
            `${live.source_tag} · ${live.maker}/${live.model} (${live.effort}) · ${live.width}x${live.height} · ${live.qa_note} · sha:${(live.sha256 || '').slice(0, 8)}`);
          card.append(meta);
        } else {
          card.append(el('div', 'fn-sub', `No live art (honest labelled box). Style ref: ${slot.style_ref}`));
        }

        // Candidate switcher
        if (slot.candidates.length > 0) {
          const sel = document.createElement('select');
          sel.style.background = '#0b101b';
          sel.style.color = '#fff';
          sel.style.border = '1px solid #334155';
          sel.style.borderRadius = '6px';
          sel.style.padding = '4px';
          sel.style.fontSize = '11px';
          const emptyOpt = document.createElement('option');
          emptyOpt.value = '__EMPTY__';
          emptyOpt.textContent = '(Honest Labelled Box — No Image)';
          if (!live) emptyOpt.selected = true;
          sel.append(emptyOpt);
          slot.candidates.forEach((c) => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.source_tag}: ${c.filename} [${c.maker}/${c.model} · ${c.qa_status}]`;
            if (live && live.id === c.id) opt.selected = true;
            sel.append(opt);
          });
          sel.onchange = () => G.setSlotOverride(slot.id, sel.value);
          card.append(sel);
        }

        const acts = el('div', 'slot-actions');
        const bOk = el('button', dec.approval === 'approved' ? 'ok' : '', '✓ Approve');
        const bNo = el('button', dec.approval === 'rejected' ? 'bad' : '', '✕ Reject');
        bOk.onclick = () => {
          G.setDecision(slot.id, 'approved', live && live.id);
          apSpan.className = 'qa-pill appr-approved';
          apSpan.textContent = ' approved';
          bOk.classList.add('ok');
          bNo.classList.remove('bad');
        };
        bNo.onclick = () => {
          G.setDecision(slot.id, 'rejected', live && live.id);
          apSpan.className = 'qa-pill appr-rejected';
          apSpan.textContent = ' rejected';
          bNo.classList.add('bad');
          bOk.classList.remove('ok');
        };
        acts.append(bOk, bNo);

        if (slot.candidates.length >= 2) {
          const bCmp = el('button', '', 'A/B Compare');
          bCmp.onclick = () => openCompareModal(slot);
          acts.append(bCmp);
        }
        const bNote = el('button', '', '+ Note');
        bNote.onclick = () => addQuickNote(`Slot ${slot.id}`, '');
        acts.append(bNote);

        card.append(acts);
        grid.append(card);
      });
      body.append(grid);
    }
    else if (activeTab === 'library') {
      const pics = FULL_LIBRARY.pictures || [];
      const bar = el('div', '');
      bar.style.display = 'flex';
      bar.style.gap = '8px';
      bar.style.flexWrap = 'wrap';
      bar.style.alignItems = 'center';
      bar.style.marginBottom = '10px';

      const inp = document.createElement('input');
      inp.type = 'search';
      inp.placeholder = `Search all ${pics.length} unique images (filename, path, model, date)…`;
      inp.value = libSearch;
      inp.style.flex = '1';
      inp.style.minWidth = '220px';
      inp.style.padding = '5px 10px';
      inp.style.background = '#0b101b';
      inp.style.color = '#fff';
      inp.style.border = '1px solid #334155';
      inp.style.borderRadius = '8px';
      inp.oninput = () => { libSearch = inp.value; renderDeck(); };
      bar.append(inp);

      ['all', 'codex', 'antigravity', 'kie-seedream', 'hermes'].forEach((mk) => {
        const b = el('button', libMakerFilter === mk ? 'active' : '', mk.toUpperCase());
        b.onclick = () => { libMakerFilter = mk; renderDeck(); };
        bar.append(b);
      });

      const slotSel = document.createElement('select');
      slotSel.style.background = '#0b101b';
      slotSel.style.color = '#fff';
      slotSel.style.border = '1px solid #334155';
      slotSel.style.borderRadius = '6px';
      slotSel.style.padding = '5px';
      slotSel.style.fontSize = '11px';
      SLOTS.forEach((s) => {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = `Assign target: ${s.id}`;
        if (s.id === libAssignSlot) o.selected = true;
        slotSel.append(o);
      });
      slotSel.onchange = () => { libAssignSlot = slotSel.value; };
      bar.append(slotSel);
      body.append(bar);

      const q = libSearch.trim().toLowerCase();
      const filtered = pics.filter((p) => {
        const tool = (p.made_by && p.made_by.tool) || 'unknown';
        if (libMakerFilter !== 'all' && !tool.toLowerCase().includes(libMakerFilter)) return false;
        if (!q) return true;
        const hay = `${p.name} ${p.id} ${tool} ${(p.made_by && p.made_by.model) || ''} ${(p.paths || []).join(' ')}`.toLowerCase();
        return hay.includes(q);
      });

      body.append(el('div', 'fn-sub',
        `Showing ${Math.min(60, filtered.length)} of ${filtered.length} matching images (from ${FULL_LIBRARY.distinct_pictures || pics.length} unique SHA-256 images across ${FULL_LIBRARY.files_found || 1484} files).`));

      const grid = el('div', 'slot-grid');
      grid.style.marginTop = '8px';
      filtered.slice(0, 60).forEach((p) => {
        const c = el('div', 'slot-card');
        const mb = p.made_by || {};
        const head = el('div', 'slot-card-head');
        head.append(el('span', 'slot-id', p.name), el('span', 'qa-pill qa-clean', `${mb.tool || 'unknown'} · ${mb.model || 'unknown'}`));
        c.append(head);
        if (p.rel_asset) {
          const im = el('img', 'slot-thumb');
          im.src = p.rel_asset;
          im.alt = p.name;
          c.append(im);
        }
        c.append(el('div', 'fn-sub',
          `sha:${p.id} · ${p.width}x${p.height} · created:${p.created || 'n/a'} · evidence:${mb.evidence || 'folder'} · copies:${p.copies || 1}`));
        c.append(el('div', 'fn-sub', (p.paths && p.paths[0]) || ''));
        if (p.cand_id && p.slot_id) {
          const useBtn = el('button', 'primary', `⚡ Use in ${p.slot_id}`);
          useBtn.onclick = () => G.setSlotOverride(p.slot_id, p.cand_id);
          c.append(useBtn);
        }
        grid.append(c);
      });
      body.append(grid);
    }
    else if (activeTab === 'notes') {
      const form = el('div', '');
      form.style.display = 'flex';
      form.style.gap = '8px';
      form.style.marginBottom = '10px';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = `Add idea note for "${snap.where}"…`;
      inp.style.flex = '1';
      inp.style.padding = '6px 10px';
      inp.style.background = '#0b101b';
      inp.style.color = '#fff';
      inp.style.border = '1px solid #334155';
      inp.style.borderRadius = '8px';
      const addBtn = el('button', 'primary', '+ Save Note');
      addBtn.onclick = () => {
        if (!inp.value.trim()) return;
        notes.unshift({
          where: snap.where,
          text: inp.value.trim(),
          created_at: new Date().toISOString(),
        });
        saveNotes();
        inp.value = '';
        renderDeck();
      };
      const expBtn = el('button', '', '💾 Save notes.json to Disk');
      expBtn.onclick = () => saveToProjectFile('astronaut-fork-notes.json', { exported_at: new Date().toISOString(), notes });
      form.append(inp, addBtn, expBtn);
      body.append(form);

      if (notes.length) {
        const ul = el('div', '');
        ul.style.marginBottom = '12px';
        notes.forEach((n) => {
          const row = el('div', 'slot-card');
          row.style.marginBottom = '6px';
          row.innerHTML = `<strong>${n.where}</strong> — ${n.text} <span class="fn-sub">(${n.created_at.slice(0, 16)})</span>`;
          ul.append(row);
        });
        body.append(ul);
      }

      body.append(el('div', 'fn-tag', `Open Asset & Content Gaps (${GAPS.length})`));
      const gList = el('div', 'slot-grid');
      gList.style.marginTop = '6px';
      GAPS.slice(0, 24).forEach((g) => {
        const c = el('div', 'slot-card');
        c.innerHTML = `<div class="slot-id">${g.slot_id} <span class="qa-pill qa-missing">${g.issue}</span></div><div class="fn-sub">${g.detail}</div>`;
        gList.append(c);
      });
      body.append(gList);
    }
    else if (activeTab === 'template') {
      const m5 = root.FORK_M5_TEMPLATE || {};
      const box = el('div', 'slot-card');
      const hdr = el('div', 'slot-card-head');
      hdr.append(el('strong', '', 'Mission 5: Mountain Beacon — Pure JSON Mission Template Proof (0 Engine Edits)'));
      const jumpBtn = el('button', 'primary', '🚀 Play M5 Mountain Beacon Now');
      jumpBtn.onclick = () => {
        const idx = D.missions.findIndex((m) => m.id === 'm5_mountain_beacon');
        if (idx >= 0) G.jumpTo({ type: 'mission', m: idx, step: 0 });
      };
      hdr.append(jumpBtn);
      box.append(hdr);
      const pre = el('pre', '');
      pre.style.fontSize = '11px';
      pre.style.color = '#bae6fd';
      pre.style.margin = '6px 0 0';
      pre.textContent = JSON.stringify(m5, null, 2);
      box.append(pre);
      body.append(box);
    }
    else if (activeTab === 'spec') {
      const box = el('div', 'slot-card');
      box.innerHTML = `
        <div class="fn-title">Astronaut Fork v3 — Locked Decisions, Style Cards & Provenance Contract</div>
        <div class="fn-sub">• <strong>Branch:</strong> local <code>astronaut-fork-v1</code> (zero edits to Claude/Codex/Hermes worktrees; zero deletions).</div>
        <div class="fn-sub">• <strong>Robodog Face:</strong> Locked Apollo Scout glowing cyan ring-eye optic lens across all missions and T1–T5 transitions (with 1-click toggle in Style Cards).</div>
        <div class="fn-sub">• <strong>Intro Story Coherence:</strong> All 13 intro beats mapped to cohesive color 2.5D comic panels matching the exact story text (no mismatched charcoal campfire/teepee/pet sketches).</div>
        <div class="fn-sub">• <strong>Mission 1 Lying Robodog Workbench:</strong> Robodog visibly lies across the repair workbench with his open chest cavity centered for live sagging Bezier cable wiring and step-12 ring-eye wake-up payoff.</div>
        <div class="fn-sub">• <strong>Image Integrity:</strong> Full 717-image provenance library searchable in Studio. Live preview ≠ Yury approval (0 auto-approvals).</div>
      `;
      body.append(box);
    }
  }

  function openCompareModal(slot) {
    const modal = document.getElementById('compare-modal');
    const content = document.getElementById('compare-content');
    if (!modal || !content) return;
    const cands = slot.candidates;
    content.innerHTML = `<h3 style="margin:0 0 8px;">Compare Candidates (${cands.length}): ${slot.id}</h3>`;
    const grid = el('div', 'compare-grid');
    cands.forEach((c, idx) => {
      const col = el('div', 'compare-col');
      col.innerHTML = `
        <div class="fn-tag">Candidate ${idx + 1} · ${c.source_tag}</div>
        <img src="${c.rel_asset || ''}" alt="${c.filename}">
        <div class="fn-sub">${c.filename} | ${c.width}x${c.height} | ${c.maker}/${c.model} (${c.effort}) | QA: ${c.qa_status} (${c.qa_note})</div>
      `;
      const useBtn = el('button', 'primary', '⚡ Preview on Live Stage');
      useBtn.style.marginTop = '8px';
      useBtn.onclick = () => { G.setSlotOverride(slot.id, c.id); modal.classList.remove('open'); };
      col.append(useBtn);
      grid.append(col);
    });
    content.append(grid);
    modal.classList.add('open');
  }

  function setupPanZoom() {
    const vp = document.getElementById('canvas-viewport');
    if (!vp) return;
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    vp.onpointerdown = (e) => {
      if (e.target.closest('.flow-node')) return;
      dragging = true; sx = e.clientX; sy = e.clientY; ox = pan.x; oy = pan.y;
    };
    root.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      pan.x = ox + (e.clientX - sx);
      pan.y = oy + (e.clientY - sy);
      const w = document.getElementById('canvas-world');
      if (w) w.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${pan.scale})`;
    });
    root.addEventListener('pointerup', () => { dragging = false; });
    vp.onwheel = (e) => {
      e.preventDefault();
      pan.scale = Math.max(0.38, Math.min(1.6, pan.scale * (e.deltaY < 0 ? 1.08 : 0.92)));
      const w = document.getElementById('canvas-world');
      if (w) w.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${pan.scale})`;
    };
  }

  root.FORK_STUDIO = {
    init() {
      setupPanZoom();
      document.getElementById('btn-level-whole').onclick = () => {
        canvasLevel = 'whole'; renderCanvas(true);
      };
      const fitBtn = document.getElementById('btn-zoom-fit');
      if (fitBtn) fitBtn.onclick = () => fitToViewport();
      document.getElementById('btn-zoom-in').onclick = () => { pan.scale = Math.min(1.6, pan.scale + 0.12); renderCanvas(false); };
      document.getElementById('btn-zoom-out').onclick = () => { pan.scale = Math.max(0.38, pan.scale - 0.12); renderCanvas(false); };
      document.getElementById('btn-zoom-reset').onclick = () => fitToViewport();
      document.getElementById('btn-box-mode').onclick = (e) => {
        const next = !G.getSnapshot().boxMode;
        G.setBoxMode(next);
        e.target.classList.toggle('active', next);
      };
      document.getElementById('btn-reset-game').onclick = () => { historyStack = []; traceLog = []; G.reset(); };
      document.querySelectorAll('.deck-tabs button[data-tab]').forEach((b) => {
        b.onclick = () => { activeTab = b.dataset.tab; renderDeck(); };
      });
      document.getElementById('compare-close').onclick = () => {
        document.getElementById('compare-modal').classList.remove('open');
      };
      let firstRender = true;
      G.onChange(() => {
        renderCanvas(firstRender);
        firstRender = false;
        renderDeck();
      });
      G.init();
    },
    fitToViewport,
  };
})(window);
