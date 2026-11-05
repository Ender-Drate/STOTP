import { NextRequest, NextResponse } from "next/server";
import { audit, findUserById, getDb, type User } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { publicUser } from "@/lib/users";

export const runtime = "nodejs";

interface Body {
  role?: string;
  status?: string;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const user = findUserById(Number(id));
    if (!user) throw new HttpError(404, "not_found", "用户不存在");
    const body = await readJson<Body>(req);
    const role = body.role ?? user.role;
    const status = body.status ?? user.status;
    if (!["admin", "user"].includes(role)) throw new HttpError(400, "invalid_request", "角色不合法");
    if (!["active", "disabled"].includes(status)) throw new HttpError(400, "invalid_request", "状态不合法");

    if (user.role === "admin" && (role !== "admin" || status !== "active")) {
      const row = getDb().prepare(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'"
      ).get() as { c: number };
      if (row.c <= 1) throw new HttpError(400, "invalid_request", "至少保留一个启用的管理员");
      if (user.id === admin.id) throw new HttpError(400, "invalid_request", "不能修改自己的管理员权限");
    }
    getDb().prepare("UPDATE users SET role = ?, status = ? WHERE id = ?")
      .run(role, status, user.id);
    if (status === "disabled") {
      getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
      getDb().prepare("UPDATE tokens SET revoked = 1 WHERE user_id = ?").run(user.id);
    }
    audit("user_update", {
      userId: admin.id, ip: clientIp(req), detail: `target=${user.id} role=${role} status=${status}`,
    });
    const updated = findUserById(user.id) as User;
    return NextResponse.json({ user: publicUser(updated) });
  } catch (error) {
    return errorResponse(error);
  }
}
