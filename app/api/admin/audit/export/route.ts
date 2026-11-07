import { currentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { errorResponse, HttpError } from "@/lib/http";

export const runtime = "nodejs";

interface ExportRow {
  id: number;
  ts: string;
  event: string;
  user_id: number | null;
  client_id: string | null;
  ip: string | null;
  detail: string | null;
  username: string | null;
}

function cell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // 防止 Excel/Sheets 公式注入：= + - @ 以及控制字符开头一律按文本处理
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, "unauthorized", "请先登录");
    if (!hasPermission(user, "audit.view")) {
      throw new HttpError(403, "forbidden", "没有审计导出权限");
    }
    const rows = getDb().prepare(
      `SELECT audit.*, users.username FROM audit
       LEFT JOIN users ON users.id = audit.user_id
       ORDER BY audit.id DESC LIMIT 50000`
    ).all() as unknown as ExportRow[];
    const header = ["id", "时间(UTC)", "事件", "账号", "用户ID", "客户端", "IP", "详情"];
    const lines = [header.map(cell).join(",")];
    for (const row of rows) {
      lines.push([
        row.id, row.ts, row.event, row.username || "", row.user_id || "",
        row.client_id || "", row.ip || "", row.detail || "",
      ].map(cell).join(","));
    }
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return new Response(`\uFEFF${lines.join("\n")}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
