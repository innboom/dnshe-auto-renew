import assert from "node:assert/strict";
import test from "node:test";
import worker, { checkRenewal } from "./worker.js";

const env = {
  DNSHE_DOMAIN: "demo.de5.net",
  DNSHE_API_KEY: "test-key",
  DNSHE_API_SECRET: "test-secret",
};
const now = Date.parse("2026-11-14T00:00:00Z");
const eligible = {
  id: 42,
  full_domain: env.DNSHE_DOMAIN,
  status: "active",
  expires_at: "2027-01-15 00:00:00",
};

test("deduplicates domains and records later results after a failed check", async (t) => {
  const results = new Map();
  const calls = t.mock.method(globalThis, "fetch", async (url) => {
    const prefix = new URL(url).searchParams.get("search");
    if (prefix === "missing") return Response.json({ success: true, subdomains: [] });
    return Response.json({ success: true, subdomains: [{ ...eligible, never_expires: 1 }] });
  });
  await assert.rejects(worker.scheduled({}, {
    ...env,
    DNSHE_DOMAIN: " missing.us.ci, DEMO.DE5.NET, demo.de5.net, ",
    RENEWAL_STATE: { put: async (key, value) => results.set(key, JSON.parse(value)) },
  }), AggregateError);
  assert.equal(calls.mock.callCount(), 2);
  assert.equal(results.get("last_check:missing.us.ci").outcome, "error");
  assert.equal(results.get("last_check:demo.de5.net").outcome, "never_expires");
  assert.deepEqual(results.get("last_check").domains, ["missing.us.ci", "demo.de5.net"]);
});

test("renews only the configured domain and verifies the new date and price", async (t) => {
  const calls = t.mock.method(globalThis, "fetch", async (url, options) => {
    if (options.method === "GET") {
      assert.match(url, /action=list/);
      return Response.json({
        success: true,
        subdomains: [{ ...eligible, id: 41, full_domain: "demo.us.ci" }, eligible],
      });
    }
    assert.match(url, /action=renew/);
    assert.deepEqual(JSON.parse(options.body), { subdomain_id: 42 });
    return Response.json({
      success: true, subdomain_id: 42, charged_amount: 0, new_expires_at: "2028-01-15 00:00:00",
    });
  });
  assert.equal((await checkRenewal(env, now)).outcome, "renewed");
  assert.equal(calls.mock.callCount(), 2);
});

test("does not call the renewal endpoint outside the safe window", async (t) => {
  for (const [record, expected] of [
    [{ ...eligible, expires_at: "2027-10-01 00:00:00" }, "not_due"],
    [{ ...eligible, status: "Registered", expires_at: "2027-11-14 14:29:07" }, "not_due"],
    [{ ...eligible, never_expires: 1 }, "never_expires"],
    [{ ...eligible, status: "expired" }, null],
    [{ ...eligible, expires_at: "2026-11-14 12:00:00" }, null],
    [{ ...eligible, expires_at: null }, null],
  ]) {
    const calls = t.mock.method(globalThis, "fetch", async () =>
      Response.json({ success: true, subdomains: [record] }),
    );
    if (expected) assert.equal((await checkRenewal(env, now)).outcome, expected);
    else await assert.rejects(checkRenewal(env, now));
    assert.equal(calls.mock.callCount(), 1);
    calls.mock.restore();
  }
});
