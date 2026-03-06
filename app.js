const svg = document.getElementById('canvas');

const ui = {
  gridUnit: document.getElementById('grid-unit'),
  gridStep: document.getElementById('grid-step'),
  gridPx: document.getElementById('grid-px'),
  wallLock: document.getElementById('wall-lock'),
  wallThickness: document.getElementById('wall-thickness'),
  wallSide: document.getElementById('wall-side'),
  deleteSelected: document.getElementById('delete-selected')
};

const state = {
  tool: 'wall',
  walls: [],
  nodes: [],
  selectedWallId: null,
  drawing: null,
  drag: null,
  grid: {
    unit: 'cm',
    step: 10,
    px: 40
  }
};

function id(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function svgPoint(evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const transformed = pt.matrixTransform(svg.getScreenCTM().inverse());
  return transformed;
}

function snap(v) {
  const g = state.grid.px;
  return Math.round(v / g) * g;
}

function snapPoint(p) {
  return { x: snap(p.x), y: snap(p.y) };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getNode(nodeId) {
  return state.nodes.find(n => n.id === nodeId);
}

function getWall(wallId) {
  return state.walls.find(w => w.id === wallId);
}

function createNode(p) {
  const node = { id: id('node'), x: p.x, y: p.y };
  state.nodes.push(node);
  return node;
}

function findOrCreateNode(p, threshold = 12) {
  const existing = state.nodes.find(n => distance(n, p) <= threshold);
  if (existing) return existing;
  return createNode(p);
}

function applyWallLock(wall, movedNodeId) {
  if (!wall || wall.lock === 'none') return;
  const a = getNode(wall.startNodeId);
  const b = getNode(wall.endNodeId);
  if (!a || !b) return;

  if (wall.lock === 'horizontal') {
    if (movedNodeId === a.id) b.y = a.y;
    else a.y = b.y;
  }
  if (wall.lock === 'vertical') {
    if (movedNodeId === a.id) b.x = a.x;
    else a.x = b.x;
  }
}

function applyNodeConstraints(nodeId) {
  state.walls.forEach(wall => {
    if (wall.startNodeId === nodeId || wall.endNodeId === nodeId) {
      applyWallLock(wall, nodeId);
    }
  });
}

function moveNode(nodeId, p) {
  const node = getNode(nodeId);
  if (!node) return;
  node.x = p.x;
  node.y = p.y;
  applyNodeConstraints(nodeId);
}

function wallDirection(wall) {
  const a = getNode(wall.startNodeId);
  const b = getNode(wall.endNodeId);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len, len };
}

function wallPolygonPoints(wall) {
  const a = getNode(wall.startNodeId);
  const b = getNode(wall.endNodeId);
  if (!a || !b) return '';

  const t = Math.max(0, Number(wall.thickness) || 0);
  if (t === 0) return `${a.x},${a.y} ${b.x},${b.y}`;

  const dir = wallDirection(wall);
  const nx = -dir.dy;
  const ny = dir.dx;

  let left = t / 2;
  let right = t / 2;
  if (wall.side === 'left') {
    left = t;
    right = 0;
  }
  if (wall.side === 'right') {
    left = 0;
    right = t;
  }

  // small extension at ends to make joins look like a single convex area instead of point-touch rectangles
  const cap = t / 2;
  const ax = a.x - dir.dx * cap;
  const ay = a.y - dir.dy * cap;
  const bx = b.x + dir.dx * cap;
  const by = b.y + dir.dy * cap;

  const p1 = { x: ax + nx * left, y: ay + ny * left };
  const p2 = { x: bx + nx * left, y: by + ny * left };
  const p3 = { x: bx - nx * right, y: by - ny * right };
  const p4 = { x: ax - nx * right, y: ay - ny * right };

  return `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`;
}

function wallCenterLine(wall) {
  const a = getNode(wall.startNodeId);
  const b = getNode(wall.endNodeId);
  return { a, b };
}

function clearSvg() {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function drawGrid() {
  const width = 2000;
  const height = 1200;
  const step = state.grid.px;
  const majorEvery = 5;

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  for (let x = 0; x <= width; x += step) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', 0);
    line.setAttribute('x2', x);
    line.setAttribute('y2', height);
    line.setAttribute('class', (x / step) % majorEvery === 0 ? 'grid-major' : 'grid-minor');
    g.appendChild(line);
  }

  for (let y = 0; y <= height; y += step) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', 0);
    line.setAttribute('y1', y);
    line.setAttribute('x2', width);
    line.setAttribute('y2', y);
    line.setAttribute('class', (y / step) % majorEvery === 0 ? 'grid-major' : 'grid-minor');
    g.appendChild(line);
  }

  svg.appendChild(g);
}

