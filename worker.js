const baseUrl = "https://api005.dnshe.com/index.php?m=domain_hub&endpoint=subdomains";
const dayMs = 86_400_000;
const renewWithinDays = 90;

function timestamp(value) {
  if (typeof value !== "string") return NaN;
  // DNSHE examples omit the time zone. Treat those dates as UTC.
  const normalized = value.replace(" ", "T");
  return Date.parse(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)
      ? normalized + "Z"
      : normalized,
  );
}

async function request(action, env, options = {}) {
  const { query = "", body } = options;
  const headers = {
    "X-API-Key": env.DNSHE_API_KEY,
    "X-API-Secret": env.DNSHE_API_SECRET,
  };
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}&action=${action}${query}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`DNSHE ${action} returned HTTP ${response.status}`);
  const data = await response.json();
  if (data.success !== true) throw new Error(`DNSHE ${action} failed`);
  return data;
}

export async function checkRenewal(env, now = Date.now()) {
  if (!env.DNSHE_API_KEY || !env.DNSHE_API_SECRET || !env.DNSHE_DOMAIN) {
    throw new Error("Missing DNSHE_DOMAIN, DNSHE_API_KEY or DNSHE_API_SECRET");
  }
  const domain = env.DNSHE_DOMAIN.trim().toLowerCase();
  const prefix = domain.split(".")[0];
  const result = await request("list", env, {
    query: `&search=${encodeURIComponent(prefix)}&per_page=500&fields=id,full_domain,status,expires_at,never_expires`,
  });
  const record = result.subdomains?.find((item) => item.full_domain === domain);
  if (!record) throw new Error("Configured domain not found in DNSHE");
  if ([true, 1, "1"].includes(record.never_expires)) return { outcome: "never_expires" };
  const expiration = timestamp(record.expires_at);
  if (record.status !== "active" || !Number.isFinite(expiration) || expiration <= now) {
    throw new Error("Domain is not active with a usable future expiration");
  }
  const remaining = expiration - now;
  const observed = { expiresAt: record.expires_at };
  if (remaining > renewWithinDays * dayMs) return { ...observed, outcome: "not_due" };
  // Avoid a write close to the expiry boundary, including any time-zone ambiguity.
  if (remaining <= dayMs) throw new Error("Less than 24 hours remaining; check the DNSHE dashboard");
  const id = Number(record.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid DNSHE domain ID");

  const renewed = await request("renew", env, { body: { subdomain_id: id } });
  if (
    Number(renewed.subdomain_id) !== id ||
    ![0, "0", "0.00"].includes(renewed.charged_amount) ||
    !(timestamp(renewed.new_expires_at) > expiration)
  ) {
    throw new Error("Renewal could not be verified; check the DNSHE dashboard");
  }
  return { outcome: "renewed", previousExpiresAt: record.expires_at, expiresAt: renewed.new_expires_at };
}

export default {
  async scheduled(_controller, env) {
    const domains = [...new Set(
      (env.DNSHE_DOMAIN ?? "").split(",").map((domain) => domain.trim().toLowerCase()).filter(Boolean),
    )];
    if (domains.length === 0) {
      const message = "Missing DNSHE_DOMAIN";
      await saveResult(env, "last_check", { outcome: "error", message });
      throw new Error(message);
    }

    const failures = [];
    for (const domain of domains) {
      try {
        let event;
        try {
          event = await checkRenewal({ ...env, DNSHE_DOMAIN: domain });
        } catch (error) {
          event = { outcome: "error", message: error.message };
          failures.push(error);
        }
        const result = { domain, ...event };
        await saveResult(env, `last_check:${domain}`, result);
        if (domains.length === 1) await saveResult(env, "last_check", result);
      } catch (error) {
        console.error(JSON.stringify({ domain, outcome: "error", message: error.message }));
        failures.push(error);
      }
    }
    if (domains.length > 1) {
      await saveResult(env, "last_check", {
        outcome: failures.length ? "error" : "checked",
        domains,
      });
    }
    if (failures.length) throw new AggregateError(failures, "One or more DNSHE checks failed");
  },
};

async function saveResult(env, key, event) {
  const result = { ...event, checkedAt: new Date().toISOString() };
  console.log(JSON.stringify(result));
  await env.RENEWAL_STATE.put(key, JSON.stringify(result));
}
