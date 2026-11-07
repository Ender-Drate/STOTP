import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/admin";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { ALL_PERMISSION_KEYS } from "@/lib/permission-defs";
import { createRole, listRoles, roleView } from "@/lib/roles";
import { optionalText, text } from "@/lib/validators";

export const runtime = "nodejs";

interface Body {
  name?: string;
  description?: string;
  permissions?: string[];
}

function validPermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = Array.from(new Set(value.filter((item): item is string => (
    typeof item === "string" && ALL_PERMISSION_KEYS.includes(item)
  ))));
  return unique;
}

export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json({ roles: listRoles() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const admin = await requireSuperAdmin();
    const body = await readJson<Body>(req);
    const name = text(body.name, "权限名称", 2, 40);
    const description = optionalText(body.description, 200) || "";
    const permissions = validPermissions(body.permissions);
    if (!permissions.length) {
      throw new HttpError(400, "invalid_request", "至少选择一个权限节点");
    }
    const role = createRole(name, description, permissions);
    audit("role_create", {
      userId: admin.id, ip: clientIp(req), detail: `role=${role.id} key=${role.key}`,
    });
    return NextResponse.json({ role: roleView(role) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
