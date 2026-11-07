import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatBytes, formatRate, getSystemStats } from "@/lib/system-stats";
import { formatDateTime } from "@/lib/datetime";
import { Popover } from "@/app/components/Feedback";

export const dynamic = "force-dynamic";

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function Meter({ value, tone = "" }: { value: number; tone?: string }) {
  return (
    <div className="meter">
      <span className={tone} style={{ width: `${clamp(value)}%` }} />
    </div>
  );
}

export default async function StatsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard/stats");
  if (!hasPermission(user, "stats.view")) {
    return (
      <div className="card card-pad">
        <div className="card-title">需要权限</div>
        <p className="muted small" style={{ marginTop: 6 }}>当前权限等级不能查看统计信息。</p>
      </div>
    );
  }
  const stats = await getSystemStats();
  const uptimeHours = Math.floor(stats.uptime / 3600);
  const uptimeDays = Math.floor(uptimeHours / 24);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">统计信息</h1>
          <p className="page-desc">主机资源与认证运行指标</p>
        </div>
        <span className="pill">{formatDateTime(stats.now)}</span>
      </div>

      <div className="grid grid-4">
        <div className="card stat">
          <div className="stat-label">CPU 使用率</div>
          <div className="stat-value">{stats.cpu.toFixed(1)}%</div>
          <Meter value={stats.cpu} tone={stats.cpu > 85 ? "danger" : stats.cpu > 65 ? "warn" : ""} />
          <div className="small muted" style={{ marginTop: 8 }}>
            {stats.cores} 核 · load {stats.load.map((n) => n.toFixed(2)).join(" / ")}
          </div>
        </div>
        <div className="card stat">
          <div className="stat-label">内存使用</div>
          <div className="stat-value">{stats.memory.toFixed(1)}%</div>
          <Meter value={stats.memory} tone={stats.memory > 85 ? "danger" : stats.memory > 65 ? "warn" : ""} />
          <div className="small muted" style={{ marginTop: 8 }}>
            {formatBytes(stats.totalMem - stats.freeMem)} / {formatBytes(stats.totalMem)}
          </div>
        </div>
        <div className="card stat">
          <div className="stat-label">磁盘使用</div>
          <div className="stat-value">{stats.disk.percent.toFixed(1)}%</div>
          <Meter value={stats.disk.percent} tone={stats.disk.percent > 90 ? "danger" : stats.disk.percent > 75 ? "warn" : ""} />
          <div className="small muted" style={{ marginTop: 8 }}>
            {formatBytes(stats.disk.used)} / {formatBytes(stats.disk.total)}
          </div>
        </div>
        <div className="card stat">
          <div className="stat-label row">
            认证 QPS
            <Popover label="说明">近 60 秒写入审计的认证事件数除以 60，不包含静态资源请求。</Popover>
          </div>
          <div className="stat-value">{stats.qps.toFixed(2)}</div>
          <div className="small muted" style={{ marginTop: 8 }}>近 60 秒认证事件 / 60</div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">网络</div>
            <span className="pill">实时</span>
          </div>
          <div className="card-pad grid grid-2" style={{ gap: 12 }}>
            <div>
              <div className="stat-label">接收</div>
              <div className="stat-value" style={{ fontSize: 22 }}>{formatRate(stats.net.rxRate)}</div>
              <div className="small muted">累计 {formatBytes(stats.net.rxTotal)}</div>
            </div>
            <div>
              <div className="stat-label">发送</div>
              <div className="stat-value" style={{ fontSize: 22 }}>{formatRate(stats.net.txRate)}</div>
              <div className="small muted">累计 {formatBytes(stats.net.txTotal)}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div className="card-title">主机</div>
          </div>
          <div className="card-pad">
            <div className="kv">
              <div className="kv-row"><span className="muted">主机名</span><span className="mono">{stats.hostname}</span></div>
              <div className="kv-row"><span className="muted">系统</span><span className="mono">{stats.platform}</span></div>
              <div className="kv-row"><span className="muted">运行时间</span><span>{uptimeDays} 天 {uptimeHours % 24} 小时</span></div>
              <div className="kv-row"><span className="muted">进程内存</span><span>{formatBytes(stats.processRss)}</span></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
