import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { ShieldCheck } from "@phosphor-icons/react";
import { VerifySection } from "../pages/HrdDokumen";

export default function VerifikasiButton() {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.get("/hrd/my-access")
      .then((r) => setShow(!!(r.data.is_super || (r.data.access && r.data.access.hrd_dokumen && r.data.access.hrd_dokumen.view))))
      .catch(() => setShow(false));
  }, []);

  if (!show) return null;
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)} data-testid="header-verifikasi-btn">
        <ShieldCheck size={15} weight="duotone" className="text-rose-600" /> Verifikasi Surat
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl" data-testid="header-verifikasi-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck size={18} weight="duotone" className="text-rose-600" /> Verifikasi Surat</DialogTitle></DialogHeader>
          <VerifySection />
        </DialogContent>
      </Dialog>
    </>
  );
}
