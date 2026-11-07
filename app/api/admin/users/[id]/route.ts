import { NextRequest, NextResponse } from "next/server";
import { audit, findUserById, getDb, type User } from "@/lib/db";
import { requireUser } from "@/lib/admin";
import { hasPermission, isSuperAdmin } from "@/lib/permissions";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { getRole } from "@/lib/roles";
import { publicUser } from "@/lib/users";

export const runtime = "nodejs";

interface Body {
  roleId?: number;
  status?: string;
}

function activeSuperAdmins(): number {
  return (getDb().prepare(
    `SELECT COUNT(*) AS c FROM users
     JOIN roles ON roles.id = users.role_id
     WHERE roles.key = 'superadmin' AND users.status = 'active'`
  ).get() as { c: number }).c;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const actor = await requireUser();
    const { id } = await context.params;
    const target = findUserById(Number(id));
    if (!target) throw new HttpError(404, "not_found", "用户不存在");

    const body = await readJson<Body>(req);
    const changingRole = body.roleId !== undefined;
    const changingStatus = body.status !== undefined;
    if (!changingRole && !changingStatus) {
      throw new HttpError(400, "invalid_request", "没有需要修改的字段");
    }
    if (target.id === actor.id && (changingRole || changingStatus)) {
      throw new HttpError(400, "invalid_request", "不能修改自己的角色或状态");
    }

    let role;
    if (changingRole) {
      if (!isSuperAdmin(actor)) {
        throw new HttpError(403, "forbidden", "只有最高管理员可以设置权限等级");
      }
      role = getRole(Number(body.roleId));
      if (!role) throw new HttpError(400, "invalid_request", "权限等级不存在");
      if (target.role_id === role.id) role = undefined;
    }

    let status = target.status;
    if (changingStatus) {
      if (!hasPermission(actor, "users.disable")) {
        throw new HttpError(403, "forbidden", "没有禁用/启用用户的权限");
      }
      if (!["active", "disabled"].includes(String(body.status))) {
        throw new HttpError(400, "invalid_request", "状态不合法");
      }
      status = String(body.status) as User["status"];
    }

    const targetIsSuper = target.role_id
      ? getRole(target.role_id)?.key === "superadmin"
      : target.role === "admin";
    const losingSuper = targetIsSuper
      && ((role && role.key !== "superadmin") || status === "disabled");
    if (losingSuper && activeSuperAdmins() <= 1) {
      throw new HttpError(400, "invalid_request", "至少保留一个启用的最高管理员");
    }

    if (role) {
      getDb().prepare(
        "UPDATE users SET role_id = ?, role = ?, permissions = ? WHERE id = ?"
      ).run(role.id, role.key, role.permissions, target.id);
    }
    if (status !== target.status) {
      getDb().prepare("UPDATE users SET status = ? WHERE id = ?").run(status, target.id);
      if (status === "disabled") {
        getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
        getDb().prepare("UPDATE tokens SET revoked = 1 WHERE user_id = ?").run(target.id);
      }
    }
    audit("user_update", {
      userId: actor.id,
      ip: clientIp(req),
      detail: `target=${target.id} role=${role?.key ?? target.role} status=${status}`,
    });
    return NextResponse.json({ user: publicUser(findUserById(target.id)!) });
  } catch (error) {
    return errorResponse(error);
  }
}
