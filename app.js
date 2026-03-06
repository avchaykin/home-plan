const svg = document.getElementById('canvas');
const ui = {
  toolSelect: document.getElementById('tool-select'),
  toolWall: document.getElementById('tool-wall'),
  gridStep: document.getElementById('grid-step'),
  wallThickness: document.getElementById('wall-thickness')
};

const state = {
  tool: 'select',
  gridStep: 10,
  snapStep: 1,
  defaultThickness: 20,
  camera: { x: -100, y: -100, zoom: 1 },
  screen: { w: 1200, h: 800 },
  walls: [],
  joints: [],
  drawing: null,
  drag: null,
  selectedWallId: null
};

const PX_PER_CM = 4;

const id = p => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function worldFromClient(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  const s = PX_PER_CM * state.camera.zoom;
  return { x: sx / s + state.camera.x, y: sy / s + state.camera.y };
}

function snap(v, step = state.snapStep) { return Math.round(v / step) * step; }
function snapPoint(p, step = state.snapStep) { return { x: snap(p.x, step), y: snap(p.y, step) }; }

function wallDirection(wall) {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len, len };
}

function wallCorners(wall) {
  const d = wallDirection(wall);
  const rx = d.y;
  const ry = -d.x;
  const t = wall.thickness;
  return [
    { x: wall.a.x, y: wall.a.y },
    { x: wall.b.x, y: wall.b.y },
    { x: wall.b.x + rx * t, y: wall.b.y + ry * t },
    { x: wall.a.x + rx * t, y: wall.a.y + ry * t }
  ];
}

function cornerPos(wallId, cornerIndex) {
  const wall = state.walls.find(w => w.id === wallId);
  if (!wall) return null;
  return wallCorners(wall)[cornerIndex];
}

function setViewBox() {
  const s = PX_PER_CM * state.camera.zoom;
  const w = state.screen.w / s;
  const h = state.screen.h / s;
  svg.setAttribute('viewBox', `${state.camera.x} ${state.camera.y} ${w} ${h}`);
}

function drawGrid() {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const step = state.gridStep;
  const majorEach = 10; // каждые 10*step

  const left = state.camera.x;
  const top = state.camera.y;
  const s = PX_PER_CM * state.camera.zoom;
  const width = state.screen.w / s;
  const height = state.screen.h / s;
  const right = left + width;
  const bottom = top + height;

  const x0 = Math.floor(left / step) * step;
  const y0 = Math.floor(top / step) * step;

  for (let x = x0; x <= right + step; x += step) {
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', x); ln.setAttribute('y1', top - step);
    ln.setAttribute('x2', x); ln.setAttribute('y2', bottom + step);
    ln.setAttribute('class', Math.round(x / step) % majorEach === 0 ? 'grid-major' : 'grid-minor');
    g.appendChild(ln);
  }
  for (let y = y0; y <= bottom + step; y += step) {
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', left - step); ln.setAttribute('y1', y);
    ln.setAttribute('x2', right + step); ln.setAttribute('y2', y);
    ln.setAttribute('class', Math.round(y / step) % majorEach === 0 ? 'grid-major' : 'grid-minor');
    g.appendChild(ln);
  }
  svg.appendChild(g);
}

function clear() { while (svg.firstChild) svg.removeChild(svg.firstChild); }

function moveWallByCornerTo(wallId, cornerIndex, target) {
  const wall = state.walls.find(w => w.id === wallId);
  if (!wall) return;
  const c = wallCorners(wall)[cornerIndex];
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  wall.a.x += dx; wall.a.y += dy;
  wall.b.x += dx; wall.b.y += dy;
}

function applyJointConstraints() {
  // simple relaxation: attached corners should coincide with joint point
  for (let iter = 0; iter < 3; iter += 1) {
    state.joints.forEach(j => {
      j.attachments.forEach(att => moveWallByCornerTo(att.wallId, att.cornerIndex, { x: j.x, y: j.y }));
      // keep joint where first attachment ended (stable drag feel)
      const first = j.attachments[0];
      const p = first ? cornerPos(first.wallId, first.cornerIndex) : null;
      if (p) { j.x = p.x; j.y = p.y; }
    });
  }
}

