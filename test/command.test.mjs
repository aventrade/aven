// The command line parser: every documented command, aliases, and the errors it explains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../site/assets/command.js';

test('market, limit and stop orders', () => {
  assert.deepEqual(
    { ...parse('long btc 20x 1000') },
    { op: 'order', side: 'long', sym: 'BTC', type: 'market', lev: 20, margin: 1000, price: null, tp: null, sl: null, reduce: false },
  );
  const l = parse('short eth 10x 500 @2450');
  assert.equal(l.type, 'limit'); assert.equal(l.price, 2450);
  const s = parse('long sol 5x 300 stop 105');
  assert.equal(s.type, 'stop'); assert.equal(s.price, 105);
  const b = parse('long btc 20x 1000 tp 83000 sl 79000');
  assert.equal(b.tp, 83000); assert.equal(b.sl, 79000);
  assert.equal(parse('short btc 20x 500 reduce').reduce, true);
});

test('aliases for markets and sides', () => {
  assert.equal(parse('buy xau 5x 100').sym, 'GOLD');
  assert.equal(parse('sell wti 2x 100').sym, 'OIL');
  assert.equal(parse('l 1000pepe 3x 50').sym, 'PEPE');
  assert.equal(parse('long BTC-PERP 2x 50').sym, 'BTC');
});

test('position management', () => {
  assert.equal(parse('close btc').share, 1);
  assert.equal(parse('close btc 50%').share, 0.5);
  assert.equal(parse('margin btc +200').amount, 200);
  assert.equal(parse('margin btc -100').amount, -100);
  assert.equal(parse('tp btc 83000').price, 83000);
  assert.equal(parse('cancel all').sym, 'ALL');
  assert.equal(parse('go hype').sym, 'HYPE');
});

test('alerts and pairs', () => {
  assert.deepEqual({ ...parse('alert btc above 82000') }, { op: 'alert', sym: 'BTC', dir: 'above', price: 82000 });
  assert.equal(parse('alert nvda 200').dir, null);
  const p = parse('pair long nvda short qqq 1000 3x');
  assert.deepEqual(p.legs, [{ side: 'long', sym: 'NVDA' }, { side: 'short', sym: 'QQQ' }]);
  assert.equal(p.margin, 1000); assert.equal(p.lev, 3);
  assert.equal(parse('close pair #12').id, 12);
});

test('errors say what is missing', () => {
  assert.throws(() => parse('long doge'), /How much margin/);
  assert.throws(() => parse('long nope 2x 10'), /No nope market/);
  assert.throws(() => parse('short eth 10x 500 stop'), /needs a price/);
  assert.throws(() => parse('pair long btc long eth 100'), /one long and one short/);
  assert.throws(() => parse('dance btc'), /Unknown command/);
});
