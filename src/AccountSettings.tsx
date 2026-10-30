import { useEffect, useState } from "react";
import { api } from "./api";
type Recipient = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
};
const empty = { id: "", first_name: "", last_name: "", email: "" };
export default function AccountSettings() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [editing, setEditing] = useState<Recipient | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  async function refresh() {
    const data = await api("recipients");
    setRecipients(data.recipients);
  }
  useEffect(() => {
    refresh()
      .catch((e) => setMessage(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function task(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const matches = recipients.filter((r) =>
    `${r.first_name} ${r.last_name} ${r.email}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <section className="account-settings">
      <div className="heading">
        <div>
          <h1>Account settings</h1>
          <p>Manage your private recipient address book.</p>
        </div>
        <a href="#/" className="button secondary">
          Back to documents
        </a>
      </div>
      <div className="settings-tabs">
        <span>
          Recipients <span className="count">{recipients.length}</span>
        </span>
      </div>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <div className="card recipients-card">
        <div className="split">
          <h2>Saved recipients</h2>
          <button disabled={busy} onClick={() => setEditing({ ...empty })}>
            Add recipient
          </button>
        </div>
        <label>
          Search recipients
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or email"
          />
        </label>
        {editing && (
          <form
            className="contact-editor"
            aria-label="Recipient details"
            onSubmit={(event) => {
              event.preventDefault();
              void task(async () => {
                await api("save_recipient", {
                  recipientId: editing.id || undefined,
                  firstName: editing.first_name,
                  lastName: editing.last_name,
                  email: editing.email,
                });
                await refresh();
                setEditing(null);
                setMessage("Recipient saved.");
              });
            }}
          >
            <h3>{editing.id ? "Edit recipient" : "Add recipient"}</h3>
            <div className="name-fields">
              <label>
                First name
                <input
                  required
                  maxLength={100}
                  value={editing.first_name}
                  onChange={(e) =>
                    setEditing({ ...editing, first_name: e.target.value })
                  }
                />
              </label>
              <label>
                Last name
                <input
                  maxLength={100}
                  value={editing.last_name}
                  onChange={(e) =>
                    setEditing({ ...editing, last_name: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Recipient email
              <input
                required
                type="email"
                value={editing.email}
                onChange={(e) =>
                  setEditing({ ...editing, email: e.target.value })
                }
              />
            </label>
            <div className="actions">
              <button disabled={busy}>Save recipient</button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {loading ? (
          <p>Loading recipients…</p>
        ) : !matches.length ? (
          <p>
            {recipients.length
              ? "No recipients match your search."
              : "No saved recipients yet."}
          </p>
        ) : (
          <ul className="recipient-list">
            {matches.map((recipient) => (
              <li key={recipient.id} className="recipient-row">
                <div>
                  <strong>
                    {`${recipient.first_name} ${recipient.last_name}`.trim()}
                  </strong>
                  <small>{recipient.email}</small>
                </div>
                <div className="actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setEditing({ ...recipient })}
                    aria-label={`Edit ${recipient.email}`}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary danger-link"
                    disabled={busy}
                    aria-label={`Delete ${recipient.email}`}
                    onClick={() => {
                      if (
                        !confirm(
                          `Delete ${recipient.first_name} ${recipient.last_name} (${recipient.email}) from your saved recipients? Existing invitations and signed documents will keep their original details.`,
                        )
                      )
                        return;
                      void task(async () => {
                        await api("delete_recipient", {
                          recipientId: recipient.id,
                        });
                        if (editing?.id === recipient.id) setEditing(null);
                        await refresh();
                        setMessage("Recipient deleted.");
                      });
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <small>
          Contact changes apply to future invitations. Previously sent
          invitations and signing records retain their original details.
        </small>
      </div>
    </section>
  );
}
