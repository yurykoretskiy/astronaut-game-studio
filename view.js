/* Astronaut Fork v1 — Shared Game Renderer (Play Page + Control Studio)
 * Reads window.SDK (upstream app JSON), window.ENG (read-only engine-claude.js),
 * window.FORK_TRANSITIONS, and window.FORK_SLOTS. Strictly silent in v1.
 */
(function (root) {
  'use strict';

  const E = root.ENG;
  const D = root.SDK;
  const TR = (root.FORK_TRANSITIONS && root.FORK_TRANSITIONS.after_mission) || {};
  const SLOT_DATA = (root.FORK_SLOTS && root.FORK_SLOTS.slots) || [];
  const slotMap = new Map(SLOT_DATA.map((s) => [s.id, s]));

  const OVERRIDE_KEY = 'astronaut_fork_v1_slot_overrides';
  const DECISION_KEY = 'astronaut_fork_v1_decisions';
  const SAVE_KEY = 'astronaut_fork_v2_save';
  const LAYOUT_OV_KEY = 'astronaut_fork_v2_layout_overrides';
  const LABEL_MODE_KEY = 'astronaut_fork_v3_label_mode';
  const AUDIO_MAP = root.FORK_AUDIO || { bgm: {}, intro: {}, m1_steps: {} };

  let state = E.fresh();
  let transitionFor = null; // missionId when showing post-mission transition scene
  let dialogue = [];
  let boxMode = false;
  // 3-Mode Smart Label System:
  //   'smart' (default on game.html): hides item text labels until hovered, clicked, or 3x-mistake glow hint triggers; character names stay visible
  //   'study': reveals target label after 1 mistake or hover
  //   'all' (default on studio.html): all item labels always shown for dev/inspection
  const isStudioPage = typeof document !== 'undefined' && document.body && document.body.classList.contains('studio-page');
  let labelMode = loadJsonStorage(LABEL_MODE_KEY, null) || (isStudioPage ? 'all' : 'smart');
  let revealedTargets = new Set();
  let layoutEditMode = false;
  let userLayoutOverrides = loadJsonStorage(LAYOUT_OV_KEY, {});
  let soundEnabled = false; // Strictly OFF by default (silent-first)
  let bgmPlayer = null;
  let voPlayer = null;
  let drag = null;
  let suppressClick = false;
  let stageEl = null;
  let cableSvg = null;
  const listeners = new Set();

  function saveProgress() {
    saveJsonStorage(SAVE_KEY, { done: state.done, unlocks: state.unlocks });
  }

  function syncAudio() {
    if (!soundEnabled) {
      if (bgmPlayer) { bgmPlayer.pause(); }
      if (voPlayer) { voPlayer.pause(); }
      return;
    }
    try {
      const bgmKey = transitionFor ? 'transition'
        : state.scr === 'mission' ? (D.missions[state.m] && D.missions[state.m].id)
        : state.scr;
      const bgmSrc = AUDIO_MAP.bgm && AUDIO_MAP.bgm[bgmKey];
      if (bgmSrc) {
        if (!bgmPlayer) { bgmPlayer = new Audio(); bgmPlayer.loop = true; bgmPlayer.volume = 0.28; }
        if (!bgmPlayer.src.endsWith(bgmSrc)) { bgmPlayer.src = bgmSrc; }
        bgmPlayer.play().catch(() => {});
      }
      let voSrc = null;
      if (!transitionFor && state.scr === 'intro') {
        const b = D.intro[state.beat];
        voSrc = b && AUDIO_MAP.intro && AUDIO_MAP.intro[b.id];
      } else if (!transitionFor && state.scr === 'mission' && state.m === 0) {
        voSrc = AUDIO_MAP.m1_steps && AUDIO_MAP.m1_steps[String(state.i)];
      }
      if (voSrc) {
        if (!voPlayer) { voPlayer = new Audio(); voPlayer.volume = 0.9; }
        if (!voPlayer.src.endsWith(voSrc)) { voPlayer.src = voSrc; voPlayer.play().catch(() => {}); }
      }
    } catch (_) {}
  }

  function getLearnedWords() {
    const learned = new Set();
    D.missions.forEach((m, k) => {
      if (state.done.includes(m.id)) {
        E.prep(m).forEach((sp) => (sp.items || []).forEach((w) => learned.add(w)));
      } else if (state.scr === 'mission' && state.m === k) {
        E.prep(m).slice(0, state.i).forEach((sp) => (sp.items || []).forEach((w) => learned.add(w)));
      }
    });
    return learned;
  }

  function openDrawer(kind) {
    const modal = document.getElementById('drawer-modal');
    const title = document.getElementById('drawer-title');
    const body = document.getElementById('drawer-content');
    if (!modal || !title || !body) return;
    body.innerHTML = '';
    if (kind === 'wordbook') {
      const learned = getLearnedWords();
      title.textContent = `📖 English Wordbook (${learned.size} / ${D.items.length} words practiced)`;
      const grid = el('div', 'slot-grid');
      D.items.forEach((it) => {
        const c = el('div', 'slot-card');
        const ok = learned.has(it.id);
        c.innerHTML = `<div class="slot-card-head"><strong>${it.en || it.id}</strong><span class="qa-pill ${ok ? 'qa-clean' : 'qa-missing'}">${ok ? 'Learned' : 'Upcoming'}</span></div>` +
          `<div class="fn-sub">${it.kind || 'word'}${it.origin ? ' · ' + it.origin : ''}</div>`;
        grid.append(c);
      });
      body.append(grid);
    } else if (kind === 'journal') {
      const m3 = D.missions.find((m) => m.mechanic === 'scan');
      const scanned = (state.scr === 'mission' && D.missions[state.m] === m3 && state.w && state.w.scanned)
        ? new Set(state.w.scanned)
        : (state.done.includes(m3.id) ? new Set(Object.keys(m3.creatures)) : new Set());
      title.textContent = `🔬 Alien Lake Field Journal (${scanned.size} / ${Object.keys(m3.creatures).length} species)`;
      const grid = el('div', 'slot-grid');
      Object.entries(m3.creatures).forEach(([cid, cr]) => {
        const c = el('div', 'slot-card');
        const cand = resolveCandidate(`thing:${m3.id}:${cid}`);
        const isScanned = scanned.has(cid);
        c.innerHTML = `<div class="slot-card-head"><strong>${cr.name}</strong><span class="qa-pill ${isScanned ? 'qa-clean' : 'qa-missing'}">${isScanned ? 'Scanned' : 'Unscanned'}</span></div>` +
          (cand && cand.rel_asset ? `<img class="slot-thumb" src="${cand.rel_asset}" alt="${cr.name}">` : '') +
          `<div class="fn-sub">Action: <strong>${cr.doing}</strong> · Trait: <strong>${cr.has}</strong></div>`;
        grid.append(c);
      });
      body.append(grid);
    }
    modal.classList.add('open');
  }

  function loadJsonStorage(key, fallback) {
    try {
      const raw = root.localStorage && root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }
  function saveJsonStorage(key, val) {
    try {
      if (root.localStorage) root.localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  let slotOverrides = loadJsonStorage(OVERRIDE_KEY, {});
  let decisions = loadJsonStorage(DECISION_KEY, {});

  function whoLabel(id) {
    return (D.labels && D.labels['speaker_' + id]) || id;
  }

  function resolveCandidate(slotId) {
    const slot = slotMap.get(slotId);
    if (!slot) return null;
    const overrideCid = slotOverrides[slotId];
    if (overrideCid === '__EMPTY__') return null;
    const targetId = overrideCid || slot.live_candidate_id;
    if (!targetId) return null;
    return (slot.candidates || []).find((c) => c.id === targetId) || null;
  }

  function assetUrl(cand) {
    if (!cand || !cand.rel_asset) return null;
    return cand.rel_asset;
  }

  function notify() {
    listeners.forEach((fn) => {
      try { fn(getSnapshot()); } catch (_) {}
    });
  }

  function pushEvents(evs) {
    if (!evs || !evs.length) return;
    evs.forEach((e) => {
      if (e && e.t) dialogue.push({ who: e.who || 'narrator', t: e.t });
    });
    if (dialogue.length > 24) dialogue = dialogue.slice(-24);
  }

  function getSnapshot() {
    return {
      state: JSON.parse(JSON.stringify(state)),
      transitionFor,
      boxMode,
      activeSlots: getActiveSlotIds(),
      where: transitionFor ? ('Transition after ' + transitionFor) : E.where(state),
    };
  }

  function getActiveSlotIds() {
    if (transitionFor && TR[transitionFor]) return [TR[transitionFor].slot];
    if (state.scr === 'intro') {
      const b = D.intro[state.beat];
      return b ? ['story:' + b.id] : [];
    }
    if (state.scr === 'map') {
      return ['map:background'].concat(D.regions.map((r) => 'map:region:' + r.id));
    }
    if (state.scr === 'mission' || state.scr === 'complete') {
      const m = D.missions[state.m];
      if (!m) return [];
      const ids = [`mission:${m.id}:background`];
      if (slotMap.has(`mission:${m.id}:foreground`)) ids.push(`mission:${m.id}:foreground`);
      SLOT_DATA.forEach((s) => {
        if (s.group === m.id && !ids.includes(s.id)) ids.push(s.id);
      });
      return ids;
    }
    return [];
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function posRect(node, rect, layout) {
    const [w, h] = layout.size;
    node.style.left = ((rect.x + rect.w / 2) / w * 100) + '%';
    node.style.top = ((rect.y + rect.h / 2) / h * 100) + '%';
    node.style.width = (rect.w / w * 100) + '%';
    node.style.height = (rect.h / h * 100) + '%';
  }

  function attachSlotImg(parent, slotId, isBg) {
    const cand = resolveCandidate(slotId);
    const url = assetUrl(cand);
    if (!url) return false;
    const img = el('img', isBg ? 'scene-bg-img' : 'slot-img');
    img.alt = '';
    img.src = url;
    img.dataset.slotId = slotId;
    img.dataset.candId = cand.id;
    img.onerror = () => img.remove();
    parent.prepend(img);
    if (!isBg) parent.classList.add('has-art');
    return true;
  }

  function doAction(actId) {
    if (transitionFor) {
      if (actId === 'transition:continue') {
        transitionFor = null;
        if (state.scr === 'complete') {
          state = E.act(state, 'map');
          pushEvents(state.ev);
        }
        render();
        notify();
      }
      return;
    }
    if (!transitionFor && state.scr === 'intro') {
      if (actId === 'skip_intro') {
        jumpTo({ type: 'map', done: state.done, unlocks: state.unlocks });
        return;
      }
      if (actId === 'prev_beat') {
        state.beat = Math.max(0, state.beat - 1);
        const b = D.intro[state.beat];
        if (b) dialogue = [{ who: b.who || 'narrator', t: b.text }];
        render();
        syncAudio();
        notify();
        return;
      }
    }
    const prevScr = state.scr;
    const prevM = state.m;
    const prevStep = state.i;
    const prevWrong = state.wrong;
    const clickedEl = stageEl && stageEl.querySelector(`[data-act="${actId}"]`);
    const mech = (prevScr === 'mission' && prevM >= 0) ? D.missions[prevM].mechanic : null;

    revealedTargets.add(actId);
    state = E.act(state, actId);
    if (state.scr === 'intro') {
      const b = D.intro[state.beat];
      if (b) dialogue = [{ who: b.who || 'narrator', t: b.text }];
    } else if (state.scr === 'map' && prevScr === 'intro') {
      dialogue = [{ who: 'astronaut', t: 'Select a region on the Planet Map to begin your mission.' }];
    }
    if (state.scr !== prevScr || state.m !== prevM || state.i !== prevStep) {
      revealedTargets.clear();
    }
    pushEvents(state.ev);
    // Intercept mission completion to show our Fork Post-Mission Transition Scene!
    if (prevScr === 'mission' && state.scr === 'complete' && prevM >= 0) {
      const m = D.missions[prevM];
      if (m && TR[m.id]) {
        transitionFor = m.id;
      }
      saveProgress();
    }
    render();
    if (root.FORK_DYNAMICS && stageEl) {
      if (state.wrong > prevWrong) root.FORK_DYNAMICS.triggerFx(stageEl, 'wrong', null);
      else if (mech === 'scan' && clickedEl) root.FORK_DYNAMICS.triggerFx(stageEl, 'scan', clickedEl);
      else if (mech === 'fetch' && clickedEl) root.FORK_DYNAMICS.triggerFx(stageEl, 'fetch', clickedEl);
      else if (mech === 'repair' && clickedEl) root.FORK_DYNAMICS.triggerFx(stageEl, 'spark', clickedEl);
    }
    syncAudio();
    notify();
  }

  function jumpTo(target) {
    transitionFor = null;
    dialogue = [];
    if (target.type === 'intro') {
      state = E.fresh();
      state.beat = Math.max(0, Math.min(D.intro.length - 1, target.beat || 0));
      dialogue = [{ who: D.intro[state.beat].who || 'narrator', t: D.intro[state.beat].text }];
    } else if (target.type === 'map') {
      state = E.fresh();
      state.scr = 'map';
      if (target.done) state.done = target.done.slice();
      if (target.unlocks) state.unlocks = target.unlocks.slice();
    } else if (target.type === 'mission') {
      state = E.jump(target.m, target.step || 0);
      pushEvents(state.ev);
    } else if (target.type === 'transition') {
      const idx = D.missions.findIndex((m) => m.id === target.missionId);
      state = E.fresh();
      state.scr = 'complete';
      state.m = idx >= 0 ? idx : 0;
      if (idx >= 0) {
        state.done = D.missions.slice(0, idx + 1).map((m) => m.id);
        state.unlocks = D.missions.slice(0, idx + 1).map((m) => m.unlock);
      }
      transitionFor = target.missionId;
    }
    render();
    notify();
  }

  // Real animated sagging Bezier cables for Mission 1 Repair
  function drawCables(m, layout, targetsOverride) {
    if (!cableSvg || !state.w) return;
    cableSvg.innerHTML = '';
    const [lw, lh] = layout.size;
    cableSvg.setAttribute('viewBox', `0 0 ${lw} ${lh}`);
    const colors = { red: '#ef4444', blue: '#38bdf8', yellow: '#facc15', green: '#22c55e' };

    function pathEl(x1, y1, x2, y2, color, dashed) {
      const sag = Math.max(38, Math.hypot(x2 - x1, y2 - y1) * 0.24);
      const cx = (x1 + x2) / 2;
      const cy = Math.max(y1, y2) + sag;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', color);
      p.setAttribute('stroke-width', '8');
      p.setAttribute('stroke-linecap', 'round');
      if (dashed) p.setAttribute('stroke-dasharray', '12 8');
      cableSvg.appendChild(p);
    }

    const targets = targetsOverride || layout.targets;
    Object.entries(state.w.conn || {}).forEach(([wireId, sockId]) => {
      const wr = targets[wireId], sr = targets[sockId];
      if (!wr || !sr) return;
      const col = colors[wireId.replace('wire_', '')] || '#f59e0b';
      pathEl(wr.x + wr.w / 2, wr.y + wr.h / 2, sr.x + sr.w / 2, sr.y + sr.h / 2, col, false);
    });

    if (drag && drag.wireId) {
      const wr = targets[drag.wireId];
      if (wr) {
        const col = colors[drag.wireId.replace('wire_', '')] || '#f59e0b';
        pathEl(wr.x + wr.w / 2, wr.y + wr.h / 2, drag.x, drag.y, col, true);
      }
    }
  }

  function render() {
    const mount = document.getElementById('game');
    if (!mount) return;
    mount.innerHTML = '';
    const shell = el('div', 'game-root' + (boxMode ? ' box-mode' : ''));

    // HUD
    const hud = el('div', 'hud-bar');
    const title = el('div', 'hud-title', transitionFor ? TR[transitionFor].badge : E.where(state));
    const meta = el('div', 'hud-meta');
    if (state.scr === 'mission') {
      const m = D.missions[state.m];
      meta.append(el('span', '', `Step ${state.i + 1}/${E.stepsOf(state).length}`));
      meta.append(el('span', '', `Power ${state.power}%`));
      const pm = el('div', 'power-meter');
      const pf = el('div', 'power-fill');
      pf.style.width = state.power + '%';
      pm.append(pf);
      meta.append(pm);
      const leaveBtn = el('button', '', 'Map');
      leaveBtn.dataset.act = 'leave';
      leaveBtn.onclick = () => doAction('leave');
      meta.append(leaveBtn);
    } else if (state.scr === 'intro') {
      meta.append(el('span', '', `Beat ${state.beat + 1}/${D.intro.length}`));
      const skipHudBtn = el('button', '', 'Skip Intro ⏭');
      skipHudBtn.dataset.act = 'skip_intro';
      skipHudBtn.onclick = () => doAction('skip_intro');
      meta.append(skipHudBtn);
    } else if (state.scr === 'map') {
      meta.append(el('span', '', `Completed: ${state.done.length}/${D.missions.length}`));
      const replayIntroBtn = el('button', '', '🎬 Story Intro');
      replayIntroBtn.onclick = () => jumpTo({ type: 'intro', beat: 0 });
      meta.append(replayIntroBtn);
    }
    hud.append(title, meta);
    shell.append(hud);

    const wrap = el('div', 'scene-wrap');
    stageEl = el('div', 'scene-stage');
    wrap.append(stageEl);
    shell.append(wrap);

    // 1. Post-Mission Transition / Chapter 1 Ending
    if (transitionFor && TR[transitionFor]) {
      const tr = TR[transitionFor];
      const m = D.missions.find((x) => x.id === transitionFor);
      attachSlotImg(stageEl, tr.slot, true);
      stageEl.append(el('span', 'scene-bg-label', `Transition Scene: ${tr.slot}`));
      const ov = el('div', 'narrative-overlay');
      const card = el('div', 'narrative-card');
      card.append(el('span', 'narrative-badge', tr.badge));
      card.append(el('h2', '', tr.title));
      tr.lines.forEach((ln) => {
        const p = el('p', '', `${whoLabel(ln.who)}: "${ln.t}"`);
        p.dataset.say = ln.who;
        card.append(p);
      });
      if (m) {
        const words = [...new Set(E.prep(m).flatMap((s) => s.items))].slice(0, 10);
        if (words.length) {
          card.append(el('p', '', `Key English words practiced: ${words.join(', ')}`));
        }
      }
      card.append(el('p', '', tr.next_hook));
      const acts = el('div', 'narrative-actions');
      const btn = el('button', 'primary', tr.is_chapter_ending ? 'Return to Planet Map' : 'Continue to Planet Map');
      btn.dataset.act = 'transition:continue';
      btn.onclick = () => doAction('transition:continue');
      acts.append(btn);
      card.append(acts);
      ov.append(card);
      stageEl.append(ov);
    }
    // 2. Intro Story (13 beats)
    else if (state.scr === 'intro') {
      const beat = D.intro[state.beat];
      attachSlotImg(stageEl, 'story:' + beat.id, true);
      stageEl.append(el('span', 'scene-bg-label', `Story Beat ${beat.id} (${state.beat + 1}/${D.intro.length})`));
      const ov = el('div', 'narrative-overlay');
      const card = el('div', 'narrative-card');
      card.append(el('span', 'narrative-badge', `Crash Story · ${whoLabel(beat.who || 'narrator')}`));
      const p = el('p', '', beat.text);
      p.dataset.say = beat.who || 'narrator';
      p.style.fontSize = '16px';
      card.append(p);
      const acts = el('div', 'narrative-actions');
      if (state.beat > 0) {
        const prevBtn = el('button', '', '◀ Back');
        prevBtn.dataset.act = 'prev_beat';
        prevBtn.onclick = () => doAction('prev_beat');
        acts.append(prevBtn);
      }
      const nextBtn = el('button', 'primary', state.beat === D.intro.length - 1 ? 'Open Planet Map' : 'Next ▶');
      nextBtn.dataset.act = 'next';
      nextBtn.onclick = () => doAction('next');
      acts.append(nextBtn);
      if (state.beat < D.intro.length - 1) {
        const skipBtn = el('button', '', 'Skip Intro ⏭');
        skipBtn.dataset.act = 'skip_intro';
        skipBtn.onclick = () => doAction('skip_intro');
        acts.append(skipBtn);
      }
      card.append(acts);
      ov.append(card);
      stageEl.append(ov);
    }
    // 3. Planet Map
    else if (state.scr === 'map') {
      const layout = D.layouts.map;
      attachSlotImg(stageEl, 'map:background', true);
      if (root.FORK_DYNAMICS) root.FORK_DYNAMICS.startAmbient(stageEl, layout);
      stageEl.append(el('span', 'scene-bg-label', D.labels.map_title || 'Planet Map'));
      D.regions.forEach((r) => {
        const rect = layout.targets && (layout.targets['node_' + r.id] || layout.targets[r.id]);
        if (!rect) return;
        const open = E.regionOpen(state, r);
        const rms = D.missions.filter((m) => m.region === r.id);
        const doneCount = rms.filter((m) => state.done.includes(m.id)).length;
        const allDone = rms.length > 0 && doneCount === rms.length;
        const btn = el('button', 'thing map-region-pin' + (open ? (allDone ? ' region-done' : ' region-open') : ' locked'));
        btn.type = 'button';
        btn.dataset.act = 'region:' + r.id;
        const badgeText = !open ? '🔒 Locked' : allDone ? `✓ Done (${doneCount}/${rms.length})` : `▶ Play (${doneCount}/${rms.length})`;
        btn.innerHTML = `<span class="map-pin-title">${r.name}</span><span class="map-pin-sub">${badgeText}</span>`;
        posRect(btn, rect, layout);
        attachSlotImg(btn, 'map:region:' + r.id, false);
        btn.onclick = () => doAction('region:' + r.id);
        stageEl.append(btn);
      });
      if (state.region) {
        const r = D.regions.find((x) => x.id === state.region);
        const pop = el('div', 'region-popup');
        pop.append(el('h3', '', r.name));
        const open = E.regionOpen(state, r);
        if (!open) {
          pop.append(el('p', '', 'Complete earlier missions to unlock this region.'));
        } else {
          const rms = D.missions.filter((m) => m.region === r.id);
          if (!rms.length) {
            pop.append(el('p', '', 'Mountains unlocked! Chapter 2 missions will be built with the Mission Template.'));
          }
          rms.forEach((m) => {
            const k = D.missions.indexOf(m);
            const avail = E.available(state, k);
            const isDone = state.done.includes(m.id);
            const b = el('button', 'mission-btn' + (avail ? ' primary' : ''), `${m.title} (${isDone ? 'Done' : avail ? 'Play' : 'Locked'})`);
            b.dataset.act = 'go:' + m.id;
            b.disabled = !avail;
            b.onclick = () => doAction('go:' + m.id);
            pop.append(b);
          });
        }
        const closeBtn = el('button', '', 'Close');
        closeBtn.style.marginTop = '10px';
        closeBtn.dataset.act = 'close';
        closeBtn.onclick = () => doAction('close');
        pop.append(closeBtn);
        stageEl.append(pop);
      }
    }
    // 4. Active Mission (Repair / Fetch / Scan / Terminal)
    else if (state.scr === 'mission') {
      const m = D.missions[state.m];
      const layout = D.layouts[m.scene];
      const activeActs = new Set(E.actions(state));
      const expected = E.expd(state);
      const glow = E.hintLevel(state) === 2;

      attachSlotImg(stageEl, `mission:${m.id}:background`, true);
      if (root.FORK_DYNAMICS) root.FORK_DYNAMICS.startAmbient(stageEl, layout);
      stageEl.append(el('span', 'scene-bg-label', `${m.title} (${m.mechanic})`));

      // Foreground occlusion layer (M2/M3)
      const fgCand = resolveCandidate(`mission:${m.id}:foreground`);
      if (fgCand && fgCand.rel_asset) {
        const fg = el('img', 'scene-fg-img');
        fg.src = fgCand.rel_asset;
        fg.alt = '';
        fg.onerror = () => fg.remove();
        stageEl.append(fg);
      }

      // Non-destructive visual grounding & item-consistency overrides (keeps tracked Claude app JSON untouched)
      const STAGE_OVERRIDES = {
        m1_wake_robodog: {
          targets: {
            tray_1: { x: 165, y: 310, w: 135, h: 135 },
            tray_2: { x: 165, y: 450, w: 135, h: 135 },
            tray_3: { x: 165, y: 590, w: 135, h: 135 },
            tray_4: { x: 165, y: 730, w: 135, h: 135 },
            cover: { x: 925, y: 360, w: 580, h: 365 },
            screw_1: { x: 938, y: 372, w: 54, h: 54 },
            screw_2: { x: 1438, y: 372, w: 54, h: 54 },
            screw_3: { x: 938, y: 658, w: 54, h: 54 },
            screw_4: { x: 1438, y: 658, w: 54, h: 54 },
            slot: { x: 960, y: 445, w: 145, h: 195 },
            battery_old: { x: 970, y: 450, w: 125, h: 185 },
            battery_new: { x: 1935, y: 360, w: 140, h: 210 },
            socket_top: { x: 1200, y: 382, w: 86, h: 86 },
            socket_bottom: { x: 1200, y: 615, w: 86, h: 86 },
            socket_left: { x: 1110, y: 498, w: 86, h: 86 },
            socket_right: { x: 1290, y: 498, w: 86, h: 86 },
            wire_red: { x: 1365, y: 385, w: 135, h: 56 },
            wire_blue: { x: 1365, y: 465, w: 135, h: 56 },
            wire_yellow: { x: 1365, y: 545, w: 135, h: 56 },
            wire_green: { x: 1365, y: 625, w: 135, h: 56 },
            switch: { x: 1960, y: 695, w: 110, h: 130 },
          },
        },
        m2_salvage: {
          anchors: {
            astronaut: { x: 265, y: 910 },
            robodog_home: { x: 475, y: 910 },
          },
          targets: {
            toolbox: { x: 640, y: 625, w: 165, h: 125 },
            box_big: { x: 840, y: 685, w: 235, h: 175 },
            flashlight: { x: 1185, y: 715, w: 160, h: 95 },
            oxygen_tank: { x: 1130, y: 465, w: 118, h: 170 },
            box_small: { x: 1640, y: 560, w: 130, h: 98 },
            helmet: { x: 1850, y: 470, w: 145, h: 135 },
            medical_kit: { x: 2010, y: 610, w: 155, h: 130 },
          },
        },
        m3_fauna_survey: {
          anchors: {
            astronaut: { x: 280, y: 885 },
            robodog_home: { x: 465, y: 905 },
          },
          targets: {
            flyer: { x: 1130, y: 115, w: 300, h: 200 },
            sleeper: { x: 540, y: 605, w: 195, h: 140 },
            runner: { x: 880, y: 760, w: 225, h: 155 },
            hider: { x: 1330, y: 755, w: 175, h: 145 },
            swimmer: { x: 1380, y: 485, w: 190, h: 125 },
            grazer: { x: 1740, y: 540, w: 320, h: 225 },
          },
        },
        m4_black_box: {
          anchors: {
            astronaut: { x: 260, y: 885 },
          },
        },
      };
      const ov = STAGE_OVERRIDES[m.id] || {};
      const userOv = (userLayoutOverrides && userLayoutOverrides[m.id]) || {};
      const effTargets = Object.assign({}, layout.targets || {}, ov.targets || {}, userOv.targets || {});
      const effAnchors = Object.assign({}, layout.anchors || {}, ov.anchors || {}, userOv.anchors || {});

      stageEl.classList.add('label-mode-' + labelMode);
      if (labelMode === 'smart') stageEl.classList.add('challenge-mode');
      if (layoutEditMode) stageEl.classList.add('layout-edit-mode');

      // Subtle 2.5D pointer parallax on background & foreground layers
      if (!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        stageEl.onpointermove = (ev) => {
          if (layoutEditMode || drag) return;
          const r = stageEl.getBoundingClientRect();
          const nx = ((ev.clientX - r.left) / r.width - 0.5) * 2;
          const ny = ((ev.clientY - r.top) / r.height - 0.5) * 2;
          const bgImg = stageEl.querySelector('.scene-bg-img');
          const fgImg = stageEl.querySelector('.scene-fg-img');
          if (bgImg) bgImg.style.transform = `scale(1.02) translate(${(-nx * 5).toFixed(1)}px, ${(-ny * 3).toFixed(1)}px)`;
          if (fgImg) fgImg.style.transform = `scale(1.02) translate(${(-nx * 10).toFixed(1)}px, ${(-ny * 5).toFixed(1)}px)`;
        };
      }

      // Helper for Studio Drag-to-Place
      function attachDragToPlace(node, kind, key, rectOrAnchor) {
        if (!layoutEditMode) return;
        node.classList.add('draggable-item');
        node.onpointerdown = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          const sr = stageEl.getBoundingClientRect();
          const [lw, lh] = layout.size;
          const startX = ev.clientX;
          const startY = ev.clientY;
          const origX = rectOrAnchor.x;
          const origY = rectOrAnchor.y;
          const onMove = (me) => {
            const dx = (me.clientX - startX) / sr.width * lw;
            const dy = (me.clientY - startY) / sr.height * lh;
            const nx = Math.round(origX + dx);
            const ny = Math.round(origY + dy);
            if (kind === 'target') {
              const nr = { x: nx, y: ny, w: rectOrAnchor.w, h: rectOrAnchor.h };
              posRect(node, nr, layout);
              userLayoutOverrides[m.id] = userLayoutOverrides[m.id] || { targets: {}, anchors: {} };
              userLayoutOverrides[m.id].targets = userLayoutOverrides[m.id].targets || {};
              userLayoutOverrides[m.id].targets[key] = nr;
            } else {
              const w = rectOrAnchor.w, h = rectOrAnchor.h;
              posRect(node, { x: nx - w / 2, y: ny - h, w, h }, layout);
              userLayoutOverrides[m.id] = userLayoutOverrides[m.id] || { targets: {}, anchors: {} };
              userLayoutOverrides[m.id].anchors = userLayoutOverrides[m.id].anchors || {};
              userLayoutOverrides[m.id].anchors[key] = { x: nx, y: ny };
            }
          };
          const onUp = () => {
            root.removeEventListener('pointermove', onMove);
            root.removeEventListener('pointerup', onUp);
            saveJsonStorage(LAYOUT_OV_KEY, userLayoutOverrides);
            notify();
          };
          root.addEventListener('pointermove', onMove);
          root.addEventListener('pointerup', onUp);
        };
      }

      // Characters (M2/M3/M4/M5)
      Object.entries(effAnchors).forEach(([k, anchor]) => {
        if (k !== 'astronaut' && k !== 'robodog_home') return;
        const who = k === 'astronaut' ? 'astronaut' : 'robodog';
        const shape = D.characterAnchors[who === 'astronaut' ? 'astronaut_talk' : 'robodog_stand'];
        const h = who === 'astronaut' ? 215 : 175;
        const w = h * shape.size[0] / shape.size[1];
        const ch = el('div', 'thing inert character');
        ch.dataset.thing = 'character:' + who;
        posRect(ch, { x: anchor.x - w / 2, y: anchor.y - h, w, h }, layout);
        ch.append(el('span', 'thing-label', whoLabel(who)));
        attachSlotImg(ch, `character:${m.id}:${who}`, false);
        attachDragToPlace(ch, 'anchor', k, { x: anchor.x, y: anchor.y, w, h });
        stageEl.append(ch);
      });

      function makeThing(id, label, rect, extraCls) {
        const useRect = (extraCls && (extraCls.includes('open') || extraCls.includes('battery-installed'))) ? rect : ((effTargets && effTargets[id]) || rect);
        const canClick = activeActs.has(id);
        const node = canClick ? el('button', 'thing ' + (extraCls || '')) : el('div', 'thing inert ' + (extraCls || ''));
        if (canClick) {
          node.type = 'button';
          node.dataset.act = id;
          node.onclick = () => {
            if (layoutEditMode) return;
            if (suppressClick) { suppressClick = false; return; }
            doAction(id);
          };
        }
        node.dataset.thing = id;
        node.append(el('span', 'thing-label', label));
        posRect(node, useRect, layout);
        attachSlotImg(node, `thing:${m.id}:${id}`, false);
        const isExpected = expected.includes(id);
        if (glow && isExpected) node.classList.add('glow');
        if (revealedTargets.has(id) || (glow && isExpected) || (labelMode === 'study' && state.wrong >= 1 && isExpected)) {
          node.classList.add('label-revealed');
        }
        attachDragToPlace(node, 'target', id, useRect);
        stageEl.append(node);
        return node;
      }

      if (m.mechanic === 'repair') {
        const w = state.w;
        const t = layout.targets;
        if (!w.open) {
          makeThing('cover', E.nm(m, 'cover'), t.cover, 'cover');
          [1, 2, 3, 4].forEach((k) => {
            if (!w.out.includes('screw_' + k)) makeThing('screw_' + k, E.nm(m, 'screw_' + k), t['screw_' + k]);
          });
        } else {
          // Place the removed cover lid cleanly in the upper-right bay once the battery is installed (or bottom-right while the new battery is still sitting in the upper-right dock)
          const readyToClose = expected.includes('cover');
          const lidX = (w.nb === 'slot') ? 1850 : 1625;
          const lidY = (w.nb === 'slot') ? 310 : 785;
          const parkedCover = Object.assign({}, t.cover, { x: lidX, y: lidY, w: 300, h: 180 });
          makeThing('cover', readyToClose ? 'Close the panel (click here)' : (E.nm(m, 'cover') + ' (lid)'), parkedCover,
            'cover open' + (readyToClose ? ' cover-ready label-revealed' : ''));
          // Also allow clicking directly on the open chest cavity to close the panel on Step 11!
          if (readyToClose) {
            const bayClose = el('button', 'thing cover-bay-target label-revealed');
            bayClose.type = 'button';
            bayClose.dataset.act = 'cover';
            bayClose.append(el('span', 'thing-label', 'Click panel lid or chest bay to close'));
            posRect(bayClose, effTargets.cover || t.cover, layout);
            bayClose.onclick = () => {
              if (layoutEditMode) return;
              doAction('cover');
            };
            stageEl.append(bayClose);
          }
          makeThing('slot', E.nm(m, 'slot'), t.slot);
          if (!w.oldOut) makeThing('battery_old', E.nm(m, 'battery_old'), t.battery_old);
          else if (w.nb === 'slot') makeThing('battery_new', E.nm(m, 'battery_new') + ' (Installed)', effTargets.slot || t.slot, 'battery-installed');
          ['top', 'bottom', 'left', 'right'].forEach((s) => makeThing('socket_' + s, E.nm(m, 'socket_' + s), t['socket_' + s]));
          ['red', 'blue', 'yellow', 'green'].forEach((c) => {
            const wid = 'wire_' + c;
            if (!w.conn[wid]) {
              const wn = makeThing(wid, E.nm(m, wid), t[wid], w.pend === wid ? 'wire-selected' : '');
              wn.onpointerdown = (ev) => {
                if (!activeActs.has(wid)) return;
                const sr = stageEl.getBoundingClientRect();
                const [lw, lh] = layout.size;
                drag = {
                  wireId: wid,
                  startX: ev.clientX, startY: ev.clientY,
                  x: (ev.clientX - sr.left) / sr.width * lw,
                  y: (ev.clientY - sr.top) / sr.height * lh,
                  moved: false,
                };
                if (w.pend !== wid) {
                  state = E.act(state, wid);
                  pushEvents(state.ev);
                }
                const onMove = (me) => {
                  if (!drag) return;
                  if (Math.hypot(me.clientX - drag.startX, me.clientY - drag.startY) > 6) drag.moved = true;
                  drag.x = (me.clientX - sr.left) / sr.width * lw;
                  drag.y = (me.clientY - sr.top) / sr.height * lh;
                  drawCables(m, layout, effTargets);
                };
                const onUp = (ue) => {
                  root.removeEventListener('pointermove', onMove);
                  root.removeEventListener('pointerup', onUp);
                  const d = drag;
                  drag = null;
                  if (d && d.moved) {
                    suppressClick = true;
                    const hit = document.elementsFromPoint(ue.clientX, ue.clientY)
                      .find((x) => x.dataset && x.dataset.act && x.dataset.act.startsWith('socket_'));
                    if (hit) doAction(hit.dataset.act);
                    else { render(); notify(); }
                  } else {
                    render(); notify();
                  }
                };
                root.addEventListener('pointermove', onMove);
                root.addEventListener('pointerup', onUp);
              };
            }
          });
        }
        makeThing('switch', E.nm(m, 'switch'), t.switch, w.on ? 'switch-on' : '');
        if (w.nb === 'tray' || w.nb === 'held') {
          makeThing('battery_new', w.nb === 'held' ? (E.nm(m, 'battery_new') + ' (Held)') : E.nm(m, 'battery_new'),
            t.battery_new, w.nb === 'held' ? 'glow label-revealed' : '');
        }
        m.tools.forEach((tool, idx) => {
          const id = 'tool:' + tool;
          const rect = effTargets[tool] || effTargets['tray_' + (idx + 1)] || t[tool] || t['tray_' + (idx + 1)];
          if (rect) makeThing(id, E.nm(m, tool), rect, w.tool === tool ? 'glow' : '');
        });
        cableSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        cableSvg.setAttribute('class', 'cable-svg');
        stageEl.append(cableSvg);
        drawCables(m, layout, effTargets);
        // Live 4-LED Circuit Status Bar + Apollo Scout Ring-Eye Visor Status Indicator
        const allWired = ['red', 'blue', 'yellow', 'green'].every((c) => !!(w.conn && w.conn['wire_' + c]));
        const eyeReady = w.nb === 'slot' && allWired;
        const ledBar = el('div', 'm1-led-bar');
        const visorPill = el('span', 'm1-visor-pill ' + (w.on ? 'awake' : (eyeReady ? 'ready' : 'offline')),
          w.on ? '◉ ROBODOG VISOR: AWAKE' : (eyeReady ? '◎ VISOR: READY FOR SWITCH' : '○ VISOR: OFFLINE'));
        ledBar.append(visorPill);
        ['red', 'blue', 'yellow', 'green'].forEach((c) => {
          const on = !!(w.conn && w.conn['wire_' + c]);
          ledBar.append(el('span', 'm1-led ' + (on ? 'on' : ''), c.toUpperCase()));
        });
        stageEl.append(ledBar);
      } else if (m.mechanic === 'fetch') {
        m.placement.forEach((p) => {
          if (state.w.del.includes(p.id)) return;
          const rect = layout.targets[p.slot] || layout.targets[p.id];
          if (rect) makeThing(p.id, p.name, rect);
        });
      } else if (m.mechanic === 'scan') {
        Object.entries(m.creatures).forEach(([cid, c]) => {
          const rect = layout.targets[cid];
          if (!rect) return;
          const hasArt = !!resolveCandidate(`thing:${m.id}:${cid}`);
          const isScanned = !!(state.w && state.w.scanned && state.w.scanned.includes(cid));
          const lbl = (hasArt && !boxMode ? c.name : `${c.name} (${c.doing} · ${c.has})`) + (isScanned ? ' ✓' : '');
          const motion = layout.creatures && layout.creatures[cid] && layout.creatures[cid].motion;
          makeThing(cid, lbl, rect, (motion ? ('motion-' + motion) : '') + (isScanned ? ' creature-scanned' : ''));
        });
      } else if (m.mechanic === 'terminal') {
        const sp = E.stepsOf(state)[state.i];
        const tb = el('div', 'terminal-box cockpit-bezel terminal-scene-' + m.scene);
        const tbHead = el('div', 'terminal-bezel-head');
        const termTitle = m.scene === 'mountains'
          ? 'APOLLO SCOUT · MOUNTAIN RESCUE BEACON'
          : (D.labels.terminal_title || 'APOLLO SCOUT · SHIP CORE BLACK BOX');
        tbHead.append(el('div', 'narrative-badge', termTitle));
        const sigLeds = el('div', 'terminal-leds');
        const totalSteps = E.stepsOf(state).length;
        for (let k = 0; k < totalSteps; k++) {
          sigLeds.append(el('span', 't-led' + (k < state.i ? ' done' : (k === state.i ? ' active' : ''))));
        }
        tbHead.append(sigLeds);
        tb.append(tbHead);
        const blanks = sp ? sp.groups.map((g) => g[0]) : [];
        let lineText = sp ? sp.line : '';
        blanks.forEach((b, idx) => {
          const filled = idx < state.g;
          lineText = lineText.replace('{' + b + '}', filled ? `[ ${b.toUpperCase()} ]` : '[ ______ ]');
        });
        const lEl = el('div', 'terminal-line', lineText);
        lEl.dataset.say = 'terminal';
        tb.append(lEl);
        const subHint = el('div', 'terminal-prompt-sub', sp && sp.say ? `Robodog: "${sp.say}"` : 'Select the matching English word from the console below:');
        tb.append(subHint);
        stageEl.append(tb);

        const bank = el('div', 'terminal-bank terminal-bank-dock');
        E.bank(m).forEach((word) => {
          const wb = el('button', glow && expected.includes(word) ? 'glow' : '', word);
          wb.dataset.act = word;
          wb.onclick = () => doAction(word);
          bank.append(wb);
        });
        stageEl.append(bank);
      }
    }
    // 5. Fallback complete (when no transition configured)
    else if (state.scr === 'complete') {
      const ov = el('div', 'narrative-overlay');
      const card = el('div', 'narrative-card');
      card.append(el('h2', '', 'Mission Complete'));
      const btn = el('button', 'primary', 'Return to Map');
      btn.dataset.act = 'map';
      btn.onclick = () => doAction('map');
      card.append(btn);
      ov.append(card);
      stageEl.append(ov);
    }

    // Dialogue Strip with Character Portraits
    const dStrip = el('section', 'dialogue-strip');
    dStrip.setAttribute('aria-label', 'Spoken lines');
    if (!dialogue.length && state.scr === 'mission') {
      const sp = E.stepsOf(state)[state.i];
      if (sp && sp.say) dialogue.push({ who: 'robodog', t: sp.say });
    }
    const reedPortrait = resolveCandidate('character:m2_salvage:astronaut');
    const dogPortrait = resolveCandidate('character:m2_salvage:robodog');
    dialogue.forEach((ev, idx) => {
      const isLatest = idx === dialogue.length - 1;
      const row = el('div', 'speech-row' + (isLatest ? ' latest-row' : ''));
      const portSrc = ev.who === 'robodog' ? (dogPortrait && dogPortrait.rel_asset) : (ev.who === 'astronaut' ? (reedPortrait && reedPortrait.rel_asset) : null);
      if (portSrc) {
        const av = el('img', 'speech-avatar');
        av.src = portSrc;
        av.alt = whoLabel(ev.who);
        row.append(av);
      }
      row.append(el('span', 'speech-who', whoLabel(ev.who)));
      const p = el('p', 'speech-text' + (isLatest ? ' latest' : ''), ev.t);
      p.dataset.say = ev.who;
      row.append(p);
      dStrip.append(row);
    });
    shell.append(dStrip);
    mount.append(shell);
    dStrip.scrollTop = dStrip.scrollHeight;
  }

  // Public Game API (shared by play page, studio workbench, and Playwright verification)
  root.FORK_GAME = {
    init() {
      const saved = loadJsonStorage(SAVE_KEY, null);
      if (saved && Array.isArray(saved.done) && saved.done.length) {
        state.done = saved.done.slice();
        state.unlocks = (saved.unlocks || []).slice();
      }
      dialogue = [{ who: D.intro[0].who || 'narrator', t: D.intro[0].text }];
      const sb = document.getElementById('btn-sound-toggle');
      if (sb) {
        sb.onclick = () => {
          soundEnabled = !soundEnabled;
          sb.textContent = soundEnabled ? '🔊 Sound: On' : '🔇 Sound: Off';
          sb.classList.toggle('active', soundEnabled);
          syncAudio();
        };
      }
      const cb = document.getElementById('btn-challenge-mode');
      function syncLabelBtn() {
        if (!cb) return;
        const map = {
          smart: '🎯 Labels: Smart (Learn)',
          study: '🎓 Labels: Study (On Mistake)',
          all: '🔧 Labels: All On',
        };
        cb.textContent = map[labelMode] || map.smart;
        cb.classList.toggle('active', labelMode === 'smart');
      }
      if (cb) {
        syncLabelBtn();
        cb.onclick = () => {
          const order = ['smart', 'study', 'all'];
          labelMode = order[(order.indexOf(labelMode) + 1) % order.length];
          saveJsonStorage(LABEL_MODE_KEY, labelMode);
          syncLabelBtn();
          render();
        };
      }
      const lb = document.getElementById('btn-layout-edit');
      if (lb) {
        lb.onclick = () => {
          layoutEditMode = !layoutEditMode;
          lb.textContent = layoutEditMode ? '📐 Drag-to-Place: ON' : '📐 Drag-to-Place: Off';
          lb.classList.toggle('active', layoutEditMode);
          render();
        };
      }
      const wb = document.getElementById('btn-wordbook');
      if (wb) wb.onclick = () => openDrawer('wordbook');
      const jb = document.getElementById('btn-journal');
      if (jb) jb.onclick = () => openDrawer('journal');
      const dc = document.getElementById('drawer-close');
      if (dc) dc.onclick = () => {
        const m = document.getElementById('drawer-modal');
        if (m) m.classList.remove('open');
      };
      render();
      notify();
    },
    act: doAction,
    jumpTo,
    openDrawer,
    setSoundEnabled(v) {
      soundEnabled = !!v;
      const sb = document.getElementById('btn-sound-toggle');
      if (sb) {
        sb.textContent = soundEnabled ? '🔊 Sound: On' : '🔇 Sound: Off';
        sb.classList.toggle('active', soundEnabled);
      }
      syncAudio();
    },
    reset() {
      state = E.fresh();
      transitionFor = null;
      saveJsonStorage(SAVE_KEY, { done: [], unlocks: [] });
      dialogue = [{ who: D.intro[0].who || 'narrator', t: D.intro[0].text }];
      render();
      syncAudio();
      notify();
    },
    getSnapshot,
    setBoxMode(v) { boxMode = !!v; render(); notify(); },
    setSlotOverride(slotId, candId) {
      if (!candId) delete slotOverrides[slotId];
      else slotOverrides[slotId] = candId;
      saveJsonStorage(OVERRIDE_KEY, slotOverrides);
      render();
      notify();
    },
    getSlotOverrides() { return { ...slotOverrides }; },
    setDecision(slotId, status, candId) {
      decisions[slotId] = {
        slot_id: slotId,
        approval: status,
        candidate_id: candId || (resolveCandidate(slotId) && resolveCandidate(slotId).id) || null,
        updated_at: new Date().toISOString(),
      };
      saveJsonStorage(DECISION_KEY, decisions);
    },
    getDecisions() { return { ...decisions }; },
    resolveCandidate,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    nextRightAction() {
      if (transitionFor) return { act: 'transition:continue', why: 'Finish post-mission scene and return to Planet Map.' };
      const a = E.nextRight(state);
      if (!a) return null;
      let why = `Execute canonical next action "${a}"`;
      if (state.scr === 'intro') why = `Advance intro story beat ${state.beat + 1}/${D.intro.length}.`;
      else if (state.scr === 'map') why = `Navigate map via "${a}".`;
      else if (state.scr === 'mission') {
        const sp = E.stepsOf(state)[state.i];
        why = `Step ${state.i + 1}: "${sp.say || sp.line || ''}" -> expected target "${a}".`;
      }
      return { act: a, why };
    },
    findWrongAction() {
      if (transitionFor || state.scr !== 'mission') return null;
      const exp = E.expd(state);
      const bad = E.clk(state).find((x) => !exp.includes(x));
      return bad || null;
    },
  };
})(window);
