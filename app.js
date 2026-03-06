const svg = document.getElementById('canvas');

const ui = {
  toolSelect: document.getElementById('tool-select'),
  toolWall: document.getElementById('tool-wall'),
  gridUnit: document.getElementById('grid-unit'),
  gridStep: document.getElementById('grid-step'),
  zoom: document.getElementById('zoom'),
  selectionTitle: document.getElementById('selection-title'),
  wallFields: document.getElementById('wall-fields'),
  nodeFields: document.getElementById('node-fields'),
  wallName: document.getElementById('wall-name'),
  wallLock: document.getElementById('wall-lock'),
  wallThickness: document.getElementById('wall-thickness'),
  wallColor: document.getElementById('wall-color'),
  deleteSelected: document.getElementById('delete-selected'),
  nodeWallList: document.getElementById('node-wall-list')
};

const state = {
  tool: 'select',
  walls: [],
  nodes: [],
  selected: null,
  drawing: null,
  drag: null,
  camera: { x: 0, y: 0, zoom: 1 },
  screen: { w: 1200, h: 700 },
  grid: { unit: 'cm', step: 10 },
  wallCounter: 0
};

const BASE_PX_PER_UNIT = 4;
const WORLD_SIZE = 5000;

function id(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function unitLabel() {
  return { cm: 'см', mm: 'мм', inch: 'дюймы', m: 'м' }[state.grid.unit] || state.grid.unit;
}

function updateUnitLabels() {
  document.querySelectorAll('.unit-label').forEach(el => { el.textContent = unitLabel(); });
}

function worldToScreen(w) {
  const s = BASE_PX_PER_UNIT * state.camera.zoom;
  return { x: (w.x - state.camera.x) * s, y: (w.y - state.camera.y) * s };
}

function screenToWorld(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  const s = BASE_PX_PER_UNIT * state.camera.zoom;
  return { x: sx / s + state.camera.x, y: sy / s + state.camera.y };
}

function snap(v) {
  const g = state.grid.step;
  return Math.round(v / g) * g;
}

function snapPoint(p) {
  return { x: snap(p.x), y: snap(p.y) };
}

function getNode(nodeId) { return state.nodes.find(n => n.id === nodeId); }
function getWall(wallId) { return state.walls.find(w => w.id === wallId); }

function wallsAtNode(nodeId) {
  return state.walls.filter(w => w.startNodeId === nodeId || w.endNodeId === nodeId);
}

function wallComponent(wallId) {
  const first = getWall(wallId);
  if (!first) return [];

  const wallQueue = [first.id];
  const seenWalls = new Set();
  const seenNodes = new Set();

  while (wallQueue.length) {
    const wid = wallQueue.pop();
    if (seenWalls.has(wid)) continue;
    seenWalls.add(wid);
    const w = getWall(wid);
    if (!w) continue;

    [w.startNodeId, w.endNodeId].forEach(nid => {
      if (seenNodes.has(nid)) return;
      seenNodes.add(nid);
      wallsAtNode(nid).forEach(nw => {
        if (!seenWalls.has(nw.id)) wallQueue.push(nw.id);
      });
    });
  }

  return state.walls.filter(w => seenWalls.has(w.id));
}

function componentColor(wallId) {
  const component = wallComponent(wallId);
  if (!component.length) return '#bfbfbf';
  return component[0].color || '#bfbfbf';
}

function createNode(p) {
  const node = { id: id('node'), x: p.x, y: p.y };
  state.nodes.push(node);
  return node;
}

function findOrCreateNode(p, threshold = state.grid.step * 0.35) {
  const existing = state.nodes.find(n => distance(n, p) <= threshold);
  return existing || createNode(p);
}

function applyWallLock(wall, movedNodeId) {
  if (!wall || wall.lock === 'none') return;
  const a = getNode(wall.startNodeId);
  const b = getNode(wall.endNodeId);
  if (!a || !b) return;
  if (wall.lock === 'horizontal') {
    if (movedNodeId === a.id) b.y = a.y; else a.y = b.y;
  }
  if (wall.lock === 'vertical') {
    if (movedNodeId === a.id) b.x = a.x; else a.x = b.x;
  }
}

function applyNodeConstraints(nodeId) {
  state.walls.forEach(w => {
    if (w.startNodeId === nodeId || w.endNodeId === nodeId) applyWallLock(w, nodeId);
  });
}

function moveNode(nodeId, p) {
  const node = getNode(nodeId);
  if (!node) return;
  node.x = p.x;
  node.y = p.y;
  applyNodeConstraints(nodeId);
}

function mergeNodes(sourceId, targetId) {
  if (sourceId === targetId) return;
  state.walls.forEach(w => {
    if (w.startNodeId === sourceId) w.startNodeId = targetId;
    if (w.endNodeId === sourceId) w.endNodeId = targetId;
  });
  state.nodes = state.nodes.filter(n => n.id !== sourceId);
  if (state.selected?.type === 'node' && state.selected.id === sourceId) {
    state.selected = { type: 'node', id: targetId };
  }
}

function tryMergeNode(nodeId) {
  const node = getNode(nodeId);
  if (!node) return;
  const hit = state.nodes.find(n => n.id !== nodeId && distance(n, node) <= state.grid.step * 0.35);
  if (hit) mergeNodes(nodeId, hit.id);
}

function wallDirection(wall) {
  const a = getNode(wall.startNodeId);
  const b = getNode(wall.endNodeId);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len };
}

