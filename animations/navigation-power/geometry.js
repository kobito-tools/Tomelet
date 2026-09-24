(function () {
"use strict";

const beanWidth = 49;
const beanHeight = 42;

function battery(view) {
  const element = document.querySelector(`.sidebar nav button[data-view="${CSS.escape(view)}"]`);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return {
    element,
    x: Math.max(0, rect.left - beanWidth + 2),
    y: rect.top + (rect.height - beanHeight) / 2,
    plugX: rect.left - 2,
    plugY: rect.top + rect.height / 2,
    color: style.getPropertyValue("--power-strong").trim() || "#e8b9ae",
  };
}

function bulb() {
  const element = document.querySelector("#navigationPowerLayer .power-bulb");
  if (!element) return { x: 18, y: 88 };
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.bottom - 2 };
}

window.TickTockTomePowerGeometry = Object.freeze({ battery, bulb, beanWidth, beanHeight });
})();
