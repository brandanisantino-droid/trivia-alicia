// Codificación compartida de forma + color para las 4 opciones de respuesta.
// Ayuda a distinguir las opciones incluso para quienes ven los colores con dificultad.
window.OPTION_CLASSES = ["option-a", "option-b", "option-c", "option-d", "option-e", "option-f"];

const SHAPES = {
  0: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>',
  1: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 22,21 2,21"/></svg>',
  2: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>',
  3: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12,1 23,12 12,23 1,12"/></svg>',
  4: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12,1 15.1,8.6 23.4,9.1 17,14.3 19.1,22.4 12,17.9 4.9,22.4 7,14.3 0.6,9.1 8.9,8.6"/></svg>',
  5: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/></svg>',
};

window.optionShapeSVG = function (index) {
  return SHAPES[index] || SHAPES[0];
};
