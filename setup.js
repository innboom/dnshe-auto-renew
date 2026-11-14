import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const configPath = "wrangler.local.jsonc";
const binding = "RENEWAL_STATE";

function wrangler(...args) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", ...args, "--config", configPath],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Wrangler 命令失败");
}

if (!existsSync(configPath)) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let domain;
  let name;
  try {
    domain = (await prompt.question("DNSHE 完整域名: ")).trim().toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(domain)) {
      throw new Error("请输入完整域名，例如 myapp.de5.net");
    }
    const defaultName = `dnshe-renew-${domain.replaceAll(".", "-").slice(0, 50).replace(/-+$/, "")}`;
    name = (await prompt.question(`Worker 名称 [${defaultName}]: `)).trim() || defaultName;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) {
      throw new Error("Worker 名称需为小写字母、数字或连字符，最多 63 字符");
    }
  } finally {
    prompt.close();
  }
  const config = {
    name,
    main: "worker.js",
    compatibility_date: "2026-11-14",
    workers_dev: false,
    preview_urls: false,
    observability: { enabled: true },
    vars: { DNSHE_DOMAIN: domain },
    triggers: { crons: ["17 1 * * MON"] },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", { flag: "wx" });
}

const existing = readFileSync(configPath, "utf8");
if (!/"binding"\s*:\s*"RENEWAL_STATE"/.test(existing)) {
  wrangler("kv", "namespace", "create", binding, "--binding", binding, "--update-config");
}
if (!/"binding"\s*:\s*"RENEWAL_STATE"/.test(readFileSync(configPath, "utf8"))) {
  throw new Error("Wrangler 未写入 KV 绑定，请核对命令输出");
}

wrangler("deploy");
console.log("部署完成。请在 Worker → Settings → Variables and Secrets 中添加两个 DNSHE Secret。");
