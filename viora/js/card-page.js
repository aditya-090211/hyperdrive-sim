import { CARD, cardSvg } from './card.js';

document.getElementById('cardView').innerHTML = cardSvg();
const sheet = document.getElementById('printSheet');
sheet.innerHTML = `<div>${cardSvg()}</div><div>${cardSvg()}</div>
  <div class="cap">Viora reference card. Printed at 100%, each card measures 120 x 80 mm. Cut along the dashed outline.</div>`;
document.getElementById('printBtn').addEventListener('click', () => window.print());

const fs = CARD.fiducialSize;
const rows = [
  ['Fiducials (black, 10 x 10 mm)', CARD.fiducials.map(([x, y]) => `(${x}, ${y})-(${x + fs}, ${y + fs})`).join(', ')],
  ['Orientation key', `${CARD.keyHole.size} x ${CARD.keyHole.size} mm white hole centred at (${CARD.keyHole.cx}, ${CARD.keyHole.cy})`],
  ['White patch (bare paper)', `centre (${CARD.white.cx}, ${CARD.white.cy}), ${CARD.patchSize} x ${CARD.patchSize} mm`],
  ['Grey patch', `centre (${CARD.grey.cx}, ${CARD.grey.cy}), ${CARD.grey.hex}`],
  ...CARD.refs.map(r => [`${r.label} patch`, `centre (${r.cx}, ${r.cy}), <span class="swatch-sm" style="background:${r.hex}"></span> ${r.hex}`]),
  ['Strip slot', `(${CARD.slot.x0}, ${CARD.slot.y0})-(${CARD.slot.x1}, ${CARD.slot.y1})`],
  ['Control pad target', `centre (${CARD.control.cx}, ${CARD.control.cy}), sampled ${CARD.sampleSize} x ${CARD.sampleSize} mm`],
  ['Test pad target', `centre (${CARD.test.cx}, ${CARD.test.cy}), sampled ${CARD.sampleSize} x ${CARD.sampleSize} mm`]
];
document.getElementById('geomTable').innerHTML =
  '<tr><th>Element</th><th>Position</th></tr>' + rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
