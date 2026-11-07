import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/admin";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { ALL_PERMISSION_KEYS } from "@/lib/permission-defs";
import {
  countUsersWithRole, deleteRole, getRole, roleView, updateRole,
} from "@/lib/roles";
import { optionalText, text } from "@/lib/validators";

export const runtime = "nodejs";

interface Body {
  name?: string;
  description?: string;
  permissions?: string[];
}

function permissionsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => (
    typeof item === "string" && ALL_PERMISSION_KEYS.includes(item)
  ))));
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const admin = await requireSuperAdmin();
    const { id } = await context.params;
    const role = getRole(Number(id));
    if (!role) throw new HttpError(404, "not_found", "权限等级不存在");
    if (role.key === "superadmin") {
      throw new HttpError(403, "forbidden", "最高管理员等级不可修改");
    }
    const body = await readJson<Body>(req);
    const name = text(body.name ?? role.name, "权限名称", 2, 40);
    const description = body.description === undefined
      ? role.description || "" : optionalText(body.description, 200) || "";
    const permissions = body.permissions === undefined
      ? permissionsFrom(JSON.parse(role.permissions))
      : permissionsFrom(body.permissions);
    if (!permissions.length) {
      throw new HttpError(400, "invalid_request", "至少选择一个权限节点");
    }
    updateRole(role.id, name, description, permissions);
    audit("role_update", {
      userId: admin.id, ip: clientIp(req), detail: `role=${role.id}`,
    });
    return NextResponse.json({ role: roleView(getRole(role.id)!) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const admin = await requireSuperAdmin();
    const { id } = await context.params;
    const role = getRole(Number(id));
    if (!role) throw new HttpError(404, "not_found", "权限等级不存在");
    if (role.is_system) throw new HttpError(403, "forbidden", "系统内置权限等级不可删除");
    if (countUsersWithRole(role.id) > 0) {
      throw new HttpError(409, "in_use", "仍有用户使用该权限等级");
    }
    deleteRole(role.id);
    audit("role_delete", {
      userId: admin.id, ip: clientIp(req), detail: `role=${role.id}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