function renderWalls() {
  const wallsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  state.walls.forEach(wall => {
    const { a, b } = wallCenterLine(wall);

    const shape = document.createElementNS('http://www.w3.org/2000/svg', wall.thickness > 0 ? 'polygon' : 'line');
    shape.setAttribute('class', 'wall-shape');

    if (wall.thickness > 0) {
      shape.setAttribute('points', wallPolygonPoints(wall));
      shape.setAttribute('fill', 'rgba(70,70,70,0.35)');
      shape.setAttribute('stroke', 'rgba(50,50,50,0.7)');
      shape.setAttribute('stroke-width', '1');
    } else {
      shape.setAttribute('x1', a.x);
      shape.setAttribute('y1', a.y);
      shape.setAttribute('x2', b.x);
      shape.setAttribute('y2', b.y);
      shape.setAttribute('stroke', '#555');
      shape.setAttribute('stroke-width', '2');
    }

    wallsGroup.appendChild(shape);

    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    outline.setAttribute('x1', a.x);
    outline.setAttribute('y1', a.y);
    outline.setAttribute('x2', b.x);
    outline.setAttribute('y2', b.y);
    outline.setAttribute('stroke', '#333');
    outline.setAttribute('stroke-dasharray', '4 4');
    outline.setAttribute('opacity', '0.35');
    wallsGroup.appendChild(outline);

    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hit.setAttribute('x1', a.x);
    hit.setAttribute('y1', a.y);
    hit.setAttribute('x2', b.x);
    hit.setAttribute('y2', b.y);
    hit.setAttribute('class', 'wall-hit');
    hit.addEventListener('pointerdown', evt => {
      evt.stopPropagation();
      selectWall(wall.id);
      const p = snapPoint(svgPoint(evt));
      state.drag = {
        type: 'wall',
        wallId: wall.id,
        start: p,
        a0: { ...getNode(wall.startNodeId) },
        b0: { ...getNode(wall.endNodeId) }
      };
      svg.setPointerCapture(evt.pointerId);
    });
    wallsGroup.appendChild(hit);

    if (state.selectedWallId === wall.id) {
      const sel = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      sel.setAttribute('x1', a.x);
      sel.setAttribute('y1', a.y);
      sel.setAttribute('x2', b.x);
      sel.setAttribute('y2', b.y);
      sel.setAttribute('class', 'wall-outline selected');
      wallsGroup.appendChild(sel);
    }
  });

  svg.appendChild(wallsGroup);
}

function renderEndpoints() {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  state.nodes.forEach(node => {
    const used = state.walls.some(w => w.startNodeId === node.id || w.endNodeId === node.id);
    if (!used) return;

    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', node.x);
    c.setAttribute('cy', node.y);
    c.setAttribute('r', '5');
    c.setAttribute('class', 'endpoint');
    c.addEventListener('pointerdown', evt => {
      evt.stopPropagation();
      state.drag = {
        type: 'node',
        nodeId: node.id
      };
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
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-dasharray', '6 4');
  g.appendChild(line);

  svg.appendChild(g);
}

function render() {
  clearSvg();
  drawGrid();
  renderWalls();
  renderEndpoints();
  renderDrawingPreview();
}

function selectWall(wallId) {
  state.selectedWallId = wallId;
  const wall = getWall(wallId);
  if (wall) {
    ui.wallLock.value = wall.lock;
    ui.wallThickness.value = wall.thickness;
    ui.wallSide.value = wall.side;
  }
  render();
}

function purgeUnusedNodes() {
  state.nodes = state.nodes.filter(node => state.walls.some(w => w.startNodeId === node.id || w.endNodeId === node.id));
}

function finalizeWall(startPoint, endPoint) {
  if (distance(startPoint, endPoint) < 4) return;

  const wall = {
    id: id('wall'),
    startNodeId: findOrCreateNode(startPoint).id,
    endNodeId: findOrCreateNode(endPoint).id,
    lock: 'none',
    thickness: 20,
    side: 'center'
  };
  state.walls.push(wall);
  selectWall(wall.id);
}

svg.addEventListener('pointerdown', evt => {
  const p = snapPoint(svgPoint(evt));
  if (state.tool !== 'wall') return;

  if (!state.drawing) {
    state.drawing = { start: p, current: p };
  } else {
    finalizeWall(state.drawing.start, p);
    state.drawing = null;
  }
  render();
});

svg.addEventListener('pointermove', evt => {
  const p = snapPoint(svgPoint(evt));

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
    a.x = state.drag.a0.x + dx;
    a.y = state.drag.a0.y + dy;
    b.x = state.drag.b0.x + dx;
    b.y = state.drag.b0.y + dy;

    applyNodeConstraints(a.id);
    applyNodeConstraints(b.id);
    render();
  }
});

svg.addEventListener('pointerup', evt => {
  if (state.drag) {
    state.drag = null;
    render();
  }
  if (svg.hasPointerCapture(evt.pointerId)) {
    svg.releasePointerCapture(evt.pointerId);
  }
});

svg.addEventListener('dblclick', () => {
  state.drawing = null;
  render();
});

ui.gridUnit.addEventListener('change', () => {
  state.grid.unit = ui.gridUnit.value;
});

ui.gridStep.addEventListener('change', () => {
  state.grid.step = Math.max(1, Number(ui.gridStep.value) || 10);
});

ui.gridPx.addEventListener('change', () => {
  state.grid.px = Math.max(5, Number(ui.gridPx.value) || 40);
  render();
});

ui.wallLock.addEventListener('change', () => {
  const wall = getWall(state.selectedWallId);
  if (!wall) return;
  wall.lock = ui.wallLock.value;
  applyWallLock(wall, wall.startNodeId);
  render();
});

ui.wallThickness.addEventListener('change', () => {
  const wall = getWall(state.selectedWallId);
  if (!wall) return;
  wall.thickness = Math.max(0, Number(ui.wallThickness.value) || 0);
  render();
});

ui.wallSide.addEventListener('change', () => {
  const wall = getWall(state.selectedWallId);
  if (!wall) return;
  wall.side = ui.wallSide.value;
  render();
});

ui.deleteSelected.addEventListener('click', () => {
  if (!state.selectedWallId) return;
  state.walls = state.walls.filter(w => w.id !== state.selectedWallId);
  state.selectedWallId = null;
  purgeUnusedNodes();
  render();
});

render();
