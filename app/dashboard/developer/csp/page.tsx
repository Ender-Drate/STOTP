import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { cloneDefaultCsp, readCspConfig } from "@/lib/csp";
import { CspEditor } from "@/app/components/CspEditor";

export const dynamic = "force-dynamic";

export default async function CspPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard/developer/csp");
  if (!isSuperAdmin(user)) redirect("/dashboard");

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">CSP 策略</h1>
          <p className="page-desc">
            仅最高管理员可编辑。保存、恢复默认和修改都需要已绑定 TOTP。
          </p>
        </div>
        <Link className="btn btn-ghost" href="/dashboard">返回概览</Link>
      </div>
      <CspEditor
        initial={readCspConfig()}
        defaults={cloneDefaultCsp()}
        totpEnabled={Boolean(user.totp_secret)}
      />
    </>
  );
}