function lineIntersection(p1, d1, p2, d2) {
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-9) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const t = (dx * d2.y - dy * d2.x) / cross;
  const u = (dx * d1.y - dy * d1.x) / cross;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t, t, u };
}

function endpointRay(endpoint) {
  const wall = getWall(endpoint.wallId);
  const a = getNode(wall.startNodeId);
  const b = getNode(wall.endNodeId);
  if (!a || !b) return null;

  const dir = wallDirection(wall);
  const right = { x: dir.dy, y: -dir.dx };
  const t = Math.max(0, Number(wall.thickness) || 0);

  const node = endpoint.at === 'start' ? a : b;
  const away = endpoint.at === 'start' ? { x: dir.dx, y: dir.dy } : { x: -dir.dx, y: -dir.dy };
  const base = { x: node.x + right.x * t, y: node.y + right.y * t };

  return { base, away, thickness: t };
}

function computeJoinRightPoints() {
  const joins = new Map();

  state.nodes.forEach(node => {
    const endpoints = [];
    state.walls.forEach(w => {
      if (w.startNodeId === node.id) endpoints.push({ wallId: w.id, at: 'start' });
      if (w.endNodeId === node.id) endpoints.push({ wallId: w.id, at: 'end' });
    });

    if (!endpoints.length) return;

    const rays = endpoints.map(ep => {
      const ray = endpointRay(ep);
      if (!ray) return null;
      return {
        ...ep,
        ...ray,
        angle: Math.atan2(ray.away.y, ray.away.x)
      };
    }).filter(Boolean);

    if (rays.length < 2) {
      rays.forEach(r => joins.set(`${r.wallId}:${r.at}`, r.base));
      return;
    }

    rays.sort((r1, r2) => r1.angle - r2.angle);

    // Compute intersections with both neighbors around the node.
    rays.forEach((ray, i) => {
      const prev = rays[(i - 1 + rays.length) % rays.length];
      const next = rays[(i + 1) % rays.length];
      const prevHit = lineIntersection(ray.base, ray.away, prev.base, prev.away);
      const nextHit = lineIntersection(ray.base, ray.away, next.base, next.away);

      const validPrev = prevHit && prevHit.t >= -1e-6 && prevHit.u >= -1e-6;
      const validNext = nextHit && nextHit.t >= -1e-6 && nextHit.u >= -1e-6;

      // For polygon a->b->bRight->aRight, end uses next side, start uses prev side.
      let pick = null;
      if (ray.at === 'start') pick = validPrev ? prevHit : (validNext ? nextHit : null);
      else pick = validNext ? nextHit : (validPrev ? prevHit : null);

      joins.set(`${ray.wallId}:${ray.at}`, pick ? { x: pick.x, y: pick.y } : ray.base);
    });
  });

  return joins;
}

