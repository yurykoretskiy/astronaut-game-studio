// #claude — game rules of the Astronaut SDK as a small pure state machine.
// No drawing here: the page (index.html) and the QA explorer both call this.
// Rules mirrored from the SDK snapshot:
//   mission_controller.dart  mistake ladder, power meter, recharge, review steps
//   mechanics/repair.dart    which parts are clickable in which state
//   mechanics/fetch.dart, scan.dart, terminal.dart   right / wrong reactions
//   map/map_screen.dart      region lock, mission order
(function (root) {
  const D = root.SDK, MS = D.missions;
  const NOREVIEW = new Set(['repair', 'fetch']);
  const POWER = { full: 100, mistake: 10, step: 15 };
  const WIRES = ['red', 'blue', 'yellow', 'green'];
  const SOCKETS = ['top', 'bottom', 'left', 'right'];

  // First template of a reaction line, with {got}/{Got} style fills.
  function L(k, v = {}) {
    const t = (D.lines[k] || [k])[0];
    return t.replace(/\{(\w+)\}/g, (_, a) => {
      const x = String(v[a.toLowerCase()] ?? '');
      return a[0] === a[0].toUpperCase() ? x.charAt(0).toUpperCase() + x.slice(1) : x;
    });
  }

  const prepCache = {};
  function prep(m) {
    if (prepCache[m.id]) return prepCache[m.id];
    return (prepCache[m.id] = m.steps.map((s) => {
      if (m.mechanic === 'repair') return { say: s.say, items: s.items, groups: s.do };
      if (m.mechanic === 'terminal') {
        const blanks = [...s.line.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
        return { say: '', line: s.line, items: Object.values(s.items), groups: blanks.map((b) => [b]) };
      }
      return { say: s.say, items: s.items, groups: [[s.target]], clue: s.clue };
    }));
  }
  // Steps of the running mission: the scripted ones plus any that came back for review.
  function stepsOf(st) {
    const base = prep(MS[st.m]);
    return base.concat((st.rev || []).map((i) => ({ ...base[i], review: true })));
  }

  function world0(mech) {
    if (mech === 'repair') return { tool: null, out: [], open: false, oldOut: false, nb: 'tray', pend: null, conn: {}, on: false };
    if (mech === 'fetch') return { del: [] };
    if (mech === 'scan') return { scanned: [] };
    return { filled: 0 };
  }

  function fresh() {
    return { scr: 'intro', beat: 0, region: null, m: -1, i: 0, g: 0, tap: [], wrong: 0, power: POWER.full, done: [], unlocks: [], w: null, rev: [], ev: [] };
  }

  function bank(m) {
    return prep(m).flatMap((s) => s.groups.map((g) => g[0]));
  }

  function nm(m, id) {
    if (m.mechanic === 'repair') return m.names[id] || id;
    if (m.mechanic === 'fetch') return (m.placement.find((p) => p.id === id) || {}).name || id;
    if (m.mechanic === 'scan') return (m.creatures[id] || {}).name || id;
    return id;
  }

  // What the step still waits for.
  function expd(st) {
    if (st.scr !== 'mission') return [];
    const sp = stepsOf(st)[st.i];
    if (!sp) return [];
    return sp.groups[st.g].filter((x) => !st.tap.includes(x));
  }

  // Everything the player can click on the mission screen right now.
  function clk(st) {
    const m = MS[st.m], w = st.w;
    if (m.mechanic === 'repair') {
      const a = m.tools.map((t) => 'tool:' + t);
      if (w.nb === 'tray') a.push('battery_new');
      if (w.open) {
        // SDK: an open cover is only clickable when the step asks to close it.
        if (expd(st).includes('cover')) a.push('cover');
        a.push('slot');
        SOCKETS.forEach((s) => a.push('socket_' + s));
        WIRES.forEach((c) => { if (!w.conn['wire_' + c]) a.push('wire_' + c); });
        if (!w.oldOut) a.push('battery_old');
      } else {
        a.push('cover');
        [1, 2, 3, 4].forEach((k) => { if (!w.out.includes('screw_' + k)) a.push('screw_' + k); });
      }
      a.push('switch');
      return a;
    }
    if (m.mechanic === 'fetch') return m.placement.map((p) => p.id).filter((x) => !w.del.includes(x));
    if (m.mechanic === 'scan') return Object.keys(m.creatures);
    return bank(m);
  }

  function regionOpen(st, r) { return !r.unlockedBy || st.unlocks.includes(r.unlockedBy); }
  function available(st, k) { return k === 0 || st.done.includes(MS[k - 1].id); }

  // Every action possible in this state (right, wrong and navigation).
  function actions(st) {
    if (st.scr === 'intro') return ['next'];
    if (st.scr === 'complete') return ['map'];
    if (st.scr === 'map') {
      if (!st.region) return D.regions.map((r) => 'region:' + r.id);
      const r = D.regions.find((x) => x.id === st.region), a = ['close'];
      if (regionOpen(st, r)) MS.forEach((m, k) => { if (m.region === r.id && available(st, k)) a.push('go:' + m.id); });
      return a;
    }
    return clk(st).concat(['leave']);
  }

  function applyWorld(w, m, t) {
    if (m.mechanic === 'repair') {
      if (t.startsWith('tool:')) w.tool = t.slice(5);
      else if (t.startsWith('screw_')) w.out.push(t);
      else if (t === 'cover') w.open = !w.open;
      else if (t === 'battery_old') w.oldOut = true;
      else if (t === 'battery_new') w.nb = 'held';
      else if (t === 'slot') w.nb = 'slot';
      else if (t.startsWith('wire_')) w.pend = t;
      else if (t.startsWith('socket_') && w.pend) { w.conn[w.pend] = t; w.pend = null; }
      else if (t === 'switch') w.on = true;
    } else if (m.mechanic === 'fetch') w.del.push(t);
    else if (m.mechanic === 'scan') { if (!w.scanned.includes(t)) w.scanned.push(t); }
    else w.filled++;
  }

  function start(st, k) {
    const m = MS[k];
    Object.assign(st, { scr: 'mission', m: k, i: 0, g: 0, tap: [], wrong: 0, power: POWER.full, rev: [], w: world0(m.mechanic) });
    st.ev.push({ who: 'astronaut', t: m.intro });
    const s0 = stepsOf(st)[0];
    if (s0.say) st.ev.push({ who: 'astronaut', t: s0.say });
  }

  function toMap(st) { Object.assign(st, { scr: 'map', region: null, m: -1, w: null, i: 0, g: 0, tap: [], wrong: 0, rev: [] }); }

  // One click. Returns a new state; st.ev holds what was said, st.last what happened.
  function act(s0, id) {
    const st = JSON.parse(JSON.stringify(s0));
    st.ev = []; st.last = null;
    const say = (who, t) => st.ev.push({ who, t });
    if (st.scr === 'intro') {
      if (st.beat < D.intro.length - 1) st.beat++; else toMap(st);
      return st;
    }
    if (st.scr === 'complete') { toMap(st); return st; }
    if (st.scr === 'map') {
      if (id === 'close') st.region = null;
      else if (id.startsWith('region:')) st.region = id.slice(7);
      else if (id.startsWith('go:')) start(st, MS.findIndex((m) => m.id === id.slice(3)));
      return st;
    }
    if (id === 'leave') { st.last = { id, kind: 'leave' }; toMap(st); return st; }

    const m = MS[st.m], sp = stepsOf(st)[st.i], ex = expd(st);
    if (ex.includes(id)) {
      applyWorld(st.w, m, id);
      st.tap.push(id);
      st.last = { id, kind: 'right' };
      if (m.mechanic === 'fetch') say('robodog', L('fetch_right', { got: nm(m, id) }));
      if (m.mechanic === 'scan') say('robodog', L('scan_right'));
      if (expd(st).length === 0) { st.g++; st.tap = []; }
      if (st.g >= sp.groups.length) {
        // Needed the strong hint: the step comes back once at the end (scan, terminal only).
        if (st.wrong >= 3 && !sp.review && !NOREVIEW.has(m.mechanic) && !st.qa) st.rev.push(st.i);
        if (!st.qa) st.power = Math.min(POWER.full, st.power + POWER.step);
        st.i++; st.g = 0; st.wrong = 0;
        const S = stepsOf(st);
        if (st.i >= S.length) {
          st.scr = 'complete';
          if (!st.done.includes(m.id)) st.done.push(m.id);
          if (!st.unlocks.includes(m.unlock)) st.unlocks.push(m.unlock);
          m.outro.forEach((l) => say(l.who, l.say));
        } else if (S[st.i].say) say('astronaut', S[st.i].say);
      }
      return st;
    }

    // Wrong click: the world does not change; power drops; help grows.
    st.wrong = st.qa ? Math.min(st.wrong + 1, 3) : st.wrong + 1;
    st.last = { id, kind: 'wrong' };
    if (!st.qa) st.power = Math.max(0, st.power - POWER.mistake);
    const want = ex[0];
    if (m.mechanic === 'repair') say('astronaut', L('wrong_item', { got: nm(m, id), want: nm(m, want) }));
    else if (m.mechanic === 'fetch') {
      say('robodog', L('fetch_wrong', { got: nm(m, id) }));
      say('astronaut', L('wrong_item', { got: nm(m, id), want: nm(m, want) }));
    } else if (m.mechanic === 'scan') {
      const c = sp.clue === 'has' ? 'has' : 'doing';
      say('robodog', L(c === 'has' ? 'scan_wrong_has' : 'scan_wrong', { [c]: m.creatures[id][c], want: m.creatures[want][c] }));
    } else say('computer', st.wrong >= 3 ? L('terminal_reveal_bank', { answer: want }) : L('terminal_wrong'));
    if (st.power <= 0) {
      say('robodog', L('recharge'));
      st.power = POWER.full;
      st.wrong = Math.max(st.wrong, 2);
      st.last.recharge = true;
    }
    if (st.wrong >= 2 && sp.say) say('astronaut', '(slowly) ' + sp.say);
    return st;
  }

  // 0 none, 1 emphasis, 2 the target glows (controller.hintLevel).
  function hintLevel(st) { return st.wrong <= 1 ? 0 : Math.min(st.wrong - 1, 2); }

  function key(st) {
    return JSON.stringify([st.scr, st.beat, st.region, st.m, st.i, st.g, [...st.tap].sort(), st.wrong, [...st.done].sort(), st.w]);
  }
  const isGoal = (st) => st.scr === 'map' && st.done.length === MS.length;

  // The next click of the correct path, or null at the end of the content.
  function nextRight(st) {
    if (st.scr === 'intro') return 'next';
    if (st.scr === 'complete') return 'map';
    if (st.scr === 'mission') return expd(st)[0];
    const k = MS.findIndex((m) => !st.done.includes(m.id));
    if (k < 0) return null;
    const want = 'region:' + MS[k].region;
    if (st.region !== MS[k].region) return st.region ? 'close' : want;
    return 'go:' + MS[k].id;
  }

  function where(st) {
    if (st.scr === 'intro') return 'Story beat ' + (st.beat + 1);
    if (st.scr === 'map') return 'Map' + (st.region ? ' › ' + st.region : '') + ' (' + st.done.length + ' done)';
    const m = MS[st.m];
    if (st.scr === 'complete') return m.title + ' › complete';
    return m.title + ' › step ' + (st.i + 1);
  }

  // Jump straight to a step by playing the correct path of that mission.
  function jump(k, stepIdx) {
    let st = fresh();
    toMap(st);
    for (let j = 0; j < k; j++) { st.done.push(MS[j].id); st.unlocks.push(MS[j].unlock); }
    start(st, k);
    let guard = 0;
    while (st.scr === 'mission' && st.i < stepIdx && guard++ < 500) st = act(st, expd(st)[0]);
    return st;
  }

  // ---------- QA explorer ----------
  // Walks every reachable state through every possible click (right, wrong, leave).
  function explore() {
    const s0 = fresh(); s0.qa = true;
    const seen = new Map([[key(s0), s0]]), queue = [s0], edges = [];
    const out = { blocked: [], deadEnds: [], worldChanged: [], noWrong: [], declared: [], count: { right: 0, wrong: 0, nav: 0 } };
    while (queue.length) {
      const s = queue.shift(), k = key(s), as = actions(s);
      if (!as.length) out.deadEnds.push(where(s));
      if (s.scr === 'mission') {
        const ex = expd(s), c = clk(s);
        ex.forEach((e) => { if (!c.includes(e)) out.blocked.push(where(s) + ': "' + e + '" is expected but not on screen'); });
        if (s.wrong === 0 && s.tap.length === 0 && !c.some((x) => !ex.includes(x))) out.noWrong.push(where(s));
      }
      if (s.scr === 'map' && s.region) {
        const r = D.regions.find((x) => x.id === s.region);
        const has = MS.some((m) => m.region === r.id);
        const msg = !regionOpen(s, r) ? r.name + ': locked — "' + D.text.map_locked + '"' : !has ? r.name + ': open but empty — "' + D.text.map_empty + '"' : null;
        if (msg && !out.declared.includes(msg)) out.declared.push(msg);
      }
      for (const a of as) {
        const n = act(s, a); n.qa = true; n.ev = [];
        const nk = key(n);
        edges.push([k, nk]);
        if (s.scr === 'mission' && a !== 'leave') {
          if (expd(s).includes(a)) out.count.right++;
          else {
            out.count.wrong++;
            if (JSON.stringify(n.w) !== JSON.stringify(s.w) || n.i !== s.i || n.g !== s.g) out.worldChanged.push(where(s) + ': wrong click on "' + a + '" changed the scene');
          }
        } else out.count.nav++;
        if (!seen.has(nk)) { seen.set(nk, n); queue.push(n); }
      }
    }
    // Can every state still reach "all missions done"? Walk the graph backwards from the goal.
    const back = new Map();
    edges.forEach(([a, b]) => { if (!back.has(b)) back.set(b, []); back.get(b).push(a); });
    const ok = new Set(), stack = [];
    seen.forEach((s, k) => { if (isGoal(s)) { ok.add(k); stack.push(k); } });
    while (stack.length) (back.get(stack.pop()) || []).forEach((p) => { if (!ok.has(p)) { ok.add(p); stack.push(p); } });
    out.trapped = [];
    seen.forEach((s, k) => { if (!ok.has(k)) out.trapped.push(where(s)); });
    out.trapped = [...new Set(out.trapped)];
    out.noWrong = [...new Set(out.noWrong)];
    out.states = seen.size; out.edges = edges.length; out.goalReachable = ok.size > 0;
    return out;
  }

  // Real power meter: at every step of the correct path, click wrong 11 times, then finish the step.
  function ladder() {
    const res = { steps: 0, glow: 0, recharge: 0, recovered: 0, failed: [], review: null };
    MS.forEach((m, k) => {
      let st = jump(k, 0), guard = 0;
      while (st.scr === 'mission' && guard++ < 400) {
        if (st.tap.length === 0 && st.g === 0) {
          res.steps++;
          let t = st, sawGlow = false, sawRe = false;
          const bad = clk(t).find((x) => !expd(t).includes(x));
          if (bad) {
            for (let n = 0; n < 11; n++) {
              const b = clk(t).find((x) => !expd(t).includes(x));
              if (!b) break;
              t = act(t, b);
              if (hintLevel(t) === 2) sawGlow = true;
              if (t.last.recharge) sawRe = true;
            }
            if (sawGlow) res.glow++;
            if (sawRe) res.recharge++;
            const before = t.i; let g2 = 0;
            while (t.scr === 'mission' && t.i === before && g2++ < 20) {
              const e = expd(t)[0];
              if (!clk(t).includes(e)) break;
              t = act(t, e);
            }
            if (t.scr !== 'mission' || t.i !== before) res.recovered++;
            else res.failed.push(where(st));
          } else res.recovered++;
        }
        st = act(st, expd(st)[0]);
      }
    });
    // Review rule: three mistakes on a scan step bring it back once at the end.
    const k = MS.findIndex((m) => m.mechanic === 'scan');
    if (k >= 0) {
      let t = jump(k, 0);
      const base = stepsOf(t).length;
      for (let n = 0; n < 3; n++) t = act(t, clk(t).find((x) => !expd(t).includes(x)));
      t = act(t, expd(t)[0]);
      const grown = stepsOf(t).length;
      let g = 0;
      while (t.scr === 'mission' && g++ < 100) t = act(t, expd(t)[0]);
      res.review = { base, grown, finished: t.scr === 'complete' };
    }
    return res;
  }

  function positive() {
    let st = fresh(), n = 0;
    const trail = [];
    while (n < 2000) {
      const a = nextRight(st);
      if (a === null) return { ok: true, clicks: n, trail };
      if (!actions(st).includes(a)) return { ok: false, clicks: n, at: where(st), missing: a, trail };
      st = act(st, a); n++; trail.push(a);
    }
    return { ok: false, clicks: n, at: 'loop guard', trail };
  }

  // Checks on the data itself.
  function lint() {
    const ids = new Set(D.items.map((i) => i.id)), o = [];
    MS.forEach((m) => {
      const missing = [...new Set(prep(m).flatMap((s) => s.items))].filter((x) => !ids.has(x));
      if (missing.length) o.push({ lvl: 'warn', t: m.title + ': step words missing from the word list: ' + missing.join(', ') });
      if (!D.text['unlock_' + m.unlock]) o.push({ lvl: 'warn', t: m.title + ': no unlock sentence for "' + m.unlock + '"' });
      if (m.mechanic === 'repair') {
        const used = new Set(prep(m).flatMap((s) => s.groups.flat()));
        const never = Object.keys(m.names).filter((x) => !used.has(x));
        if (never.length) o.push({ lvl: 'info', t: m.title + ': clickable but never the right answer (distractors only): ' + never.map((x) => m.names[x]).join(', ') });
      }
      if (m.mechanic === 'fetch') {
        const used = new Set(prep(m).map((s) => s.groups[0][0]));
        const never = m.placement.filter((p) => !used.has(p.id)).map((p) => p.name);
        if (never.length) o.push({ lvl: 'info', t: m.title + ': objects never asked for: ' + never.join(', ') });
      }
      if (m.mechanic === 'scan') {
        ['doing', 'has'].forEach((f) => {
          const v = Object.values(m.creatures).map((c) => c[f]);
          if (new Set(v).size !== v.length) o.push({ lvl: 'warn', t: m.title + ': two animals share the same "' + f + '" clue' });
        });
        const asked = new Set(prep(m).filter((s) => s.clue === 'has').map((s) => s.groups[0][0]));
        const not = Object.keys(m.creatures).filter((c) => !asked.has(c)).map((c) => m.creatures[c].name);
        if (not.length) o.push({ lvl: 'info', t: m.title + ': never asked by body feature: ' + not.join(', ') });
      }
    });
    const shown = { robodog: 1, scanner: 1, mountains: 1 };
    MS.forEach((m) => { if (!shown[m.unlock]) o.push({ lvl: 'warn', t: 'Unlock "' + m.unlock + '" (' + m.title + ') has no status indicator on the map; robodog, scanner and ship\'s log do' }); });
    D.regions.forEach((r) => { if (!MS.some((m) => m.region === r.id)) o.push({ lvl: 'warn', t: 'Region "' + r.name + '" has no mission' }); });
    const tagged = D.items.filter((i) => i.band || i.cefr || i.level).length;
    o.push({ lvl: tagged ? 'info' : 'warn', t: D.items.length + ' words in the list; ' + tagged + ' carry a curriculum band or level tag' });
    return o;
  }

  // Words that appear for the first time at each step (the SDK shows a word card for these).
  function newWords() {
    const seen = new Set(), o = {};
    MS.forEach((m, k) => prep(m).forEach((s, i) => {
      o[k + ':' + i] = s.items.filter((x) => !seen.has(x));
      s.items.forEach((x) => seen.add(x));
    }));
    return o;
  }

  root.ENG = { D, MS, L, prep, stepsOf, fresh, expd, clk, actions, act, hintLevel, key, isGoal, nextRight, where, jump, explore, ladder, positive, lint, newWords, nm, bank, regionOpen, available, POWER };
})(typeof window !== 'undefined' ? window : globalThis);