function jointForAttachment(wallId, cornerIndex) {
  return state.joints.find(j => j.attachments.some(a => a.wallId === wallId && a.cornerIndex === cornerIndex));
}

function connectCorners(a, b) {
  if (a.wallId === b.wallId && a.cornerIndex === b.cornerIndex) return;
  const ja = jointForAttachment(a.wallId, a.cornerIndex);
  const jb = jointForAttachment(b.wallId, b.cornerIndex);

  if (ja && jb && ja.id !== jb.id) {
    // merge joints
    ja.attachments = [...ja.attachments, ...jb.attachments.filter(x => !ja.attachments.some(y => y.wallId === x.wallId && y.cornerIndex === x.cornerIndex))];
    state.joints = state.joints.filter(x => x.id !== jb.id);
    return;
  }

  if (ja) {
    if (!ja.attachments.some(x => x.wallId === b.wallId && x.cornerIndex === b.cornerIndex)) ja.attachments.push(b);
    return;
  }
  if (jb) {
    if (!jb.attachments.some(x => x.wallId === a.wallId && x.cornerIndex === a.cornerIndex)) jb.attachments.push(a);
    return;
  }

  const pa = cornerPos(a.wallId, a.cornerIndex);
  const pb = cornerPos(b.wallId, b.cornerIndex);
  const j = { id: id('joint'), x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, attachments: [a, b] };
  state.joints.push(j);
}

function closestOtherCorner(wallId, cornerIndex, p, r = 1.5) {
  let best = null;
  state.walls.forEach(w => {
    wallCorners(w).forEach((c, idx) => {
      if (w.id === wallId && idx === cornerIndex) return;
      const d = dist(c, p);
      if (d <= r && (!best || d < best.d)) best = { wallId: w.id, cornerIndex: idx, d };
    });
  });
  return best;
}

function renderWalls() {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  state.walls.forEach(w => {
    const pts = wallCorners(w);
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('class', 'wall');
    poly.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('fill', w.color);
    g.appendChild(poly);

    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hit.setAttribute('x1', w.a.x); hit.setAttribute('y1', w.a.y);
    hit.setAttribute('x2', w.b.x); hit.setAttribute('y2', w.b.y);
    hit.setAttribute('class', 'wall-hit');
    hit.addEventListener('pointerdown', e => {
      e.stopPropagation();
      state.selectedWallId = w.id;
      if (state.tool !== 'select') return;
      const p = snapPoint(worldFromClient(e.clientX, e.clientY));
      state.drag = { type: 'wall', wallId: w.id, start: p, a0: { ...w.a }, b0: { ...w.b } };
      svg.setPointerCapture(e.pointerId);
      render();
    });
    g.appendChild(hit);

    if (state.selectedWallId === w.id && state.tool === 'select') {
      pts.forEach((p, idx) => {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', p.x); c.setAttribute('cy', p.y);
        c.setAttribute('r', 0.8);
        c.setAttribute('class', 'corner selected');
        c.addEventListener('pointerdown', e => {
          e.stopPropagation();
          state.drag = { type: 'corner', wallId: w.id, cornerIndex: idx };
          svg.setPointerCapture(e.pointerId);
        });
        g.appendChild(c);
      });
    }
  });

  svg.appendChild(g);
}

function renderPreview() {
  if (!state.drawing) return;
  const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  l.setAttribute('x1', state.drawing.start.x);
  l.setAttribute('y1', state.drawing.start.y);
  l.setAttribute('x2', state.drawing.current.x);
  l.setAttribute('y2', state.drawing.current.y);
  l.setAttribute('class', 'preview');
  svg.appendChild(l);
}

function render() {
  applyJointConstraints();
  clear();
  setViewBox();
  drawGrid();
  renderWalls();
  renderPreview();
}

