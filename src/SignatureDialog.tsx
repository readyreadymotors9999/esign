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
    [draftMethod, setDraftMethod] = useState(method),
    [agreed, setAgreed] = useState(false);
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
      <label className="consent">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>
          I have reviewed this document and agree to use electronic records and
          a binding electronic signature. Apply this signature to all fields
          assigned to me in this document.
        </span>
      </label>
      <small>
        Your selection is remembered for this document. It is securely saved
        when the document is submitted.
      </small>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!draft || !agreed}
          onClick={() => onAccept(draft, draftMethod)}
        >
          Accept signature
        </button>
      </div>
    </dialog>
  );
}