function wallPolygonPoints(wall, joins) {
  const a = getNode(wall.startNodeId);
  const b = getNode(wall.endNodeId);
  if (!a || !b) return '';

  const t = Math.max(0, Number(wall.thickness) || 0);
  if (t === 0) return `${a.x},${a.y} ${b.x},${b.y}`;

  const dir = wallDirection(wall);
  const rx = dir.dy;
  const ry = -dir.dx;

  const aRight = joins.get(`${wall.id}:start`) || { x: a.x + rx * t, y: a.y + ry * t };
  const bRight = joins.get(`${wall.id}:end`) || { x: b.x + rx * t, y: b.y + ry * t };

  const p1 = { x: a.x, y: a.y };
  const p2 = { x: b.x, y: b.y };
  const p3 = { x: bRight.x, y: bRight.y };
  const p4 = { x: aRight.x, y: aRight.y };

  return `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`;
}

function clearSvg() {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function setViewBox() {
  const s = BASE_PX_PER_UNIT * state.camera.zoom;
  const wWorld = state.screen.w / s;
  const hWorld = state.screen.h / s;
  svg.setAttribute('viewBox', `${state.camera.x} ${state.camera.y} ${wWorld} ${hWorld}`);
}

function drawGrid() {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const step = state.grid.step;
  const majorEvery = 5;

  for (let x = 0; x <= WORLD_SIZE; x += step) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x); line.setAttribute('y1', 0);
    line.setAttribute('x2', x); line.setAttribute('y2', WORLD_SIZE);
    line.setAttribute('class', (x / step) % majorEvery === 0 ? 'grid-major' : 'grid-minor');
    g.appendChild(line);
  }

  for (let y = 0; y <= WORLD_SIZE; y += step) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', 0); line.setAttribute('y1', y);
    line.setAttribute('x2', WORLD_SIZE); line.setAttribute('y2', y);
    line.setAttribute('class', (y / step) % majorEvery === 0 ? 'grid-major' : 'grid-minor');
    g.appendChild(line);
  }

  svg.appendChild(g);
}

function selectEntity(entity) {
  state.selected = entity;
  refreshInspector();
  render();
}

function renderWalls() {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const joins = computeJoinRightPoints();

  state.walls.forEach(w => {
    const a = getNode(w.startNodeId);
    const b = getNode(w.endNodeId);
    if (!a || !b) return;

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('class', 'wall-shape');
    poly.setAttribute('points', wallPolygonPoints(w, joins));
    poly.setAttribute('fill', componentColor(w.id));
    group.appendChild(poly);

    const center = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    center.setAttribute('x1', a.x); center.setAttribute('y1', a.y);
    center.setAttribute('x2', b.x); center.setAttribute('y2', b.y);
    center.setAttribute('class', `wall-center ${state.selected?.type === 'wall' && state.selected.id === w.id ? 'selected' : ''}`);
    group.appendChild(center);

    const len = distance(a, b);
    const tx = (a.x + b.x) / 2;
    const ty = (a.y + b.y) / 2;
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', tx);
    label.setAttribute('y', ty - state.grid.step * 0.2);
    label.setAttribute('class', 'wall-length');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = `${len.toFixed(1)} ${unitLabel()}`;
    group.appendChild(label);

    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hit.setAttribute('x1', a.x); hit.setAttribute('y1', a.y);
    hit.setAttribute('x2', b.x); hit.setAttribute('y2', b.y);
    hit.setAttribute('class', 'wall-hit');
    hit.addEventListener('pointerdown', evt => {
      evt.stopPropagation();
      selectEntity({ type: 'wall', id: w.id });
      if (state.tool !== 'select') return;
      const p = snapPoint(screenToWorld(evt.clientX, evt.clientY));
      state.drag = {
        type: 'wall', wallId: w.id, start: p,
        a0: { ...getNode(w.startNodeId) },
        b0: { ...getNode(w.endNodeId) }
      };
      svg.setPointerCapture(evt.pointerId);
    });
    group.appendChild(hit);
  });

  svg.appendChild(group);
}

function renderEndpoints() {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  state.nodes.forEach(node => {
    const used = state.walls.some(w => w.startNodeId === node.id || w.endNodeId === node.id);
    if (!used) return;

    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', node.x);
    c.setAttribute('cy', node.y);
    c.setAttribute('r', state.grid.step * 0.12);
    c.setAttribute('class', `endpoint ${state.selected?.type === 'node' && state.selected.id === node.id ? 'selected' : ''}`);
    c.addEventListener('pointerdown', evt => {
      evt.stopPropagation();
      selectEntity({ type: 'node', id: node.id });
      if (state.tool !== 'select') return;
      state.drag = { type: 'node', nodeId: node.id };
      svg.setPointerCapture(evt.pointerId);
    });
    g.appendChild(c);
  });
  svg.appendChild(g);
}

