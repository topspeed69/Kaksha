"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Field, TextInput } from "@/components/ui";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return "/library";
  }
  return raw;
}

function UnlockForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth", { code });
      router.push(safeNext(params.get("next")));
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8 max-w-md space-y-6 border border-rule bg-surface p-6">
      <Field label="Access code" hint="This classroom requires an access code to continue.">
        <TextInput
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter access code"
          autoFocus
        />
      </Field>
      {error ? <p className="type-body-sm text-accent">{error}</p> : null}
      <Button type="submit" variant="primary" disabled={busy || !code.trim()} full>
        {busy ? "Checking" : "Unlock classroom"}
      </Button>
    </form>
  );
}

export default function UnlockPage() {
  return (
    <div className="grid12 py-12">
      <div className="col-span-4 lg:col-span-7">
        <p className="type-label text-accent">Restricted access</p>
        <h1 className="type-display mt-2 text-ink">Unlock Lumen</h1>
        <Suspense fallback={null}>
          <UnlockForm />
        </Suspense>
      </div>
    </div>
  );
}
