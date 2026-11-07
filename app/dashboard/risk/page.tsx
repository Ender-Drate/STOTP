import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { currentUser } from "@/lib/session";
import { hasPermission, isSuperAdmin } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { getRiskSettings, getRecentObservations, getVisitIps, ipRiskScores, RISK_LABELS, riskLevel, type RiskSettings } from "@/lib/risk";
import { firstValidIp } from "@/lib/ip";
import { formatDateTime } from "@/lib/datetime";
import { listIpRules } from "@/lib/ip-rules";
import { RiskSettingsForm } from "@/app/components/RiskSettingsForm";
import { IpRulesPanel } from "@/app/components/IpRulesPanel";
import { IpDetailsButton } from "@/app/components/IpDetailsButton";

export const dynamic = "force-dynamic";

interface AuditRow {
  id: number;
  ts: string;
  event: string;
  user_id: number | null;
  ip: string | null;
  detail: string | null;
  username: string | null;
}

const LEVEL_TEXT: Record<string, string> = {
  low: "低", medium: "中", high: "高", critical: "严重",
};

function riskTone(level: string): string {
  if (level === "critical") return "pill-red";
  if (level === "high") return "pill-amber";
  if (level === "medium") return "pill-blue";
  return "pill-green";
}

export default async function RiskPage() {
  const me = await currentUser();
  if (!me) redirect("/login?next=/dashboard/risk");
  if (!hasPermission(me, "audit.view")) {
    return (
      <div className="card card-pad">
        <div className="card-title">需要权限</div>
        <p className="muted small" style={{ marginTop: 6 }}>当前权限等级不能查看风险控制。</p>
      </div>
    );
  }

  const settings = getRiskSettings();
  const scores = ipRiskScores();
  const visits = getVisitIps(settings.visitWindowHours);
  const observations = getRecentObservations(30);
  const rules = listIpRules();
  const requestHeaders = await headers();
  const xRealIp = requestHeaders.get("x-real-ip") || "-";
  const xForwardedFor = requestHeaders.get("x-forwarded-for") || "-";
  const cfConnectingIp = requestHeaders.get("cf-connecting-ip") || "-";
  const detectedIp = firstValidIp([xRealIp]) || "127.0.0.1";
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const failed = getDb().prepare(
    "SELECT COUNT(*) AS c FROM audit WHERE event = 'login_failed' AND ts >= ?"
  ).get(since) as { c: number };
  const uniqueIps = getDb().prepare(
    "SELECT COUNT(DISTINCT ip) AS c FROM audit WHERE ts >= ? AND ip IS NOT NULL"
  ).get(since) as { c: number };
  const highRisk = Array.from(scores.values()).filter(
    (item) => item.level === "high" || item.level === "critical"
  ).length;
  const rows = getDb().prepare(
    `SELECT audit.*, users.username FROM audit
     LEFT JOIN users ON users.id = audit.user_id
     ORDER BY audit.id DESC LIMIT 80`
  ).all() as unknown as AuditRow[];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">风险控制</h1>
          <p className="page-desc">登录风险指标与最近审计</p>
        </div>
        <span className={`pill ${highRisk ? "pill-red" : "pill-green"}`}>
          {highRisk ? `${highRisk} 个高风险 IP` : "无高风险 IP"}
        </span>
        <a className="btn btn-ghost btn-sm" href="/api/admin/audit/export">导出审计 CSV</a>
      </div>

      <div className="grid grid-4">
        <div className="card stat">
          <div className="stat-label">24h 登录失败</div>
          <div className="stat-value">{failed.c}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">24h 独立 IP</div>
          <div className="stat-value">{uniqueIps.c}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">高风险 IP</div>
          <div className="stat-value">{highRisk}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">验证码阈值</div>
          <div className="stat-value">{settings.captchaAfterFailures}</div>
          <div className="small muted">次失败后要求</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {isSuperAdmin(me) ? (
          <RiskSettingsForm initial={settings} />
        ) : (
          <div className="card card-pad">
            <div className="card-title" style={{ marginBottom: 10 }}>风控指标</div>
            <div className="kv">
              {(Object.keys(RISK_LABELS) as Array<keyof RiskSettings>).map((key) => (
                <div className="kv-row" key={key}>
                  <span className="muted">{RISK_LABELS[key]}</span>
                  <span className="mono">{settings[key]}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {hasPermission(me, "risk.manage") ? (
        <div style={{ marginTop: 16 }}>
          <IpRulesPanel rules={rules.map((rule) => ({
            id: rule.id, ip: rule.ip, action: rule.action, reason: rule.reason,
            created_by: rule.created_by, created_at: rule.created_at, expires_at: rule.expires_at,
          }))} />
        </div>
      ) : null}

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <div className="spread" style={{ marginBottom: 8 }}>
          <div className="card-title">当前请求来源</div>
          <span className="pill">{detectedIp}</span>
        </div>
        <div className="kv">
          <div className="kv-row"><span className="muted">X-Real-IP</span><span className="mono small">{xRealIp}</span></div>
          <div className="kv-row"><span className="muted">X-Forwarded-For</span><span className="mono small">{xForwardedFor}</span></div>
          <div className="kv-row"><span className="muted">CF-Connecting-IP</span><span className="mono small">{cfConnectingIp}</span></div>
        </div>
        {detectedIp === "127.0.0.1" ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            代理头为空或只包含回环地址，请检查 nginx 是否传递 X-Real-IP / X-Forwarded-For。
          </p>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div className="card-title">{settings.visitWindowHours} 小时访问 IP</div>
          <span className="pill">{visits.length} 个</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>IP</th>
                <th>属地</th>
                <th>次数</th>
                <th>首次</th>
                <th>最近</th>
                <th>风险</th>
                <th>环境信号</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((item) => (
                <tr key={item.ip}>
                  <td className="mono small">{item.ip}</td>
                  <td>{item.location}</td>
                  <td>{item.count}</td>
                  <td className="mono small">{formatDateTime(item.first)}</td>
                  <td className="mono small">{formatDateTime(item.last)}</td>
                  <td><span className={`pill ${riskTone(item.level)}`}>{LEVEL_TEXT[item.level]} · {item.score}</span></td>
                  <td className="small muted" style={{ maxWidth: 360 }}>
                    {item.reasons.length ? item.reasons.slice(0, 3).join("；") : "无异常"}
                    {item.tlsFingerprint ? (
                      <span title={item.tlsFingerprint}> · TLS {item.tlsFingerprint.slice(0, 18)}</span>
                    ) : ""}
                  </td>
                  <td><IpDetailsButton ip={item.ip} /></td>
                </tr>
              ))}
              {visits.length === 0 ? (
                <tr><td colSpan={8} className="muted">暂无访问记录</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div className="card-title">最近访问观测</div>
          <span className="pill">最近 30 条</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>IP</th>
                <th>属地</th>
                <th>页面</th>
                <th>渲染器 / 平台</th>
                <th>风险</th>
                <th>原因 / TLS</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((item) => (
                <tr key={item.id}>
                  <td className="mono small">{formatDateTime(item.ts)}</td>
                  <td className="mono small">{item.ip}</td>
                  <td>{item.location}</td>
                  <td className="mono small">{item.path || "-"}</td>
                  <td className="small">
                    <div className="truncate" style={{ maxWidth: 240 }}>{item.renderer}</div>
                    <div className="muted">{item.platform}</div>
                  </td>
                  <td><span className={`pill ${riskTone(riskLevel(item.score, settings))}`}>
                    {LEVEL_TEXT[riskLevel(item.score, settings)]} · {item.score}
                  </span></td>
                  <td className="small muted" style={{ maxWidth: 320 }}>
                    {item.reasons.length ? item.reasons.slice(0, 2).join("；") : "无异常"}
                    {item.tlsFingerprint ? (
                      <span title={item.tlsFingerprint}> · TLS {item.tlsFingerprint.slice(0, 18)}</span>
                    ) : ""}
                  </td>
                </tr>
              ))}
              {observations.length === 0 ? (
                <tr><td colSpan={7} className="muted">暂无客户端观测</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div className="card-title">最近审计</div>
          <span className="pill">最近 80 条</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>事件</th>
                <th>账号</th>
                <th>IP</th>
                <th>风险</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const risk = row.ip ? scores.get(row.ip) : undefined;
                const score = risk?.score ?? 0;
                const level = risk?.level ?? riskLevel(score, settings);
                return (
                  <tr key={row.id}>
                    <td className="mono small">{formatDateTime(row.ts)}</td>
                    <td><span className="pill">{row.event}</span></td>
                    <td>{row.username || (row.user_id ? `#${row.user_id}` : "-")}</td>
                    <td className="mono small">{row.ip || "-"}</td>
                    <td>
                      <span className={`pill ${riskTone(level)}`}>
                        {LEVEL_TEXT[level]} · {score}
                      </span>
                    </td>
                    <td className="small muted">{row.detail || "-"}</td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="muted">暂无审计记录</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
