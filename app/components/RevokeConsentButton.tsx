"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RevokeConsentButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-sm btn-danger"
      disabled={busy}
      onClick={async () => {
        if (!confirm("撤销该应用的授权？相关访问令牌会立即失效。")) return;
        setBusy(true);
        try {
          const res = await fetch(`/api/consents/${encodeURIComponent(clientId)}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            alert("撤销失败，请重试");
            return;
          }
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      撤销
    </button>
  );
}