function renderDrawingPreview() {
  if (!state.drawing) return;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', state.drawing.start.x);
  line.setAttribute('y1', state.drawing.start.y);
  line.setAttribute('x2', state.drawing.current.x);
  line.setAttribute('y2', state.drawing.current.y);
  line.setAttribute('stroke', '#2d6cdf');
  line.setAttribute('stroke-width', '0.2');
  line.setAttribute('stroke-dasharray', '1 1');
  g.appendChild(line);
  svg.appendChild(g);
}

function render() {
  clearSvg();
  setViewBox();
  drawGrid();
  renderWalls();
  renderEndpoints();
  renderDrawingPreview();
}

function purgeUnusedNodes() {
  state.nodes = state.nodes.filter(n => state.walls.some(w => w.startNodeId === n.id || w.endNodeId === n.id));
}

function refreshInspector() {
  ui.wallFields.classList.add('hidden');
  ui.nodeFields.classList.add('hidden');

  if (!state.selected) {
    ui.selectionTitle.textContent = 'Ничего не выбрано';
    return;
  }

  if (state.selected.type === 'wall') {
    const wall = getWall(state.selected.id);
    if (!wall) return;
    ui.selectionTitle.textContent = 'Свойства стены';
    ui.wallFields.classList.remove('hidden');
    ui.wallName.value = wall.name;
    ui.wallLock.value = wall.lock;
    ui.wallThickness.value = wall.thickness;
    ui.wallColor.value = componentColor(wall.id);
    return;
  }

  if (state.selected.type === 'node') {
    const node = getNode(state.selected.id);
    if (!node) return;
    ui.selectionTitle.textContent = 'Свойства точки';
    ui.nodeFields.classList.remove('hidden');
    const walls = state.walls.filter(w => w.startNodeId === node.id || w.endNodeId === node.id);
    ui.nodeWallList.innerHTML = walls.map(w => {
      const a = getNode(w.startNodeId);
      const b = getNode(w.endNodeId);
      const len = a && b ? distance(a, b).toFixed(1) : '-';
      return `<li>${w.name} — длина ${len} ${unitLabel()}, толщина ${w.thickness} ${unitLabel()}, ограничение: ${w.lock}</li>`;
    }).join('');
  }
}

function finalizeWall(startPoint, endPoint) {
  if (distance(startPoint, endPoint) < state.grid.step * 0.3) return;
  state.wallCounter += 1;
  const wall = {
    id: id('wall'),
    name: `Стена ${state.wallCounter}`,
    startNodeId: findOrCreateNode(startPoint).id,
    endNodeId: findOrCreateNode(endPoint).id,
    lock: 'none',
    thickness: 20,
    color: '#bfbfbf'
  };
  state.walls.push(wall);
  selectEntity({ type: 'wall', id: wall.id });
}

function setTool(tool) {
  state.tool = tool;
  ui.toolSelect.classList.toggle('active', tool === 'select');
  ui.toolWall.classList.toggle('active', tool === 'wall');
  svg.style.cursor = tool === 'wall' ? 'crosshair' : 'default';
  state.drawing = null;
  state.drag = null;
  render();
}

function resize() {
  const rect = svg.getBoundingClientRect();
  state.screen.w = rect.width;
  state.screen.h = rect.height;
  render();
}

svg.addEventListener('pointerdown', evt => {
  const p = snapPoint(screenToWorld(evt.clientX, evt.clientY));

  if (state.tool === 'wall') {
    if (!state.drawing) state.drawing = { start: p, current: p };
    else { finalizeWall(state.drawing.start, p); state.drawing = null; }
    render();
    return;
  }

  if (evt.button === 1 || evt.button === 2) {
    const origin = screenToWorld(evt.clientX, evt.clientY);
    state.drag = { type: 'pan', origin, cam0: { ...state.camera } };
    svg.setPointerCapture(evt.pointerId);
    return;
  }

  selectEntity(null);
});

