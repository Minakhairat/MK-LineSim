import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceStateTracker } from '../src/simulation/resourceStateTracker';

test('ResourceStateTracker records non-overlapping bounded machine states and closes unfinished intervals', () => {
  const horizon = 1000;
  const tracker = new ResourceStateTracker(horizon, true);
  tracker.initMachine('m1', 'idle', 0);

  tracker.transitionMachine('m1', 'setup', 100);
  tracker.transitionMachine('m1', 'running', 250);
  tracker.transitionMachine('m1', 'blocked', 600);
  tracker.transitionMachine('m1', 'starved', 750);
  tracker.transitionMachine('m1', 'down', 850);
  tracker.transitionMachine('m1', 'maintenance', 920);
  // Leave maintenance open until horizon=1000
  tracker.finalizeAt(horizon);

  const totals = tracker.getMachineTotals('m1', horizon);
  assert.equal(totals.idle, 100);
  assert.equal(totals.setup, 150);
  assert.equal(totals.running, 350);
  assert.equal(totals.blocked, 150);
  assert.equal(totals.starved, 100);
  assert.equal(totals.down, 70);
  assert.equal(totals.maintenance, 80);
  assert.equal(totals.total, 1000);

  const intervals = tracker.getRecordedMachineIntervals('m1');
  assert.equal(intervals.length, 7);
  for (let i = 0; i < intervals.length; i++) {
    assert.ok(intervals[i].endSec >= intervals[i].startSec);
    if (i > 0) {
      assert.equal(intervals[i].startSec, intervals[i - 1].endSec);
    }
  }
});

test('ResourceStateTracker guards against non-monotonic timestamps and exceeding horizon', () => {
  const tracker = new ResourceStateTracker(500, true);
  tracker.initMachine('m1', 'idle', 0);
  tracker.transitionMachine('m1', 'running', 300);
  // Attempt backward timestamp -> clamped to 300 (zero duration delta)
  tracker.transitionMachine('m1', 'blocked', 200);
  // Attempt past horizon -> clamped to 500
  tracker.transitionMachine('m1', 'idle', 999);
  tracker.finalizeAt(500);

  const totals = tracker.getMachineTotals('m1', 500);
  assert.equal(totals.idle, 300);
  assert.equal(totals.running, 0);
  assert.equal(totals.blocked, 200);
  assert.equal(totals.total, 500);
});

test('ResourceStateTracker accurately tracks worker and conveyor states', () => {
  const tracker = new ResourceStateTracker(600, false);
  tracker.initWorker('w1', 'unavailable', 0);
  tracker.initConveyor('c1', 'stopped', 0);

  tracker.transitionWorker('w1', 'idle', 60);
  tracker.transitionWorker('w1', 'walking', 120);
  tracker.transitionWorker('w1', 'busy', 150);
  tracker.transitionWorker('w1', 'break', 450);
  tracker.transitionWorker('w1', 'idle', 550);

  tracker.transitionConveyor('c1', 'moving', 100);
  tracker.transitionConveyor('c1', 'blocked', 300);
  tracker.transitionConveyor('c1', 'stopped', 400);

  tracker.finalizeAt(600);

  const wt = tracker.getWorkerTotals('w1', 600);
  assert.equal(wt.unavailable, 60);
  assert.equal(wt.idle, 110);
  assert.equal(wt.walking, 30);
  assert.equal(wt.busy, 300);
  assert.equal(wt.break, 100);
  assert.equal(wt.total, 600);

  const ct = tracker.getConveyorTotals('c1', 600);
  assert.equal(ct.stopped, 300);
  assert.equal(ct.moving, 200);
  assert.equal(ct.blocked, 100);
  assert.equal(ct.total, 600);
});
