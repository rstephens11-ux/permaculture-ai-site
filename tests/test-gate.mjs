// tests/test-gate.mjs — one render free, five a week for an email, and the honest limits of that.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeGate } from "../api/gate.mjs";

function freshGate(overrides = {}) {
  const path = join(tmpdir(), `pa-gate-test-${Math.random().toString(36).slice(2)}.json`);
  const gate = makeGate({ path, freeRenders: 1, rendersAfterEmail: 5, ...overrides });
  return { gate, path };
}

test("the first render is free", () => {
  const { gate, path } = freshGate();
  const token = gate.newToken();
  const s = gate.status(token);
  assert.equal(s.allowed, true);
  assert.equal(s.reason, "free");
  assert.equal(s.free_left, 1);
  rmSync(path, { force: true });
});

test("the second render asks for an email", () => {
  const { gate, path } = freshGate();
  const token = gate.newToken();
  gate.take({ token, ip: "1.1.1.1" });
  const s = gate.status(token);
  assert.equal(s.allowed, false);
  assert.equal(s.reason, "email_required");
  assert.equal(s.needs_email, true);
  assert.equal(s.week_left, 0);
  rmSync(path, { force: true });
});

test("an email buys five, and the sixth says to come back next week", () => {
  const { gate, path } = freshGate();
  const token = gate.newToken();
  gate.take({ token, ip: "2.2.2.2" });
  const after = gate.registerEmail({ token, ip: "2.2.2.2", email: "Gardener@Example.com " });
  assert.equal(after.allowed, true);
  assert.equal(after.week_left, 5);
  assert.equal(after.email_on_file, true);
  for (let i = 0; i < 5; i++) {
    assert.equal(gate.status(token).allowed, true, `render ${i + 1} of the weekly five`);
    gate.take({ token, ip: "2.2.2.2" });
  }
  const s = gate.status(token);
  assert.equal(s.allowed, false);
  assert.equal(s.reason, "week_used");
  assert.match(String(s.week_left), /^0$/);
  rmSync(path, { force: true });
});

test("the email is normalised, because 'Gardener@Example.com ' is the same person", () => {
  const { gate, path } = freshGate();
  const token = gate.newToken();
  gate.registerEmail({ token, ip: "3.3.3.3", email: "Gardener@Example.com " });
  assert.equal(gate.snapshot().emails_collected, 1);
  assert.equal(gate.status(token).email_on_file, true);
  rmSync(path, { force: true });
});

test("the week rolls over", () => {
  const { gate, path } = freshGate();
  const token = gate.newToken();
  gate.take({ token, ip: "4.4.4.4" });
  gate.registerEmail({ token, ip: "4.4.4.4", email: "a@b.com" });
  for (let i = 0; i < 5; i++) gate.take({ token, ip: "4.4.4.4" });
  assert.equal(gate.status(token).allowed, false);

  const real = Date.now;
  Date.now = () => real() + 8 * 24 * 60 * 60 * 1000; // a week and a day later
  try {
    const s = gate.status(token);
    assert.equal(s.allowed, true, "a new week, a new five");
    assert.equal(s.week_left, 5);
  } finally {
    Date.now = real;
    rmSync(path, { force: true });
  }
});

test("state survives a restart, so a bounce doesn't hand out a fresh free render", () => {
  const { gate, path } = freshGate();
  const token = gate.newToken();
  gate.take({ token, ip: "5.5.5.5" });
  const reloaded = makeGate({ path, freeRenders: 1, rendersAfterEmail: 5 });
  const s = reloaded.status(token);
  assert.equal(s.allowed, false, "the free render is still spent");
  assert.equal(s.reason, "email_required");
  rmSync(path, { force: true });
});

test("an unknown token is refused rather than given a free render", () => {
  const { gate, path } = freshGate();
  const s = gate.status(null);
  assert.equal(s.allowed, false);
  assert.equal(s.reason, "no_token");
  rmSync(path, { force: true });
});
