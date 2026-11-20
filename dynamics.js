/* Astronaut Fork v2 — 2.5D Dynamics Engine
 * Drives:
 *  1. Ambient HTML5 Canvas particles directly from upstream layout.ambient (stars, smoke, sparks, shimmer, dust)
 *  2. Living creature animations from layout.creatures (fly, peek, drink, breathe, run, swim)
 *  3. Character idle breathing + M2 Robodog fetch dash + M3 sci-fi laser scan beam + M1 spark bursts + wrong-click shake
 */
(function (root) {
  'use strict';

  let rafId = null;
  let particles = [];
  let activeCanvas = null;
  let activeLayout = null;

  function stopAmbient() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    particles = [];
    activeCanvas = null;
    activeLayout = null;
  }

  function initParticles(layout) {
    const list = [];
    const [lw, lh] = layout.size || [2340, 1080];
    const amb = layout.ambient || [];
    amb.forEach((zone) => {
      const [ax, ay, aw, ah] = zone.area || [0, 0, lw, lh];
      const count = Math.min(zone.count || 16, 48);
      for (let i = 0; i < count; i++) {
        const isSmoke = zone.type === 'smoke';
        list.push({
          type: zone.type,
          ax, ay, aw, ah,
          x: isSmoke ? (lw * (0.17 + Math.random() * 0.06)) : (ax + Math.random() * aw),
          y: isSmoke ? (lh * (0.18 + Math.random() * 0.20)) : (ay + Math.random() * ah),
          r: isSmoke ? (5 + Math.random() * 7) : (1.5 + Math.random() * 3),
          vx: zone.type === 'dust' ? (0.3 + Math.random() * 0.6) : (zone.type === 'sparks' ? (Math.random() - 0.5) * 3 : (Math.random() - 0.5) * 0.4),
          vy: zone.type === 'smoke' ? -(0.5 + Math.random() * 0.9) : (zone.type === 'sparks' ? -(1.2 + Math.random() * 2.2) : 0),
          phase: Math.random() * Math.PI * 2,
          speed: 0.02 + Math.random() * 0.04,
          life: Math.random(),
        });
      }
    });
    return list;
  }

  function startAmbient(stageEl, layout) {
    stopAmbient();
    if (!stageEl || !layout) return;
    if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'ambient-canvas';
    const [lw, lh] = layout.size || [2340, 1080];
    canvas.width = Math.round(lw / 2);
    canvas.height = Math.round(lh / 2);
    stageEl.append(canvas);

    activeCanvas = canvas;
    activeLayout = layout;
    particles = initParticles(layout);
    const ctx = canvas.getContext('2d');
    const sx = canvas.width / lw;
    const sy = canvas.height / lh;

    function tick() {
      if (!activeCanvas || !activeCanvas.isConnected) {
        stopAmbient();
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.phase += p.speed;

        if (p.type === 'stars') {
          const alpha = 0.25 + 0.65 * (0.5 + 0.5 * Math.sin(p.phase));
          ctx.fillStyle = `rgba(226, 240, 255, ${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(p.x * sx, p.y * sy, p.r * 0.7, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'smoke') {
          // Subtle rocket-exhaust wisps anchored to the left engine nozzle (no big white circles in sky)
          p.y += p.vy * 0.55;
          p.x += Math.sin(p.phase) * 0.35;
          p.life += 0.01;
          if (p.life >= 1 || p.y < lh * 0.08) {
            p.x = lw * (0.17 + Math.random() * 0.06);
            p.y = lh * (0.34 + Math.random() * 0.05);
            p.life = 0;
          }
          const alpha = Math.sin(p.life * Math.PI) * 0.09;
          ctx.fillStyle = `rgba(210, 218, 230, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(p.x * sx, p.y * sy, (5 + p.life * 8), 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'sparks') {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.06;
          p.life += 0.025;
          if (p.life >= 1) {
            p.x = p.ax + Math.random() * p.aw;
            p.y = p.ay + p.ah * 0.7;
            p.vx = (Math.random() - 0.5) * 3.5;
            p.vy = -(1.5 + Math.random() * 2.5);
            p.life = 0;
          }
          const alpha = (1 - p.life) * 0.9;
          ctx.fillStyle = `rgba(251, 191, 36, ${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(p.x * sx, p.y * sy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'shimmer') {
          const alpha = 0.15 + 0.45 * (0.5 + 0.5 * Math.sin(p.phase));
          ctx.fillStyle = `rgba(103, 232, 249, ${alpha.toFixed(2)})`;
          ctx.fillRect(p.x * sx, p.y * sy, 14 + Math.sin(p.phase) * 6, 2);
        } else if (p.type === 'dust') {
          p.x += p.vx;
          p.y += Math.sin(p.phase) * 0.35;
          if (p.x > p.ax + p.aw) p.x = p.ax;
          ctx.fillStyle = 'rgba(248, 226, 196, 0.25)';
          ctx.beginPath();
          ctx.arc(p.x * sx, p.y * sy, p.r * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
  }

  function triggerFx(stageEl, kind, targetEl) {
    if (!stageEl) return;
    if (kind === 'wrong') {
      stageEl.classList.remove('fx-shake');
      void stageEl.offsetWidth;
      stageEl.classList.add('fx-shake');
      setTimeout(() => stageEl.classList.remove('fx-shake'), 360);
    } else if (kind === 'spark' && targetEl) {
      const burst = document.createElement('div');
      burst.className = 'fx-burst';
      burst.style.left = targetEl.style.left;
      burst.style.top = targetEl.style.top;
      stageEl.append(burst);
      setTimeout(() => burst.remove(), 550);
    } else if (kind === 'scan' && targetEl) {
      const beam = document.createElement('div');
      beam.className = 'fx-scan-beam';
      beam.style.left = targetEl.style.left;
      beam.style.top = targetEl.style.top;
      stageEl.append(beam);
      setTimeout(() => beam.remove(), 650);
    } else if (kind === 'fetch' && targetEl) {
      const dog = stageEl.querySelector('[data-thing="character:robodog"]');
      if (dog) {
        const origLeft = dog.style.left;
        const origTop = dog.style.top;
        dog.style.transition = 'left 0.28s ease-out, top 0.28s ease-out';
        dog.style.left = targetEl.style.left;
        dog.style.top = targetEl.style.top;
        setTimeout(() => {
          dog.style.left = origLeft;
          dog.style.top = origTop;
        }, 260);
      }
      const pop = document.createElement('div');
      pop.className = 'fx-pop-badge';
      pop.textContent = '+1 Collected';
      pop.style.left = targetEl.style.left;
      pop.style.top = targetEl.style.top;
      stageEl.append(pop);
      setTimeout(() => pop.remove(), 750);
    }
  }

  root.FORK_DYNAMICS = {
    startAmbient,
    stopAmbient,
    triggerFx,
  };
})(window);
