import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { generate2DFactoryDxf, generate3DFactoryObj, generate3DFactoryStep, generate3DFactoryStl, cadStlNoticeText } from '../src/utils/cadExporter';
import { BETA_LIMITS_AR, BETA_LIMITS_EN } from '../src/utils/betaLimits';

const proj = () => JSON.parse(JSON.stringify(createDesertAirCoolerProject()));

test('DXF: ASCII comment records before the first SECTION, geometry records unchanged after them', () => {
  const dxf = generate2DFactoryDxf(proj());
  const lines = dxf.split(/\r?\n/);
  assert.deepEqual(lines.slice(0, 4), ['999', 'MK LineSim EXPERIMENTAL EXPORT', '999', BETA_LIMITS_EN]);
  assert.deepEqual(lines.slice(4, 8), ['0', 'SECTION', '2', 'HEADER']);
  assert.ok(/^[\x00-\x7F]*$/.test(dxf.slice(0, dxf.indexOf('SECTION'))));
  assert.ok(dxf.trimEnd().endsWith('EOF'));
});

test('STEP: header description carries the English text, no quote characters inside it', () => {
  const step = generate3DFactoryStep(proj());
  assert.ok(step.includes(`'${BETA_LIMITS_EN}'),'2;1');`));
  assert.ok(!BETA_LIMITS_EN.includes("'"));
  assert.ok(step.startsWith('ISO-10303-21;') && step.trimEnd().endsWith('END-ISO-10303-21;'));
});

test('OBJ: comment lines carry EN and AR; STL: header marker, triangle count and size consistent', () => {
  const obj = generate3DFactoryObj(proj());
  assert.ok(obj.includes('# ' + BETA_LIMITS_EN) && obj.includes('# ' + BETA_LIMITS_AR));
  const buf = generate3DFactoryStl(proj());
  const dv = new DataView(buf);
  assert.equal(buf.byteLength, 84 + dv.getUint32(80, true) * 50);
  const head = String.fromCharCode(...new Uint8Array(buf, 0, 80)).trim();
  assert.ok(head.includes('EXPERIMENTAL'));
  assert.ok(cadStlNoticeText('x.stl').includes(BETA_LIMITS_EN));
});
