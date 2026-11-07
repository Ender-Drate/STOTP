import os from "node:os";
import { readFile, statfs } from "node:fs/promises";
import { getDb, nowIso } from "./db";

function cpuSnapshot() {
  return os.cpus().reduce((acc, cpu) => {
    const t = cpu.times;
    return {
      idle: acc.idle + t.idle,
      total: acc.total + t.user + t.nice + t.sys + t.idle + t.irq,
    };
  }, { idle: 0, total: 0 });
}

async function networkSnapshot(): Promise<{ rx: number; tx: number }> {
  try {
    const text = await readFile("/proc/net/dev", "utf8");
    let rx = 0;
    let tx = 0;
    for (const line of text.split("\n").slice(2)) {
      const [name, rest] = line.split(":");
      if (!name || !rest || name.trim() === "lo") continue;
      const cols = rest.trim().split(/\s+/).map(Number);
      rx += cols[0] || 0;
      tx += cols[8] || 0;
    }
    return { rx, tx };
  } catch {
    return { rx: 0, tx: 0 };
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getSystemStats() {
  const cpu1 = cpuSnapshot();
  const net1 = await networkSnapshot();
  await delay(180);
  const cpu2 = cpuSnapshot();
  const net2 = await networkSnapshot();

  const idle = cpu2.idle - cpu1.idle;
  const total = cpu2.total - cpu1.total;
  const cpu = total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memory = totalMem > 0 ? ((totalMem - freeMem) / totalMem) * 100 : 0;

  let disk = { total: 0, used: 0, percent: 0, free: 0 };
  try {
    const info = await statfs("/");
    const totalDisk = info.blocks * info.bsize;
    const freeDisk = info.bavail * info.bsize;
    disk = {
      total: totalDisk,
      free: freeDisk,
      used: totalDisk - freeDisk,
      percent: totalDisk > 0 ? ((totalDisk - freeDisk) / totalDisk) * 100 : 0,
    };
  } catch {
    // 非 Linux 环境保留零值
  }

  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const qps = (getDb().prepare("SELECT COUNT(*) AS c FROM audit WHERE ts >= ?")
    .get(cutoff) as { c: number }).c / 60;

  return {
    cpu,
    memory,
    disk,
    qps,
    load: os.loadavg(),
    uptime: os.uptime(),
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    cores: os.cpus().length,
    totalMem,
    freeMem,
    net: {
      rxRate: (net2.rx - net1.rx) / 0.18,
      txRate: (net2.tx - net1.tx) / 0.18,
      rxTotal: net2.rx,
      txTotal: net2.tx,
    },
    processRss: process.memoryUsage().rss,
    now: nowIso(),
  };
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatRate(value: number): string {
  return `${formatBytes(value)}/s`;
}