svg.addEventListener('pointermove', evt => {
  const p = snapPoint(screenToWorld(evt.clientX, evt.clientY));

  if (state.drawing) {
    state.drawing.current = p;
    render();
    return;
  }

  if (!state.drag) return;

  if (state.drag.type === 'node') {
    moveNode(state.drag.nodeId, p);
    render();
    return;
  }

  if (state.drag.type === 'wall') {
    const dx = p.x - state.drag.start.x;
    const dy = p.y - state.drag.start.y;
    const wall = getWall(state.drag.wallId);
    if (!wall) return;
    const a = getNode(wall.startNodeId);
    const b = getNode(wall.endNodeId);
    a.x = state.drag.a0.x + dx; a.y = state.drag.a0.y + dy;
    b.x = state.drag.b0.x + dx; b.y = state.drag.b0.y + dy;
    applyNodeConstraints(a.id);
    applyNodeConstraints(b.id);
    render();
    return;
  }

  if (state.drag.type === 'pan') {
    const cur = screenToWorld(evt.clientX, evt.clientY);
    state.camera.x = state.drag.cam0.x + (state.drag.origin.x - cur.x);
    state.camera.y = state.drag.cam0.y + (state.drag.origin.y - cur.y);
    render();
  }
});

svg.addEventListener('pointerup', evt => {
  if (state.drag?.type === 'node') tryMergeNode(state.drag.nodeId);
  if (svg.hasPointerCapture(evt.pointerId)) svg.releasePointerCapture(evt.pointerId);
  state.drag = null;
  refreshInspector();
  render();
});

svg.addEventListener('dblclick', () => { state.drawing = null; render(); });
svg.addEventListener('contextmenu', evt => evt.preventDefault());

svg.addEventListener('wheel', evt => {
  evt.preventDefault();
  const before = screenToWorld(evt.clientX, evt.clientY);
  const k = evt.deltaY > 0 ? 0.9 : 1.1;
  const nextZoom = clamp(state.camera.zoom * k, 0.2, 6);
  state.camera.zoom = nextZoom;
  ui.zoom.value = String(nextZoom);
  const after = screenToWorld(evt.clientX, evt.clientY);
  state.camera.x += before.x - after.x;
  state.camera.y += before.y - after.y;
  render();
}, { passive: false });

ui.toolSelect.addEventListener('click', () => setTool('select'));
ui.toolWall.addEventListener('click', () => setTool('wall'));

ui.gridUnit.addEventListener('change', () => {
  state.grid.unit = ui.gridUnit.value;
  updateUnitLabels();
  refreshInspector();
});

ui.gridStep.addEventListener('change', () => {
  state.grid.step = Math.max(0.1, Number(ui.gridStep.value) || 10);
  render();
});

ui.zoom.addEventListener('input', () => {
  state.camera.zoom = clamp(Number(ui.zoom.value) || 1, 0.2, 6);
  render();
});

ui.wallName.addEventListener('input', () => {
  if (state.selected?.type !== 'wall') return;
  const wall = getWall(state.selected.id);
  if (!wall) return;
  wall.name = ui.wallName.value || wall.name;
  refreshInspector();
});

ui.wallLock.addEventListener('change', () => {
  if (state.selected?.type !== 'wall') return;
  const wall = getWall(state.selected.id);
  if (!wall) return;
  wall.lock = ui.wallLock.value;
  applyWallLock(wall, wall.startNodeId);
  refreshInspector();
  render();
});

ui.wallThickness.addEventListener('change', () => {
  if (state.selected?.type !== 'wall') return;
  const wall = getWall(state.selected.id);
  if (!wall) return;
  wall.thickness = Math.max(0, Number(ui.wallThickness.value) || 0);
  refreshInspector();
  render();
});

ui.wallColor.addEventListener('input', () => {
  if (state.selected?.type !== 'wall') return;
  const wall = getWall(state.selected.id);
  if (!wall) return;
  const color = ui.wallColor.value || '#bfbfbf';
  wallComponent(wall.id).forEach(w => { w.color = color; });
  render();
});

ui.deleteSelected.addEventListener('click', () => {
  if (state.selected?.type !== 'wall') return;
  state.walls = state.walls.filter(w => w.id !== state.selected.id);
  state.selected = null;
  purgeUnusedNodes();
  refreshInspector();
  render();
});

window.addEventListener('resize', resize);

updateUnitLabels();
resize();
setTool('select');
