(function () {
"use strict";
function create(layer) {
  const bean = document.createElement("div"); bean.className = "power-bean";
  bean.innerHTML = `<svg viewBox="0 0 49 44" role="presentation"><g class="backpack"><path class="backpack-shell" d="M7 12c-5 3-5 13-1 18h6V12Z"/><g class="carried-bulb"><path class="carried-bulb-glass" d="M3 8a5 5 0 1 1 8 4v3H6v-3A5 5 0 0 1 3 8Z"/><path class="carried-bulb-base" d="M6 15h5v3H6z"/></g></g><path class="carried-cord" d="M8 18C0 23 1 35 10 37c10 3 18-6 12-11-5-5-12 1-8 7 5 8 15-7 27-10"/><g class="bean-legs"><g class="leg leg-left"><path class="thigh" d="M19 32l-2 5"/><circle cx="17" cy="37" r="1.1"/><path class="shin" d="M17 37l-3 5"/></g><g class="leg leg-right"><path class="thigh" d="M29 32l2 5"/><circle cx="31" cy="37" r="1.1"/><path class="shin" d="M31 37l3 5"/></g></g><path class="bean-body" d="M10 23C10 11 16 5 25 5c8 0 13 6 13 16 0 11-6 16-15 16-8 0-13-5-13-14Z"/><path class="bean-screen" d="M15 13c5-4 13-4 18 0v12c-5 4-13 4-18 0Z"/><circle class="bean-eye" cx="21" cy="18" r="1.4"/><circle class="bean-eye" cx="28" cy="18" r="1.4"/><path class="bean-smile" d="M22 22c2 2 4 2 6 0"/><path class="bean-arm" d="M33 25c4 0 5-2 9-2"/><g class="power-plug"><path class="plug-cable" d="M40 23h4"/><path class="plug-body" d="M42 19h5v8h-5z"/><path class="plug-pin" d="M47 21h2M47 25h2"/></g></svg>`;
  const child = document.createElement("div"); child.className = "power-child is-sleeping";
  child.innerHTML = `<svg viewBox="0 0 28 31" role="presentation"><g class="child-legs"><g><path d="M8 22l-1 2"/><path d="M7 24l-1 2"/></g><g><path d="M12 24v2"/><path d="M12 26l-1 2"/></g><g><path d="M17 24v2"/><path d="M17 26l1 2"/></g><g><path d="M21 22l1 2"/><path d="M22 24l1 2"/></g></g><path class="child-body" d="M5 16C5 7 9 3 15 3s9 5 9 13c0 8-4 11-10 11S5 23 5 16Z"/><path class="child-screen" d="M8 10c4-3 9-3 13 0v9c-4 3-9 3-13 0Z"/><g class="child-awake"><circle cx="11" cy="14" r="1.1"/><circle cx="18" cy="14" r="1.1"/><path d="M11 18c2-3 5-3 7 0"/></g><g class="child-asleep"><path d="M9 14h4M16 14h4M12 18c2 1 3 1 5 0"/><text x="21" y="7">z</text></g></svg>`;
  layer.append(bean, child);
  return Object.freeze({
    element: bean,
    place(position) { bean.style.transform = `translate3d(${position.x}px,${position.y}px,0)`; },
    placeChild(position) { child.style.transform = `translate3d(${position.x}px,${position.y}px,0)`; },
    setPowered(value, color = "") { if (color) { bean.style.setProperty("--power-color", color); child.style.setProperty("--power-color", color); } bean.classList.toggle("is-powered", value); child.classList.toggle("is-powered", value); },
    setRunning(value) { bean.classList.toggle("is-running", value); },
    setChildChasing(value) { child.classList.toggle("is-chasing", value); child.classList.toggle("is-sleeping", !value); },
    setConnected(value) { bean.classList.toggle("is-connected", value); },
    setPhase(phase = "") { bean.classList.remove("is-unplugging", "is-plugging"); if (phase) { void bean.offsetWidth; bean.classList.add(`is-${phase}`); } },
  });
}
window.TickTockTomeScreenBeans = Object.freeze({ create });
})();
