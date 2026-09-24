(function () {
"use strict";

const layer = document.querySelector("#navigationPowerLayer");
if (!layer || !window.TickTockTomePowerGeometry || !window.TickTockTomeScreenBeans) return;

layer.innerHTML = "";
const bean = window.TickTockTomeScreenBeans.create(layer);
const geometry = window.TickTockTomePowerGeometry;
let position = null;
let connectedView = null;
let requestedView = null;
let motionToken = 0;
let childPosition = null;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function setPosition(next) {
  position = { x: next.x, y: next.y };
  bean.place(position);
}

function setChildPosition(next) {
  childPosition = { x: next.x, y: next.y };
  bean.placeChild(childPosition);
}

function restChild() {
  if (!position) return;
  bean.setChildChasing(false);
  setChildPosition({ x: position.x + 10, y: position.y - 25 });
}

async function moveTo(target, token) {
  const start = { ...position };
  const finish = { x: target.x, y: target.y };
  const distance = Math.hypot(finish.x - start.x, finish.y - start.y);
  const duration = distance / 0.15;
  if (!duration) { setPosition(finish); return token === motionToken; }
  bean.setRunning(true);
  bean.setChildChasing(true);
  const direction = Math.sign(finish.y - start.y) || 1;
  const childStart = childPosition || { x: start.x + 10, y: start.y - 25 };
  const childFinish = { x: finish.x + 4, y: finish.y - direction * 34 };
  const childDuration = duration * 1.18;
  let parentStopped = false;
  const startedAt = performance.now();
  return new Promise((resolve) => {
    function frame(now) {
      if (token !== motionToken) { bean.setRunning(false); restChild(); resolve(false); return; }
      const progress = Math.min(1, (now - startedAt) / duration);
      const childProgress = Math.min(1, (now - startedAt) / childDuration);
      setPosition({ x: start.x + (finish.x - start.x) * progress, y: start.y + (finish.y - start.y) * progress });
      setChildPosition({ x: childStart.x + (childFinish.x - childStart.x) * childProgress, y: childStart.y + (childFinish.y - childStart.y) * childProgress });
      if (progress >= 1 && !parentStopped) { bean.setRunning(false); parentStopped = true; }
      if (childProgress < 1) requestAnimationFrame(frame);
      else resolve(true);
    }
    requestAnimationFrame(frame);
  });
}

async function connectTo(view) {
  const target = geometry.battery(view);
  if (!target) return;
  if (connectedView === view && !requestedView) return;
  requestedView = view;
  const token = ++motionToken;
  bean.setPhase("unplugging");
  await wait(420);
  if (token !== motionToken) return;
  bean.setConnected(false);
  bean.setPowered(false);
  bean.setPhase();
  connectedView = null;
  if (!position) setPosition(target);
  const arrived = await moveTo(target, token);
  if (!arrived || token !== motionToken) return;
  bean.setPhase("plugging");
  await wait(460);
  if (token !== motionToken) return;
  bean.setConnected(true);
  bean.setPowered(true, target.color);
  bean.setPhase();
  connectedView = view;
  requestedView = null;
  restChild();
}

function initialize() {
  const active = document.querySelector(".sidebar nav button.active[data-view]");
  if (!active) return;
  const target = geometry.battery(active.dataset.view);
  if (!target) return;
  setPosition(target);
  bean.setConnected(true);
  bean.setPowered(true, target.color);
  restChild();
  connectedView = active.dataset.view;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest?.(".sidebar nav button[data-view]");
  if (button) connectTo(button.dataset.view);
}, true);

document.addEventListener("ticktocktome:navigation-rendered", (event) => {
  const view = event.detail?.view;
  requestAnimationFrame(() => {
    if (!position) initialize();
  });
});

function realign() {
  const view = requestedView || connectedView;
  const target = view ? geometry.battery(view) : null;
  if (target && connectedView === view) setPosition(target);
}

window.addEventListener("resize", realign);
document.addEventListener("scroll", realign, true);
requestAnimationFrame(initialize);
})();