function addWall(a, b) {
  if (dist(a, b) < 1) return;
  state.walls.push({
    id: id('wall'),
    a: { ...a },
    b: { ...b },
    thickness: state.defaultThickness,
    color: '#bfbfbf'
  });
}

function resize() {
  const rect = svg.getBoundingClientRect();
  state.screen.w = rect.width;
  state.screen.h = rect.height;
  render();
}

function setTool(tool) {
  state.tool = tool;
  ui.toolSelect.classList.toggle('active', tool === 'select');
  ui.toolWall.classList.toggle('active', tool === 'wall');
  state.drawing = null;
  state.drag = null;
  render();
}

svg.addEventListener('pointerdown', e => {
  const p = snapPoint(worldFromClient(e.clientX, e.clientY));

  if (state.tool === 'wall') {
    if (!state.drawing) state.drawing = { start: p, current: p };
    else { addWall(state.drawing.start, p); state.drawing = null; }
    render();
    return;
  }

  if (e.button === 1 || e.button === 2) {
    const origin = worldFromClient(e.clientX, e.clientY);
    state.drag = { type: 'pan', origin, cam0: { ...state.camera } };
    svg.setPointerCapture(e.pointerId);
    return;
  }

  state.selectedWallId = null;
  render();
});

svg.addEventListener('pointermove', e => {
  const p = snapPoint(worldFromClient(e.clientX, e.clientY));

  if (state.drawing) {
    state.drawing.current = p;
    render();
    return;
  }

  if (!state.drag) return;

  if (state.drag.type === 'wall') {
    const w = state.walls.find(x => x.id === state.drag.wallId);
    if (!w) return;
    const dx = p.x - state.drag.start.x;
    const dy = p.y - state.drag.start.y;
    w.a.x = state.drag.a0.x + dx; w.a.y = state.drag.a0.y + dy;
    w.b.x = state.drag.b0.x + dx; w.b.y = state.drag.b0.y + dy;
    render();
    return;
  }

  if (state.drag.type === 'corner') {
    const j = jointForAttachment(state.drag.wallId, state.drag.cornerIndex);
    if (j) {
      j.x = p.x; j.y = p.y;
    } else {
      moveWallByCornerTo(state.drag.wallId, state.drag.cornerIndex, p);
    }
    render();
    return;
  }

  if (state.drag.type === 'pan') {
    const cur = worldFromClient(e.clientX, e.clientY);
    state.camera.x = state.drag.cam0.x + (state.drag.origin.x - cur.x);
    state.camera.y = state.drag.cam0.y + (state.drag.origin.y - cur.y);
    render();
  }
});

svg.addEventListener('pointerup', e => {
  if (state.drag?.type === 'corner') {
    const p = cornerPos(state.drag.wallId, state.drag.cornerIndex);
    const target = closestOtherCorner(state.drag.wallId, state.drag.cornerIndex, p);
    if (target) {
      connectCorners({ wallId: state.drag.wallId, cornerIndex: state.drag.cornerIndex }, target);
    }
  }
  if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  state.drag = null;
  render();
});

svg.addEventListener('wheel', e => {
  e.preventDefault();
  const before = worldFromClient(e.clientX, e.clientY);
  state.camera.zoom = clamp(state.camera.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.2, 8);
  const after = worldFromClient(e.clientX, e.clientY);
  state.camera.x += before.x - after.x;
  state.camera.y += before.y - after.y;
  render();
}, { passive: false });
svg.addEventListener('contextmenu', e => e.preventDefault());

ui.toolSelect.addEventListener('click', () => setTool('select'));
ui.toolWall.addEventListener('click', () => setTool('wall'));
ui.gridStep.addEventListener('change', () => { state.gridStep = Math.max(1, Number(ui.gridStep.value) || 10); render(); });
ui.wallThickness.addEventListener('change', () => { state.defaultThickness = Math.max(1, Number(ui.wallThickness.value) || 20); });

window.addEventListener('resize', resize);
resize();
setTool('select');
