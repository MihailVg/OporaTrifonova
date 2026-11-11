import { debounce, formatDateRu, formatShortDate } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
let gradientCounter = 0;

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  return node;
}

function textEl(text, attrs = {}) {
  const node = svgEl('text', attrs);
  node.textContent = text;
  return node;
}

/**
 * Линейный график боли.
 * points: [{ date: 'YYYY-MM-DD', avg: number|null, max: number|null }]
 */
export function lineChart(svg, points = [], options = {}) {
  if (!svg) return false;

  const data = (Array.isArray(points) ? points : []).filter(
    (point) => point && Number.isFinite(Number(point.avg)),
  );
  if (!data.length) {
    svg.replaceChildren();
    return false;
  }

  svg._chartData = points;
  svg._chartOptions = options;

  if (!svg._chartObserver && 'ResizeObserver' in window) {
    const observer = new ResizeObserver(
      debounce(() => {
        if (svg._chartData) lineChart(svg, svg._chartData, svg._chartOptions);
      }, 120),
    );
    observer.observe(svg.parentElement || svg);
    svg._chartObserver = observer;
  }

  const width = Math.max(280, Math.round(svg.clientWidth || svg.parentElement?.clientWidth || 620));
  const height = Math.max(150, Number(options.height) || 220);
  const margin = { top: 16, right: 14, bottom: 26, left: 30 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const yMax = Number(options.yMax) || 10;

  const x = (index) =>
    data.length === 1
      ? margin.left + plotWidth / 2
      : margin.left + (index / (data.length - 1)) * plotWidth;
  const y = (value) => margin.top + plotHeight - (Math.min(yMax, Math.max(0, value)) / yMax) * plotHeight;

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();

  const defs = svgEl('defs');
  const gradientId = `chart-gradient-${++gradientCounter}`;
  const gradient = svgEl('linearGradient', { id: gradientId, x1: '0', x2: '0', y1: '0', y2: '1' });
  gradient.append(
    svgEl('stop', { offset: '0%', 'stop-color': '#c8523f', 'stop-opacity': '0.22' }),
    svgEl('stop', { offset: '100%', 'stop-color': '#c8523f', 'stop-opacity': '0' }),
  );
  defs.append(gradient);
  svg.append(defs);

  for (let value = 0; value <= yMax; value += 2) {
    const lineY = y(value);
    svg.append(
      svgEl('line', {
        x1: margin.left,
        y1: lineY,
        x2: width - margin.right,
        y2: lineY,
        class: 'chart-grid-line',
      }),
    );
    svg.append(
      textEl(String(value), {
        x: margin.left - 7,
        y: lineY + 3,
        'text-anchor': 'end',
        class: 'chart-axis-label',
      }),
    );
  }

  const avgPath = data
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(Number(point.avg)).toFixed(1)}`)
    .join(' ');

  if (data.length > 1) {
    const areaPath = `${avgPath} L${x(data.length - 1).toFixed(1)} ${(margin.top + plotHeight).toFixed(1)} L${x(0).toFixed(1)} ${(margin.top + plotHeight).toFixed(1)} Z`;
    svg.append(svgEl('path', { d: areaPath, fill: `url(#${gradientId})`, class: 'chart-area' }));
  }

  const maxPoints = data.filter((point) => Number.isFinite(Number(point.max)));
  if (maxPoints.length > 1) {
    const maxPath = data
      .map((point, index) =>
        Number.isFinite(Number(point.max))
          ? `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(Number(point.max)).toFixed(1)}`
          : '',
      )
      .filter(Boolean)
      .join(' ');
    svg.append(svgEl('path', { d: maxPath, class: 'chart-line chart-line--max' }));
  }

  svg.append(svgEl('path', { d: avgPath, class: 'chart-line' }));

  data.forEach((point, index) => {
    const dot = svgEl('circle', {
      cx: x(index),
      cy: y(Number(point.avg)),
      r: data.length > 12 ? 3.2 : 4,
      class: 'chart-dot',
    });
    const title = svgEl('title');
    title.textContent = `${formatDateRu(point.date)}: средняя боль ${Number(point.avg)} из 10${
      Number.isFinite(Number(point.max)) ? `, максимальная ${Number(point.max)}` : ''
    }`;
    dot.append(title);
    svg.append(dot);
  });

  const labelIndexes = new Set([0, data.length - 1, Math.floor((data.length - 1) / 2)]);
  [...labelIndexes]
    .filter((index) => index >= 0 && index < data.length)
    .sort((a, b) => a - b)
    .forEach((index) => {
      svg.append(
        textEl(formatShortDate(data[index].date), {
          x: x(index),
          y: height - 6,
          'text-anchor': index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle',
          class: 'chart-axis-label',
        }),
      );
    });

  const last = data[data.length - 1];
  if (data.length > 1) {
    const lastX = x(data.length - 1);
    const lastY = y(Number(last.avg));
    svg.append(
      svgEl('circle', {
        cx: lastX,
        cy: lastY,
        r: 7,
        fill: 'transparent',
        stroke: 'rgba(200, 82, 63, 0.22)',
        'stroke-width': 3,
      }),
    );
    svg.append(
      textEl(String(last.avg), {
        x: Math.min(width - 8, lastX + 9),
        y: Math.max(14, lastY - 9),
        'text-anchor': lastX > width - 40 ? 'end' : 'start',
        class: 'chart-value-label',
      }),
    );
  }

  const first = data[0];
  svg.setAttribute(
    'aria-label',
    `График боли: ${formatDateRu(first.date)} — ${first.avg} из 10, ${formatDateRu(last.date)} — ${last.avg} из 10`,
  );

  return true;
}
