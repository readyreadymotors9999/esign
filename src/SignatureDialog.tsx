import { useEffect, useRef, useState } from "react";
import { Signature, type SignatureMethod } from "./Signature";
export function SignatureDialog({
  name,
  value,
  method,
  onClose,
  onAccept,
}: {
  name: string;
  value: string;
  method: SignatureMethod;
  onClose: () => void;
  onAccept: (png: string, method: SignatureMethod) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(value),
    [draftMethod, setDraftMethod] = useState(method);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="signature-dialog"
      aria-labelledby="signature-dialog-title"
      onCancel={onClose}
    >
      <div className="split">
        <h2 id="signature-dialog-title">Signature · {name}</h2>
        <button
          type="button"
          className="secondary"
          aria-label="Close signature dialog"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {value && (
        <div className="previous-signature">
          <span>Current signature</span>
          <img src={value} alt="Current signature" />
        </div>
      )}
      <Signature
        defaultName={name}
        initialMethod={method}
        onChange={setDraft}
        onMethodChange={setDraftMethod}
      />
      <small>
        Add signature applies this electronic signature to your assigned fields.
        It is saved when you submit the document.
      </small>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!draft}
          onClick={() => onAccept(draft, draftMethod)}
        >
          Add signature
        </button>
      </div>
    </dialog>
  );
}
